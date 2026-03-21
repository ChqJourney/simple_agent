import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '../../stores/chatStore';
import { useConfigStore } from '../../stores/configStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useSession } from '../../hooks/useSession';
import { Attachment, ExecutionMode, PendingQuestion, ToolDecision, ToolDecisionScope } from '../../types';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { PendingQuestionCard, ToolConfirmModal } from '../Tools';
import { hasConfiguredModelProfile, hasRunnableConversationProfile } from '../../utils/config';
import { supportsImageInput } from '../../utils/modelCapabilities';

const emptySession = {
  messages: [] as never[],
  streamingContent: '',
  reasoningContent: '',
  isStreaming: false,
  assistantStatus: 'idle' as const,
  currentToolName: undefined as string | undefined,
  pendingToolConfirm: undefined as { tool_call_id: string; name: string; arguments: Record<string, unknown> } | undefined,
  pendingQuestion: undefined as PendingQuestion | undefined,
};

export const ChatContainer = () => {
  const { currentSessionId, createSession } = useSession();
  const { sendMessage, answerQuestion, isConnected, confirmTool, interrupt, setExecutionMode } = useWebSocket();
  const { currentWorkspace } = useWorkspaceStore();
  const config = useConfigStore((state) => state.config);
  const updateSession = useSessionStore((state) => state.updateSession);
  const [sessionExecutionModes, setSessionExecutionModes] = useState<Record<string, ExecutionMode>>({});
  const [draftExecutionMode, setDraftExecutionMode] = useState<ExecutionMode>('regular');
  const primaryProfile = config?.profiles?.primary || config;
  const hasConfiguredModel = hasConfiguredModelProfile(primaryProfile);
  const hasRunnableConfig = hasRunnableConversationProfile(config);
  const canSendMessage = isConnected && hasRunnableConfig && Boolean(currentWorkspace?.path);
  const supportsImageAttachments = primaryProfile
    ? supportsImageInput(primaryProfile.provider, primaryProfile.model)
    : false;
  const composerPlaceholder = !hasConfiguredModel
    ? 'Configure a primary model before sending messages...'
    : hasRunnableConfig
      ? 'Type your message...'
      : 'Add an API key before sending messages...';

  const {
    messages,
    streamingContent,
    reasoningContent,
    isStreaming,
    assistantStatus,
    currentToolName,
    pendingToolConfirm,
    pendingQuestion,
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
        pendingQuestion: session.pendingQuestion,
      } : emptySession;
    })
  );

  const handleSend = useCallback((content: string, attachments?: Attachment[]) => {
    if (!canSendMessage) {
      return;
    }

    let sessionId = currentSessionId;

    if (!sessionId) {
      sessionId = createSession();
    }

    if (config && sessionId) {
      const primaryProfile = config.profiles?.primary || config;
      updateSession(sessionId, {
        locked_model: {
          profile_name: primaryProfile.profile_name || 'primary',
          provider: primaryProfile.provider,
          model: primaryProfile.model,
        },
        updated_at: new Date().toISOString(),
      });
    }

    const effectiveMode = (sessionId && sessionExecutionModes[sessionId]) || draftExecutionMode;
    if (sessionId) {
      setExecutionMode(sessionId, effectiveMode);
      setSessionExecutionModes((previous) => ({
        ...previous,
        [sessionId as string]: effectiveMode,
      }));
    }

    useChatStore.getState().clearPendingQuestion(sessionId);
    useChatStore.getState().addUserMessage(sessionId, content, attachments);
    sendMessage(sessionId, content, attachments, currentWorkspace?.path);
  }, [canSendMessage, config, currentSessionId, createSession, draftExecutionMode, sendMessage, currentWorkspace?.path, sessionExecutionModes, setExecutionMode, updateSession]);

  const handleExecutionModeChange = useCallback((mode: ExecutionMode) => {
    setDraftExecutionMode(mode);
    if (!currentSessionId) {
      return;
    }
    setSessionExecutionModes((previous) => ({
      ...previous,
      [currentSessionId]: mode,
    }));
    setExecutionMode(currentSessionId, mode);
  }, [currentSessionId, setExecutionMode]);

  const activeExecutionMode = currentSessionId
    ? (sessionExecutionModes[currentSessionId] || draftExecutionMode)
    : draftExecutionMode;

  const handleToolDecision = useCallback((decision: ToolDecision, scope: ToolDecisionScope = 'session') => {
    if (!currentSessionId || !pendingToolConfirm) return;
    const sent = confirmTool(pendingToolConfirm.tool_call_id, decision, scope);
    if (sent) {
      useChatStore.getState().clearPendingToolConfirm(currentSessionId, pendingToolConfirm.tool_call_id);
    }
  }, [confirmTool, currentSessionId, pendingToolConfirm]);

  const handleInterrupt = useCallback(() => {
    if (!currentSessionId || !isStreaming) return;
    interrupt(currentSessionId);
  }, [currentSessionId, interrupt, isStreaming]);

  const handleQuestionOption = useCallback((option: string) => {
    if (!currentSessionId || !pendingQuestion || pendingQuestion.status === 'submitting') return;
    useChatStore.getState().markPendingQuestionSubmitting(currentSessionId, pendingQuestion.tool_call_id);
    const sent = answerQuestion(pendingQuestion.tool_call_id, option, 'submit');
    if (!sent) {
      useChatStore.getState().markPendingQuestionIdle(currentSessionId, pendingQuestion.tool_call_id);
    }
  }, [answerQuestion, currentSessionId, pendingQuestion]);

  const handleDismissQuestion = useCallback(() => {
    if (!currentSessionId || !pendingQuestion || pendingQuestion.status === 'submitting') return;
    useChatStore.getState().markPendingQuestionSubmitting(currentSessionId, pendingQuestion.tool_call_id);
    const sent = answerQuestion(pendingQuestion.tool_call_id, undefined, 'dismiss');
    if (!sent) {
      useChatStore.getState().markPendingQuestionIdle(currentSessionId, pendingQuestion.tool_call_id);
    }
  }, [answerQuestion, currentSessionId, pendingQuestion]);

  return (
    <div className="flex h-full flex-col bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.08),_transparent_45%)] dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_35%)]">
      <MessageList
        messages={messages}
        currentStreamingContent={streamingContent}
        currentReasoningContent={reasoningContent}
        isStreaming={isStreaming}
        assistantStatus={assistantStatus}
        currentToolName={currentToolName}
      />

      {pendingQuestion && (
        <PendingQuestionCard
          question={pendingQuestion}
          onSelectOption={handleQuestionOption}
          onDismiss={handleDismissQuestion}
        />
      )}

      <MessageInput
        onSend={handleSend}
        executionMode={activeExecutionMode}
        onExecutionModeChange={handleExecutionModeChange}
        onInterrupt={handleInterrupt}
        isStreaming={isStreaming}
        disabled={!canSendMessage}
        supportsImageAttachments={supportsImageAttachments}
        placeholder={composerPlaceholder}
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
