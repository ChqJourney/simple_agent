import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { wsService } from '../services/websocket';
import { useChatStore } from '../stores/chatStore';
import { useConfigStore } from '../stores/configStore';
import { useSessionStore } from '../stores/sessionStore';
import {
  ServerWebSocketMessage,
  ClientWebSocketMessage,
  ClientMessage,
  ToolCall,
  ToolDecision,
  ToolDecisionScope,
} from '../types';

interface WebSocketContextValue {
  isConnected: boolean;
  sendMessage: (sessionId: string, content: string, workspacePath?: string) => void;
  sendConfig: () => void;
  confirmTool: (toolCallId: string, decision: ToolDecision, scope?: ToolDecisionScope) => void;
  interrupt: (sessionId: string) => void;
  sendWorkspace: (workspacePath: string) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const configSentRef = useRef(false);

  useEffect(() => {
    const handleMessage = (data: ServerWebSocketMessage) => {
      const store = useChatStore.getState();

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
        case 'tool_result':
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
          store.setError(data.session_id, `Retry ${data.attempt}/${data.max_retries}`, data.error);
          break;
        case 'interrupted':
          store.setCompleted(data.session_id);
          break;
        case 'config_updated':
          console.log('Config updated:', data.provider, data.model);
          break;
        case 'workspace_updated':
          console.log('Workspace updated:', data.workspace_path);
          break;
        default:
          console.log('Unknown message type:', data);
      }
    };

    wsService.onMessage(handleMessage);
    const cleanup = wsService.connect(
      () => setIsConnected(true),
      () => setIsConnected(false)
    );

    return () => {
      wsService.offMessage(handleMessage);
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (isConnected) {
      const config = useConfigStore.getState().config;
      if (config && !configSentRef.current) {
        wsService.send({ type: 'config', ...config });
        configSentRef.current = true;
      }
    }
  }, [isConnected]);

  const send = useCallback((message: ClientWebSocketMessage) => {
    wsService.send(message);
  }, []);

  const sendMessage = useCallback((sessionId: string, content: string, workspacePath?: string) => {
    const message: ClientWebSocketMessage = { type: 'message', session_id: sessionId, content };
    if (workspacePath) {
      (message as ClientMessage).workspace_path = workspacePath;
    }
    send(message);
  }, [send]);

  const sendConfig = useCallback(() => {
    const config = useConfigStore.getState().config;
    if (config) {
      send({ type: 'config', ...config });
    }
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
    <WebSocketContext.Provider value={{ isConnected, sendMessage, sendConfig, confirmTool, interrupt, sendWorkspace }}>
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

