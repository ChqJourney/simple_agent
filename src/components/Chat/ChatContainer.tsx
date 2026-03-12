import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '../../stores/chatStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useSession } from '../../hooks/useSession';
import { ToolDecision, ToolDecisionScope } from '../../types';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { ToolConfirmModal } from '../Tools';

const emptySession = {
  messages: [] as never[],
  streamingContent: '',
  reasoningContent: '',
  isStreaming: false,
  assistantStatus: 'idle' as const,
  currentToolName: undefined as string | undefined,
  pendingToolConfirm: undefined as { tool_call_id: string; name: string; arguments: Record<string, unknown> } | undefined,
};

export const ChatContainer = () => {
  const { currentSessionId, createSession } = useSession();
  const { sendMessage, isConnected, confirmTool, interrupt } = useWebSocket();
  const { currentWorkspace } = useWorkspaceStore();

  const {
    messages,
    streamingContent,
    reasoningContent,
    isStreaming,
    assistantStatus,
    currentToolName,
    pendingToolConfirm,
  } = useChatStore(
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
        pendingToolConfirm: session.pendingToolConfirm,
      } : emptySession;
    })
  );

  const handleSend = useCallback((content: string) => {
    let sessionId = currentSessionId;

    if (!sessionId) {
      sessionId = createSession();
    }

    useChatStore.getState().addUserMessage(sessionId, content);
    sendMessage(sessionId, content, currentWorkspace?.path);
  }, [currentSessionId, createSession, sendMessage, currentWorkspace?.path]);

  const handleToolDecision = useCallback((decision: ToolDecision, scope: ToolDecisionScope = 'session') => {
    if (!currentSessionId || !pendingToolConfirm) return;
    confirmTool(pendingToolConfirm.tool_call_id, decision, scope);
    useChatStore.getState().clearPendingToolConfirm(currentSessionId, pendingToolConfirm.tool_call_id);
  }, [confirmTool, currentSessionId, pendingToolConfirm]);

  const handleInterrupt = useCallback(() => {
    if (!currentSessionId || !isStreaming) return;
    interrupt(currentSessionId);
  }, [currentSessionId, interrupt, isStreaming]);

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

      <MessageInput
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        isStreaming={isStreaming}
        disabled={!isConnected}
      />

      {pendingToolConfirm && (
        <ToolConfirmModal
          toolCall={pendingToolConfirm}
          onDecision={handleToolDecision}
        />
      )}
    </div>
  );
};
