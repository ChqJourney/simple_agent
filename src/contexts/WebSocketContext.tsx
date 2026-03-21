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
} from '../types';
import { normalizeProviderConfig } from '../utils/config';
import { backendAuthTokenUrl } from '../utils/backendEndpoint';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface WebSocketContextValue {
  connectionStatus: ConnectionStatus;
  isConnected: boolean;
  sendMessage: (sessionId: string, content: string, attachments?: Attachment[], workspacePath?: string) => void;
  answerQuestion: (toolCallId: string, answer?: string, action?: 'submit' | 'dismiss') => boolean;
  sendConfig: (configOverride?: ProviderConfig) => void;
  confirmTool: (toolCallId: string, decision: ToolDecision, scope?: ToolDecisionScope) => boolean;
  interrupt: (sessionId: string) => void;
  sendWorkspace: (workspacePath: string) => void;
  setExecutionMode: (sessionId: string, mode: ExecutionMode) => boolean;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);
const TASK_STATUS_VALUES: Task['status'][] = ['pending', 'in_progress', 'completed', 'failed'];
const LEGACY_NO_AUTH_TOKEN = '__legacy_no_auth__';
const UNSUPPORTED_EXECUTION_MODE_ERROR = 'Unknown message type: set_execution_mode';
const AUTH_REQUIRED_ERROR = 'Connection not authenticated. Send config with auth_token first.';

interface QueuedWorkspaceMessage {
  workspacePath: string;
  message: ClientMessage;
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

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const lastSentConfigKeyRef = useRef<string | null>(null);
  const authTokenRef = useRef<string | null>(null);
  const authTokenPromiseRef = useRef<Promise<string | null> | null>(null);
  const executionModeSupportedRef = useRef(true);
  const backendAuthenticatedRef = useRef(false);
  const workspaceBoundRef = useRef(false);
  const pendingWorkspacePathRef = useRef<string | null>(null);
  const queuedMessagesRef = useRef<QueuedWorkspaceMessage[]>([]);
  const queuedExecutionModesRef = useRef<Record<string, ExecutionMode>>({});
  const config = useConfigStore((state) => state.config);
  const isConnected = connectionStatus === 'connected';
  const isTestMode = import.meta.env.MODE === 'test';

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
        setConnectionStatus('disconnected');
      }
    );

    return () => {
      wsService.offMessage(handleMessage);
      cleanup();
    };
  }, []);

  const send = useCallback((message: ClientWebSocketMessage) => {
    return wsService.send(message);
  }, []);

  const fetchAuthToken = useCallback(async (): Promise<string | null> => {
    if (isTestMode) {
      return 'test-auth-token';
    }
    if (authTokenRef.current !== null) {
      return authTokenRef.current;
    }
    if (authTokenPromiseRef.current) {
      return authTokenPromiseRef.current;
    }

    authTokenPromiseRef.current = (async () => {
      try {
        const response = await fetch(backendAuthTokenUrl);
        if (response.status === 404) {
          authTokenRef.current = LEGACY_NO_AUTH_TOKEN;
          return LEGACY_NO_AUTH_TOKEN;
        }
        if (!response.ok) {
          return null;
        }
        const payload = await response.json().catch(() => ({}));
        if (typeof payload.auth_token !== 'string' || !payload.auth_token) {
          return null;
        }
        authTokenRef.current = payload.auth_token;
        return payload.auth_token;
      } catch {
        return null;
      } finally {
        authTokenPromiseRef.current = null;
      }
    })();

    return authTokenPromiseRef.current;
  }, [isTestMode]);

  const sendConfig = useCallback((configOverride?: ProviderConfig) => {
    const sourceConfig = configOverride || config;
    if (!sourceConfig) {
      return;
    }

    const runtimeConfig = normalizeProviderConfig(sourceConfig);
    const configKey = JSON.stringify(runtimeConfig);

    const sendWithToken = (authToken: string | null) => {
      if (authToken === null) {
        return;
      }
      const payload: ClientWebSocketMessage = {
        type: 'config',
        ...runtimeConfig,
      };
      if (authToken !== LEGACY_NO_AUTH_TOKEN) {
        payload.auth_token = authToken;
      }
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
  }, [config, fetchAuthToken, isTestMode, send]);

  useEffect(() => {
    if (!isConnected || !config) {
      return;
    }

    const runtimeConfig = normalizeProviderConfig(config);
    const nextConfigKey = JSON.stringify(runtimeConfig);
    if (nextConfigKey !== lastSentConfigKeyRef.current) {
      const sendWithToken = (authToken: string | null) => {
        if (authToken === null) {
          return;
        }
        const payload: ClientWebSocketMessage = {
          type: 'config',
          ...runtimeConfig,
        };
        if (authToken !== LEGACY_NO_AUTH_TOKEN) {
          payload.auth_token = authToken;
        }
        if (send(payload)) {
          backendAuthenticatedRef.current = false;
          lastSentConfigKeyRef.current = nextConfigKey;
        }
      };

      const immediateToken = isTestMode ? 'test-auth-token' : authTokenRef.current;
      if (immediateToken !== null) {
        sendWithToken(immediateToken);
      } else {
        void fetchAuthToken().then((token) => {
          sendWithToken(token);
        });
      }
    }
  }, [config, fetchAuthToken, isConnected, isTestMode, send]);

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

  const answerQuestion = useCallback((toolCallId: string, answer?: string, action: 'submit' | 'dismiss' = 'submit') => {
    return send({
      type: 'question_response',
      tool_call_id: toolCallId,
      answer,
      action,
    });
  }, [send]);

  const confirmTool = useCallback((toolCallId: string, decision: ToolDecision, scope: ToolDecisionScope = 'session') => {
    return send({
      type: 'tool_confirm',
      tool_call_id: toolCallId,
      decision,
      scope,
      approved: decision !== 'reject',
    });
  }, [send]);

  const interrupt = useCallback((sessionId: string) => {
    send({ type: 'interrupt', session_id: sessionId });
  }, [send]);

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
    <WebSocketContext.Provider value={{ connectionStatus, isConnected, sendMessage, answerQuestion, sendConfig, confirmTool, interrupt, sendWorkspace, setExecutionMode }}>
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
