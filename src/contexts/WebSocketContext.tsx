import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { wsService } from '../services/websocket';
import { useChatStore } from '../stores/chatStore';
import { useConfigStore } from '../stores/configStore';
import { useRunStore } from '../stores/runStore';
import { useSessionStore } from '../stores/sessionStore';
import { Task, TaskNode, useTaskStore } from '../stores/taskStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import {
  ServerWebSocketMessage,
  Attachment,
  ClientWebSocketMessage,
  ClientMessage,
  ToolCall,
  ToolDecision,
  ToolDecisionScope,
  ProviderConfig,
  ExecutionMode,
  OcrRuntimeStatus,
  OcrStatusPayload,
} from '../types';
import { normalizeProviderConfig } from '../utils/config';
import { getBackendAuthToken } from '../utils/backendAuth';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface WebSocketContextValue {
  connectionStatus: ConnectionStatus;
  isConnected: boolean;
  ocrStatus: OcrStatusPayload & { status: OcrRuntimeStatus };
  sendMessage: (sessionId: string, content: string, attachments?: Attachment[], workspacePath?: string) => void;
  answerQuestion: (sessionId: string, toolCallId: string, answer?: string, action?: 'submit' | 'dismiss') => boolean;
  sendConfig: (configOverride?: ProviderConfig) => void;
  confirmTool: (sessionId: string, toolCallId: string, decision: ToolDecision, scope?: ToolDecisionScope) => boolean;
  interrupt: (sessionId: string) => void;
  sendWorkspace: (workspacePath: string) => void;
  setExecutionMode: (sessionId: string, mode: ExecutionMode) => boolean;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);
const DEFAULT_OCR_STATUS: OcrStatusPayload & { status: OcrRuntimeStatus } = {
  enabled: false,
  installed: false,
  status: 'unavailable',
  version: null,
  engine: null,
  api_version: null,
  root_dir: null,
};
const TASK_STATUS_VALUES: Task['status'][] = ['pending', 'in_progress', 'completed', 'failed'];
const UNSUPPORTED_EXECUTION_MODE_ERROR = 'Unknown message type: set_execution_mode';
const AUTH_REQUIRED_ERROR = 'Connection not authenticated. Send config with auth_token first.';

interface QueuedWorkspaceMessage {
  workspacePath: string;
  message: ClientMessage;
}

type QueuedAuthenticatedMessage =
  | Extract<ClientWebSocketMessage, { type: 'question_response' }>
  | Extract<ClientWebSocketMessage, { type: 'tool_confirm' }>
  | Extract<ClientWebSocketMessage, { type: 'interrupt' }>;

function hasTransientChatState(session: {
  isStreaming: boolean;
  currentStreamingContent: string;
  currentReasoningContent: string;
  assistantStatus: string;
  pendingToolConfirm?: unknown;
  pendingQuestion?: unknown;
}): boolean {
  return (
    session.isStreaming
    || Boolean(session.currentStreamingContent)
    || Boolean(session.currentReasoningContent)
    || session.assistantStatus === 'waiting'
    || session.assistantStatus === 'thinking'
    || session.assistantStatus === 'streaming'
    || session.assistantStatus === 'tool_calling'
    || Boolean(session.pendingToolConfirm)
    || Boolean(session.pendingQuestion)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeTaskStatus(candidate: unknown): Task['status'] {
  if (typeof candidate !== 'string') {
    return 'pending';
  }
  return TASK_STATUS_VALUES.includes(candidate as Task['status'])
    ? (candidate as Task['status'])
    : 'pending';
}

function normalizeTaskNode(candidate: unknown): TaskNode | undefined {
  if (!isRecord(candidate) || typeof candidate.id !== 'string') {
    return undefined;
  }

  return {
    id: candidate.id,
    content: typeof candidate.content === 'string' ? candidate.content : '',
    status: normalizeTaskStatus(candidate.status),
    subTasks: Array.isArray(candidate.subTasks)
      ? candidate.subTasks
          .map((item) => normalizeTaskNode(item))
          .filter((item): item is TaskNode => Boolean(item))
      : undefined,
  };
}

function applyTodoToolResult(sessionId: string, output: unknown) {
  if (!isRecord(output) || output.event !== 'todo_task' || typeof output.action !== 'string') {
    return;
  }

  const task = normalizeTaskNode(output.task);
  if (!task) {
    return;
  }

  const taskStore = useTaskStore.getState();
  if (output.action === 'remove') {
    taskStore.removeTask(task.id);
    return;
  }

  const nextTask: Task = {
    ...task,
    sessionId,
    createdAt: new Date().toISOString(),
  };

  if (output.action === 'complete') {
    nextTask.status = 'completed';
  }

  taskStore.upsertTask(nextTask);
}

function applyFileWriteToolResult(output: unknown) {
  if (!isRecord(output) || output.event !== 'file_write' || typeof output.path !== 'string') {
    return;
  }

  const change = output.change === 'created' ? 'created' : 'updated';
  useWorkspaceStore.getState().markChangedFile(output.path, change);
}

function applyCompactionContextEstimate(sessionId: string, event: { payload: Record<string, unknown>; timestamp: string }) {
  const postTokensEstimate = typeof event.payload.post_tokens_estimate === 'number'
    ? event.payload.post_tokens_estimate
    : null;
  const explicitContextLength = typeof event.payload.context_length === 'number'
    ? event.payload.context_length
    : null;
  const fallbackContextLength = useChatStore.getState().sessions[sessionId]?.latestUsage?.context_length;
  const contextLength = explicitContextLength ?? fallbackContextLength ?? null;

  if (postTokensEstimate === null || postTokensEstimate <= 0 || contextLength === null || contextLength <= 0) {
    return;
  }

  useChatStore.getState().setContextEstimate(
    sessionId,
    {
      prompt_tokens: postTokensEstimate,
      completion_tokens: 0,
      total_tokens: postTokensEstimate,
      context_length: contextLength,
    },
    event.timestamp
  );
}

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [ocrStatus, setOcrStatus] = useState<OcrStatusPayload & { status: OcrRuntimeStatus }>(DEFAULT_OCR_STATUS);
  const lastSentConfigKeyRef = useRef<string | null>(null);
  const lastConfigErrorRef = useRef<string | null>(null);
  const authTokenRef = useRef<string | null>(null);
  const authTokenPromiseRef = useRef<Promise<string | null> | null>(null);
  const executionModeSupportedRef = useRef(true);
  const backendAuthenticatedRef = useRef(false);
  const workspaceBoundRef = useRef(false);
  const pendingWorkspacePathRef = useRef<string | null>(null);
  const queuedMessagesRef = useRef<QueuedWorkspaceMessage[]>([]);
  const queuedAuthenticatedMessagesRef = useRef<QueuedAuthenticatedMessage[]>([]);
  const queuedExecutionModesRef = useRef<Record<string, ExecutionMode>>({});
  const config = useConfigStore((state) => state.config);
  const isConnected = connectionStatus === 'connected';
  const isTestMode = import.meta.env.MODE === 'test';

  const reportConfigError = useCallback((error: string, details?: string) => {
    const dedupeKey = details ? `${error}\n${details}` : error;
    if (lastConfigErrorRef.current === dedupeKey) {
      return;
    }

    lastConfigErrorRef.current = dedupeKey;

    const currentSessionId = useSessionStore.getState().currentSessionId;
    if (currentSessionId) {
      useChatStore.getState().setError(currentSessionId, error, details);
      return;
    }

    if (details) {
      console.error(error, details);
      return;
    }

    console.error(error);
  }, []);

  const finalizeInterruptedChatSessions = useCallback(() => {
    const chatStore = useChatStore.getState();
    for (const [sessionId, session] of Object.entries(chatStore.sessions)) {
      if (hasTransientChatState(session)) {
        chatStore.setInterrupted(sessionId);
      }
    }
  }, []);

  useEffect(() => {
    const handleMessage = (data: ServerWebSocketMessage) => {
      const store = useChatStore.getState();
      const runStore = useRunStore.getState();

      switch (data.type) {
        case 'started':
          store.markUserMessageSent(data.session_id);
          store.startStreaming(data.session_id);
          break;
        case 'token':
          store.addToken(data.session_id, data.content);
          break;
        case 'reasoning_token':
          store.addReasoningToken(data.session_id, data.content);
          break;
        case 'reasoning_complete':
          store.setReasoningComplete(data.session_id);
          break;
        case 'tool_call': {
          if (data.name === 'ocr_extract') {
            setOcrStatus((current) => current.enabled
              ? {
                  ...current,
                  status: 'starting',
                }
              : current);
          }
          const toolCall: ToolCall = {
            tool_call_id: data.tool_call_id,
            name: data.name,
            arguments: data.arguments,
          };
          store.setToolCall(data.session_id, toolCall);
          break;
        }
        case 'tool_confirm_request': {
          const toolCall: ToolCall = {
            tool_call_id: data.tool_call_id,
            name: data.name,
            arguments: data.arguments,
          };
          store.setPendingToolConfirm(data.session_id, toolCall);
          break;
        }
        case 'tool_decision':
          store.addToolDecision(
            data.session_id,
            data.tool_call_id,
            data.name,
            data.decision,
            data.scope,
            data.reason
          );
          if (data.decision !== 'reject') {
            store.clearPendingToolConfirm(data.session_id, data.tool_call_id);
          }
          break;
        case 'question_request': {
          store.setPendingQuestion(data.session_id, {
            tool_call_id: data.tool_call_id,
            tool_name: data.tool_name || 'ask_question',
            question: data.question,
            details: data.details,
            options: data.options,
            status: 'idle',
          });
          break;
        }
        case 'tool_result':
          if (data.tool_name === 'ocr_extract') {
            setOcrStatus((current) => ({
              ...current,
              status: data.success ? 'available' : 'unavailable',
              installed: data.success ? true : current.installed,
            }));
          }
          if (data.success && data.tool_name === 'file_write') {
            applyFileWriteToolResult(data.output);
          }
          if (data.success && data.tool_name === 'todo_task') {
            applyTodoToolResult(data.session_id, data.output);
          }
          store.setToolResult(
            data.session_id,
            data.tool_call_id,
            data.success,
            data.output,
            data.error,
            data.tool_name
          );
          break;
        case 'completed':
          store.setCompleted(data.session_id, data.usage);
          break;
        case 'max_rounds_reached':
          store.setError(data.session_id, data.error || 'Agent reached max tool-call rounds');
          break;
        case 'error': {
          if (typeof data.error === 'string' && data.error.includes(UNSUPPORTED_EXECUTION_MODE_ERROR)) {
            executionModeSupportedRef.current = false;
            console.warn('Backend does not support execution mode updates; disabling mode sync.');
            break;
          }
          if (typeof data.error === 'string' && data.error.includes(AUTH_REQUIRED_ERROR)) {
            backendAuthenticatedRef.current = false;
            workspaceBoundRef.current = false;
          }
          const fallbackSessionId = useSessionStore.getState().currentSessionId || undefined;
          const targetSessionId = data.session_id || fallbackSessionId;
          if (targetSessionId) {
            store.setError(targetSessionId, data.error, data.details);
          } else {
            console.error('Unhandled backend error without session_id:', data.error, data.details);
          }
          break;
        }
        case 'retry':
          console.info('Retrying agent run:', data.session_id, data.attempt, data.max_retries, data.error);
          break;
        case 'interrupted':
          store.setInterrupted(data.session_id);
          break;
        case 'config_updated':
          backendAuthenticatedRef.current = true;
          workspaceBoundRef.current = false;
          lastConfigErrorRef.current = null;
          setOcrStatus({
            ...DEFAULT_OCR_STATUS,
            ...(data.ocr || {}),
          });
          if (queuedAuthenticatedMessagesRef.current.length > 0) {
            const remainingMessages: QueuedAuthenticatedMessage[] = [];

            queuedAuthenticatedMessagesRef.current.forEach((message) => {
              const sent = wsService.send(message);
              if (!sent) {
                remainingMessages.push(message);
              }
            });

            queuedAuthenticatedMessagesRef.current = remainingMessages;
          }
          for (const [sessionId, executionMode] of Object.entries(queuedExecutionModesRef.current)) {
            const sent = wsService.send({
              type: 'set_execution_mode',
              session_id: sessionId,
              execution_mode: executionMode,
            });
            if (sent) {
              delete queuedExecutionModesRef.current[sessionId];
            }
          }
          if (pendingWorkspacePathRef.current) {
            wsService.send({
              type: 'set_workspace',
              workspace_path: pendingWorkspacePathRef.current,
            });
          }
          console.log('Config updated:', data.provider, data.model);
          break;
        case 'workspace_updated':
          workspaceBoundRef.current = data.workspace_path === pendingWorkspacePathRef.current;
          if (queuedMessagesRef.current.length > 0) {
            const acknowledgedWorkspace = data.workspace_path;
            const remainingMessages: QueuedWorkspaceMessage[] = [];

            queuedMessagesRef.current.forEach((entry) => {
              if (entry.workspacePath !== acknowledgedWorkspace) {
                remainingMessages.push(entry);
                return;
              }

              const sent = wsService.send(entry.message);
              if (!sent) {
                remainingMessages.push(entry);
              }
            });

            queuedMessagesRef.current = remainingMessages;
          }

          if (
            pendingWorkspacePathRef.current &&
            data.workspace_path !== pendingWorkspacePathRef.current &&
            backendAuthenticatedRef.current
          ) {
            wsService.send({
              type: 'set_workspace',
              workspace_path: pendingWorkspacePathRef.current,
            });
          }
          console.log('Workspace updated:', data.workspace_path);
          break;
        case 'execution_mode_updated':
          console.log('Execution mode updated:', data.session_id, data.execution_mode);
          break;
        case 'session_title_updated':
          useSessionStore.getState().updateSession(data.session_id, { title: data.title });
          break;
        case 'session_lock_updated':
          useSessionStore.getState().updateSession(data.session_id, { locked_model: data.locked_model });
          break;
        case 'run_event':
          runStore.addEvent(data.session_id, data.event);
          if (data.event.event_type === 'session_compaction_completed') {
            applyCompactionContextEstimate(data.session_id, data.event);
          }
          break;
        default:
          console.log('Unknown message type:', data);
      }
    };

    wsService.onMessage(handleMessage);
    const cleanup = wsService.connect(
      () => {
        backendAuthenticatedRef.current = false;
        workspaceBoundRef.current = false;
        setConnectionStatus('connected');
      },
      () => {
        lastSentConfigKeyRef.current = null;
        backendAuthenticatedRef.current = false;
        workspaceBoundRef.current = false;
        finalizeInterruptedChatSessions();
        setOcrStatus((current) => ({
          ...current,
          status: current.enabled ? 'unavailable' : current.status,
        }));
        setConnectionStatus('disconnected');
      }
    );

    return () => {
      finalizeInterruptedChatSessions();
      wsService.offMessage(handleMessage);
      cleanup();
    };
  }, [finalizeInterruptedChatSessions]);

  const send = useCallback((message: ClientWebSocketMessage) => {
    return wsService.send(message);
  }, []);

  const sendAuthenticatedMessage = useCallback((message: QueuedAuthenticatedMessage) => {
    if (!backendAuthenticatedRef.current) {
      queuedAuthenticatedMessagesRef.current.push(message);
      return true;
    }

    return send(message);
  }, [send]);

  const fetchAuthToken = useCallback(async (): Promise<string | null> => {
    if (authTokenRef.current !== null) {
      return authTokenRef.current;
    }
    if (authTokenPromiseRef.current) {
      return authTokenPromiseRef.current;
    }

    authTokenPromiseRef.current = (async () => {
      try {
        const token = await getBackendAuthToken({
          isTestMode,
          onError: reportConfigError,
        });
        if (token) {
          authTokenRef.current = token;
          lastConfigErrorRef.current = null;
        }
        return token;
      } finally {
        authTokenPromiseRef.current = null;
      }
    })();

    return authTokenPromiseRef.current;
  }, [isTestMode, reportConfigError]);

  const sendRuntimeConfig = useCallback((runtimeConfig: ProviderConfig, configKey: string) => {
    const sendWithToken = (authToken: string | null) => {
      if (authToken === null) {
        return;
      }
      const payload: ClientWebSocketMessage = {
        type: 'config',
        ...runtimeConfig,
        auth_token: authToken,
      };
      if (send(payload)) {
        backendAuthenticatedRef.current = false;
        lastSentConfigKeyRef.current = configKey;
      }
    };

    const immediateToken = isTestMode ? 'test-auth-token' : authTokenRef.current;
    if (immediateToken !== null) {
      sendWithToken(immediateToken);
      return;
    }

    void fetchAuthToken().then((token) => {
      sendWithToken(token);
    });
  }, [fetchAuthToken, isTestMode, send]);

  const sendConfig = useCallback((configOverride?: ProviderConfig) => {
    const sourceConfig = configOverride || config;
    if (!sourceConfig) {
      return;
    }

    const runtimeConfig = normalizeProviderConfig(sourceConfig);
    const configKey = JSON.stringify(runtimeConfig);
    sendRuntimeConfig(runtimeConfig, configKey);
  }, [config, sendRuntimeConfig]);

  useEffect(() => {
    if (!isConnected || !config) {
      return;
    }

    const runtimeConfig = normalizeProviderConfig(config);
    const nextConfigKey = JSON.stringify(runtimeConfig);
    if (nextConfigKey !== lastSentConfigKeyRef.current) {
      sendRuntimeConfig(runtimeConfig, nextConfigKey);
    }
  }, [config, isConnected, sendRuntimeConfig]);

  const sendMessage = useCallback((sessionId: string, content: string, attachments?: Attachment[], workspacePath?: string) => {
    const message: ClientMessage = { type: 'message', session_id: sessionId, content };
    if (attachments && attachments.length > 0) {
      message.attachments = attachments;
    }
    if (workspacePath) {
      message.workspace_path = workspacePath;
      pendingWorkspacePathRef.current = workspacePath;
      if (!workspaceBoundRef.current) {
        queuedMessagesRef.current.push({ workspacePath, message });
        if (backendAuthenticatedRef.current) {
          send({ type: 'set_workspace', workspace_path: workspacePath });
        }
        return;
      }
    }
    send(message);
  }, [send]);

  const answerQuestion = useCallback((
    sessionId: string,
    toolCallId: string,
    answer?: string,
    action: 'submit' | 'dismiss' = 'submit',
  ) => {
    return sendAuthenticatedMessage({
      type: 'question_response',
      session_id: sessionId,
      tool_call_id: toolCallId,
      answer,
      action,
    });
  }, [sendAuthenticatedMessage]);

  const confirmTool = useCallback((
    sessionId: string,
    toolCallId: string,
    decision: ToolDecision,
    scope: ToolDecisionScope = 'session'
  ) => {
    return sendAuthenticatedMessage({
      type: 'tool_confirm',
      session_id: sessionId,
      tool_call_id: toolCallId,
      decision,
      scope,
      approved: decision !== 'reject',
    });
  }, [sendAuthenticatedMessage]);

  const interrupt = useCallback((sessionId: string) => {
    sendAuthenticatedMessage({ type: 'interrupt', session_id: sessionId });
  }, [sendAuthenticatedMessage]);

  const sendWorkspace = useCallback((workspacePath: string) => {
    pendingWorkspacePathRef.current = workspacePath;
    workspaceBoundRef.current = false;
    if (!backendAuthenticatedRef.current) {
      return;
    }
    send({ type: 'set_workspace', workspace_path: workspacePath });
  }, [send]);

  const setExecutionMode = useCallback((sessionId: string, mode: ExecutionMode) => {
    if (!executionModeSupportedRef.current) {
      return false;
    }
    if (!backendAuthenticatedRef.current) {
      queuedExecutionModesRef.current[sessionId] = mode;
      return true;
    }

    const sent = send({
      type: 'set_execution_mode',
      session_id: sessionId,
      execution_mode: mode,
    });
    if (!sent) {
      queuedExecutionModesRef.current[sessionId] = mode;
    } else {
      delete queuedExecutionModesRef.current[sessionId];
    }
    return sent;
  }, [send]);

  return (
    <WebSocketContext.Provider value={{ connectionStatus, isConnected, ocrStatus, sendMessage, answerQuestion, sendConfig, confirmTool, interrupt, sendWorkspace, setExecutionMode }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within WebSocketProvider');
  }
  return context;
}
