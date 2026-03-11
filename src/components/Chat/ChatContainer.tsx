import { useState, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '../../stores/chatStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useSession } from '../../hooks/useSession';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';

const emptySession = {
  messages: [] as never[],
  streamingContent: '',
  reasoningContent: '',
  isStreaming: false,
  assistantStatus: 'idle' as const,
  currentToolName: undefined as string | undefined,
};

export const ChatContainer = () => {
  const { currentSessionId, createSession } = useSession();
  const { sendMessage, isConnected, confirmTool } = useWebSocket();
  const { currentWorkspace } = useWorkspaceStore();
  
  const { messages, streamingContent, reasoningContent, isStreaming, assistantStatus, currentToolName } = useChatStore(
    useShallow((state) => {
      if (!currentSessionId) return emptySession;
      const session = state.sessions[currentSessionId];
      return session ? {
        messages: session.messages,
        streamingContent: session.currentStreamingContent,
        reasoningContent: session.currentReasoningContent,
        isStreaming: session.isStreaming,
        assistantStatus: session.assistantStatus,
        currentToolName: session.currentToolName,
      } : emptySession;
    })
  );
  
  const [pendingToolCall, setPendingToolCall] = useState<{
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
  } | null>(null);

  const handleSend = useCallback((content: string) => {
    let sessionId = currentSessionId;
    
    if (!sessionId) {
      sessionId = createSession();
    }
    
    useChatStore.getState().addUserMessage(sessionId, content);
    sendMessage(sessionId, content, currentWorkspace?.path);
  }, [currentSessionId, createSession, sendMessage, currentWorkspace?.path]);

  const handleConfirmTool = useCallback((approved: boolean) => {
    if (pendingToolCall) {
      confirmTool(pendingToolCall.toolCallId, approved);
      setPendingToolCall(null);
    }
  }, [pendingToolCall, confirmTool]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 text-sm text-center">
        {isConnected ? (
          <span className="text-green-600 dark:text-green-400">Connected</span>
        ) : (
          <span className="text-red-600 dark:text-red-400">Disconnected</span>
        )}
      </div>
      
      <MessageList
        messages={messages}
        currentStreamingContent={streamingContent}
        currentReasoningContent={reasoningContent}
        isStreaming={isStreaming}
        assistantStatus={assistantStatus}
        currentToolName={currentToolName}
      />
      
      {pendingToolCall && (
        <div className="p-4 bg-yellow-50 dark:bg-yellow-950 border-t border-yellow-200 dark:border-yellow-800">
          <p className="mb-2 text-yellow-900 dark:text-yellow-100">
            Tool call: <strong>{pendingToolCall.name}</strong>
          </p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded mb-2 overflow-auto text-gray-900 dark:text-gray-100">
            {JSON.stringify(pendingToolCall.args, null, 2)}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={() => handleConfirmTool(true)}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => handleConfirmTool(false)}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
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