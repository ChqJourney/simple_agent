import React, { useState, useCallback } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useSession } from '../../hooks/useSession';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import '../../App.css';
export const ChatContainer: React.FC = () => {
  const { currentSessionId, createSession } = useSession();
  const { sendMessage, isConnected } = useWebSocket();
  const { sessions } = useChatStore();
  const [pendingToolCall, setPendingToolCall] = useState<{
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
  } | null>(null);

  const currentSession = currentSessionId ? sessions[currentSessionId] : null;
  const messages = currentSession?.messages || [];
  const streamingContent = currentSession?.currentStreamingContent || '';
  const reasoningContent = currentSession?.currentReasoningContent || '';
  const isStreaming = currentSession?.isStreaming || false;

  const handleSend = useCallback((content: string) => {
    let sessionId = currentSessionId;
    
    if (!sessionId) {
      sessionId = createSession();
    }
    
    useChatStore.getState().addUserMessage(sessionId, content);
    sendMessage(sessionId, content);
  }, [currentSessionId, createSession, sendMessage]);

  const handleConfirmTool = useCallback((approved: boolean) => {
    if (pendingToolCall) {
      const { confirmTool } = useWebSocket();
      confirmTool(pendingToolCall.toolCallId, approved);
      setPendingToolCall(null);
    }
  }, [pendingToolCall]);

  return (
    <div className="chat-container flex flex-col h-full">
      <div className="connection-status p-2 text-sm text-center">
        {isConnected ? (
          <span className="text-green-500">Connected</span>
        ) : (
          <span className="text-red-500">Disconnected</span>
        )}
      </div>
      
      <MessageList
        messages={messages}
        currentStreamingContent={streamingContent}
        currentReasoningContent={reasoningContent}
        isStreaming={isStreaming}
      />
      
      {pendingToolCall && (
        <div className="tool-confirmation p-4 bg-yellow-50 border-t border-yellow-200">
          <p className="mb-2">
            Tool call: <strong>{pendingToolCall.name}</strong>
          </p>
          <pre className="text-xs bg-gray-100 p-2 rounded mb-2 overflow-auto">
            {JSON.stringify(pendingToolCall.args, null, 2)}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={() => handleConfirmTool(true)}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
            >
              Approve
            </button>
            <button
              onClick={() => handleConfirmTool(false)}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
            >
              Reject
            </button>
          </div>
        </div>
      )}
      
      <MessageInput
        onSend={handleSend}
        disabled={!isConnected || isStreaming}
      />
    </div>
  );
};