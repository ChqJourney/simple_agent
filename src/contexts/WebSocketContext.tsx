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
} from '../types';
import { normalizeProviderConfig } from '../utils/config';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface WebSocketContextValue {
  connectionStatus: ConnectionStatus;
  isConnected: boolean;
  sendMessage: (sessionId: string, content: string, attachments?: Attachment[], workspacePath?: string) => void;
  answerQuestion: (toolCallId: string, answer?: string, action?: 'submit' | 'dismiss') => boolean;
  sendConfig: (configOverride?: ProviderConfig) => void;
  confirmTool: (toolCallId: string, decision: ToolDecision, scope?: ToolDecisionScope) => void;
  interrupt: (sessionId: string) => void;
  sendWorkspace: (workspacePath: string) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeTaskNode(candidate: unknown): TaskNode | undefined {
  if (!isRecord(candidate) || typeof candidate.id !== 'string') {
    return undefined;
  }

  return {
    id: candidate.id,
    content: typeof candidate.content === 'string' ? candidate.content : '',
    status: (candidate.status as Task['status']) || 'pending',
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
  const config = useConfigStore((state) => state.config);
  const isConnected = connectionStatus === 'connected';

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
          console.log('Config updated:', data.provider, data.model);
          break;
        case 'workspace_updated':
          console.log('Workspace updated:', data.workspace_path);
          break;
        case 'session_title_updated':
          useSessionStore.getState().updateSession(data.session_id, { title: data.title });
          break;
        case 'session_lock_updated':
          useSessionStore.getState().updateSession(data.session_id, { locked_model: data.locked_model });
          break;
        case 'run_event':
          store.addRunEvent(data.session_id, data.event);
          runStore.addEvent(data.session_id, data.event);
          break;
        default:
          console.log('Unknown message type:', data);
      }
    };

    wsService.onMessage(handleMessage);
    const cleanup = wsService.connect(
      () => setConnectionStatus('connected'),
      () => {
        lastSentConfigKeyRef.current = null;
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

  const sendConfig = useCallback((configOverride?: ProviderConfig) => {
    const sourceConfig = configOverride || config;
    if (!sourceConfig) {
      return;
    }

    const runtimeConfig = normalizeProviderConfig(sourceConfig);
    if (send({ type: 'config', ...runtimeConfig })) {
      lastSentConfigKeyRef.current = JSON.stringify(runtimeConfig);
    }
  }, [config, send]);

  useEffect(() => {
    if (!isConnected || !config) {
      return;
    }

    const runtimeConfig = normalizeProviderConfig(config);
    const nextConfigKey = JSON.stringify(runtimeConfig);
    if (nextConfigKey !== lastSentConfigKeyRef.current) {
      if (send({ type: 'config', ...runtimeConfig })) {
        lastSentConfigKeyRef.current = nextConfigKey;
      }
    }
  }, [config, isConnected, send]);

  const sendMessage = useCallback((sessionId: string, content: string, attachments?: Attachment[], workspacePath?: string) => {
    const message: ClientWebSocketMessage = { type: 'message', session_id: sessionId, content };
    if (attachments && attachments.length > 0) {
      (message as ClientMessage).attachments = attachments;
    }
    if (workspacePath) {
      (message as ClientMessage).workspace_path = workspacePath;
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
    send({
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
    send({ type: 'set_workspace', workspace_path: workspacePath });
  }, [send]);

  return (
    <WebSocketContext.Provider value={{ connectionStatus, isConnected, sendMessage, answerQuestion, sendConfig, confirmTool, interrupt, sendWorkspace }}>
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
