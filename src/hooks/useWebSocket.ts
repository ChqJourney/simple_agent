import { useEffect, useCallback, useState } from 'react';
import { wsService } from '../services/websocket';
import { useChatStore } from '../stores/chatStore';
import { useConfigStore } from '../stores/configStore';
import { ServerWebSocketMessage, ClientWebSocketMessage, ToolCall } from '../types';

interface UseWebSocketReturn {
  isConnected: boolean;
  sendMessage: (sessionId: string, content: string) => void;
  sendConfig: () => void;
  confirmTool: (toolCallId: string, approved: boolean) => void;
  interrupt: (sessionId: string) => void;
}

export function useWebSocket(): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const { config } = useConfigStore();
  const {
    addToken,
    addReasoningToken,
    setReasoningComplete,
    setToolCall,
    setToolResult,
    setCompleted,
    setError,
    startStreaming,
  } = useChatStore();

  const handleMessage = useCallback((data: ServerWebSocketMessage) => {
    switch (data.type) {
      case 'started':
        startStreaming(data.session_id);
        break;

      case 'token':
        addToken(data.session_id, data.content);
        break;

      case 'reasoning_token':
        addReasoningToken(data.session_id, data.content);
        break;

      case 'reasoning_complete':
        setReasoningComplete(data.session_id);
        break;

      case 'tool_call': {
        const toolCall: ToolCall = {
          tool_call_id: data.tool_call_id,
          name: data.name,
          arguments: data.arguments,
        };
        setToolCall(data.session_id, toolCall);
        break;
      }

      case 'tool_confirm_request': {
        const toolCall: ToolCall = {
          tool_call_id: data.tool_call_id,
          name: data.name,
          arguments: data.arguments,
        };
        setToolCall(data.session_id, toolCall);
        break;
      }

      case 'tool_result':
        setToolResult(data.session_id, data.tool_call_id, data.success, data.output);
        break;

      case 'completed':
        setCompleted(data.session_id, data.usage);
        break;

      case 'error':
        setError(data.session_id, data.error, data.details);
        break;

      case 'retry':
        console.log(`Retry attempt ${data.attempt}/${data.max_retries}: ${data.error}`);
        break;

      case 'interrupted':
        setCompleted(data.session_id);
        break;

      default:
        console.log('Unknown message type:', data);
    }
  }, [addToken, addReasoningToken, setReasoningComplete, setToolCall, setToolResult, setCompleted, setError, startStreaming]);

  useEffect(() => {
    wsService.onMessage(handleMessage);

    wsService.connect(
      () => setIsConnected(true),
      () => setIsConnected(false)
    );

    return () => {
      wsService.disconnect();
    };
  }, [handleMessage]);

  const send = useCallback((message: ClientWebSocketMessage) => {
    wsService.send(message);
  }, []);

  const sendMessage = useCallback((sessionId: string, content: string) => {
    send({
      type: 'message',
      session_id: sessionId,
      content,
    });
  }, [send]);

  const sendConfig = useCallback(() => {
    if (config) {
      send({
        type: 'config',
        ...config,
      });
    }
  }, [config, send]);

  const confirmTool = useCallback((toolCallId: string, approved: boolean) => {
    send({
      type: 'tool_confirm',
      tool_call_id: toolCallId,
      approved,
    });
  }, [send]);

  const interrupt = useCallback((sessionId: string) => {
    send({
      type: 'interrupt',
      session_id: sessionId,
    });
  }, [send]);

  useEffect(() => {
    if (isConnected && config) {
      sendConfig();
    }
  }, [isConnected, config, sendConfig]);

  return {
    isConnected,
    sendMessage,
    sendConfig,
    confirmTool,
    interrupt,
  };
}