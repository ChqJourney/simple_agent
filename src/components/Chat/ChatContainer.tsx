import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useI18n } from '../../i18n';
import { useChatStore } from '../../stores/chatStore';
import { useChecklistStore } from '../../stores/checklistStore';
import { useConfigStore } from '../../stores/configStore';
import { useRunStore } from '../../stores/runStore';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useSession } from '../../hooks/useSession';
import { Attachment, ExecutionMode, Message, PendingQuestion, ToolDecision, ToolDecisionScope } from '../../types';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { ScenarioBadgeBar, ScenarioOption } from './ScenarioBadgeBar';
import { ChecklistResultNotice } from '../Checklist';
import { PendingQuestionCard, ToolConfirmModal } from '../Tools';
import {
  hasConfiguredModelProfile,
  hasRunnableConversationProfile,
  resolveProfileForRole,
  supportsImageAttachmentsForRole,
} from '../../utils/config';
import { buildChecklistResultViewModel, createChecklistResultSignature } from '../../utils/checklistResults';

const emptySession = {
  messages: [] as never[],
  streamingContent: '',
  reasoningContent: '',
  isStreaming: false,
  assistantStatus: 'idle' as const,
  currentToolName: undefined as string | undefined,
  currentToolArgumentCharacters: undefined as number | undefined,
  pendingToolConfirm: undefined as { tool_call_id: string; name: string; arguments: Record<string, unknown> } | undefined,
  pendingQuestion: undefined as PendingQuestion | undefined,
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  glm: 'GLM',
  minimax: 'MiniMax',
  qwen: 'Qwen',
};

export const ChatContainer = () => {
  const { t } = useI18n();
  const { currentSessionId, createSession, updateSessionScenario } = useSession();
  const { sendMessage, answerQuestion, isConnected, confirmTool, interrupt, setExecutionMode } = useWebSocket();
  const { currentWorkspace } = useWorkspaceStore();
  const rightPanelCollapsed = useUIStore((state) => state.rightPanelCollapsed);
  const rightPanelTab = useUIStore((state) => state.rightPanelTab);
  const setRightPanelCollapsed = useUIStore((state) => state.setRightPanelCollapsed);
  const setRightPanelTab = useUIStore((state) => state.setRightPanelTab);
  const config = useConfigStore((state) => state.config);
  const dismissedNoticeSignature = useChecklistStore((state) => (
    currentSessionId
      ? state.sessions[currentSessionId]?.dismissedNoticeSignature
      : undefined
  ));
  const markNoticeDismissed = useChecklistStore((state) => state.markNoticeDismissed);
  const updateSession = useSessionStore((state) => state.updateSession);
  const activeSessionMeta = useSessionStore((state) => (
    currentSessionId
      ? state.sessions.find((session) => session.session_id === currentSessionId)
      : undefined
  ));
  const [sessionExecutionModes, setSessionExecutionModes] = useState<Record<string, ExecutionMode>>({});
  const [draftExecutionMode, setDraftExecutionMode] = useState<ExecutionMode>('regular');
  const primaryProfile = resolveProfileForRole(config, 'conversation');
  const hasConfiguredModel = hasConfiguredModelProfile(primaryProfile);
  const hasRunnableConfig = hasRunnableConversationProfile(config);
  const lockedModel = activeSessionMeta?.locked_model;
  const isSessionModelMismatch = Boolean(
    lockedModel
    && primaryProfile?.provider
    && primaryProfile?.model
    && (
      lockedModel.provider !== primaryProfile.provider
      || lockedModel.model !== primaryProfile.model
    )
  );
  const canSendMessage = isConnected && hasRunnableConfig && Boolean(currentWorkspace?.path) && !isSessionModelMismatch;
  const supportsImageAttachments = supportsImageAttachmentsForRole(config, 'conversation');
  const lockedProviderLabel = lockedModel ? (PROVIDER_LABELS[lockedModel.provider] || lockedModel.provider) : '';
  const configuredProviderLabel = primaryProfile?.provider
    ? (PROVIDER_LABELS[primaryProfile.provider] || primaryProfile.provider)
    : '';
  const composerPlaceholder = !hasConfiguredModel
    ? t('chat.input.configureModel')
    : isSessionModelMismatch && lockedModel
      ? t('chat.input.sessionLockedPlaceholder', {
          provider: lockedProviderLabel,
          model: lockedModel.model,
        })
    : hasRunnableConfig
      ? t('chat.input.placeholder')
      : t('chat.input.addApiKey');

  const {
    messages,
    streamingContent,
    reasoningContent,
    isStreaming,
    assistantStatus,
    currentToolName,
    currentToolArgumentCharacters,
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
        currentToolArgumentCharacters: session.currentToolArgumentCharacters,
        pendingToolConfirm: session.pendingToolConfirm,
        pendingQuestion: session.pendingQuestion,
      } : emptySession;
    })
  );
  const runEvents = useRunStore(
    useShallow((state) => (
      currentSessionId
        ? state.sessions[currentSessionId]?.events || []
        : []
    ))
  );
  const activeScenarioId = activeSessionMeta?.scenario_id ?? 'default';
  const checklistResult = buildChecklistResultViewModel({
    scenarioId: activeScenarioId,
    messages,
  });
  const checklistResultSignature = checklistResult
    ? createChecklistResultSignature(checklistResult)
    : null;
  const isChecklistPanelFocused = Boolean(
    checklistResult && !rightPanelCollapsed && rightPanelTab === 'checklist'
  );
  const showChecklistNotice = Boolean(
    currentSessionId
    && checklistResult
    && checklistResultSignature
    && dismissedNoticeSignature !== checklistResultSignature
    && !isChecklistPanelFocused
  );
  const scenarioOptions: ScenarioOption[] = [
    {
      id: 'default',
      label: t('scenario.default'),
      description: t('scenario.defaultDesc'),
    },
    {
      id: 'standard_qa',
      label: t('scenario.standardQa'),
      description: t('scenario.standardQaDesc'),
    },
    {
      id: 'checklist_evaluation',
      label: t('scenario.checklistEvaluation'),
      description: t('scenario.checklistEvaluationDesc'),
    },
  ];

  const handleSend = useCallback((content: string, attachments?: Attachment[], displayContent?: string) => {
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
    useChatStore.getState().addUserMessage(sessionId, displayContent ?? content, attachments);
    sendMessage(sessionId, content, attachments, currentWorkspace?.path);
  }, [canSendMessage, config, currentSessionId, createSession, draftExecutionMode, sendMessage, currentWorkspace?.path, sessionExecutionModes, setExecutionMode, updateSession]);

  const handleRetryMessage = useCallback((message: Pick<Message, 'content' | 'attachments'>) => {
    if (isStreaming || !canSendMessage) {
      return;
    }

    handleSend(message.content || '', message.attachments, message.content || '');
  }, [canSendMessage, handleSend, isStreaming]);

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

  const isCurrentSessionEmpty = Boolean(
    !currentSessionId
    || (
      messages.length === 0
      && !isStreaming
      && !streamingContent
      && !reasoningContent
      && !pendingToolConfirm
      && !pendingQuestion
    )
  );

  const handleScenarioSelect = useCallback((scenarioId: ScenarioOption['id']) => {
    const scenario = scenarioOptions.find((option) => option.id === scenarioId);
    if (!scenario) {
      return;
    }

    if (currentSessionId && isCurrentSessionEmpty) {
      updateSessionScenario(currentSessionId, {
        id: scenario.id,
        version: 1,
        label: scenario.label,
      });
      return;
    }

    createSession({
      id: scenario.id,
      version: 1,
      label: scenario.label,
    });
  }, [createSession, currentSessionId, isCurrentSessionEmpty, scenarioOptions, updateSessionScenario]);

  const handleToolDecision = useCallback((decision: ToolDecision, scope: ToolDecisionScope = 'session') => {
    if (!currentSessionId || !pendingToolConfirm) return;
    const sent = confirmTool(currentSessionId, pendingToolConfirm.tool_call_id, decision, scope);
    if (sent) {
      useChatStore.getState().clearPendingToolConfirm(currentSessionId, pendingToolConfirm.tool_call_id);
    }
  }, [confirmTool, currentSessionId, pendingToolConfirm]);

  const handleInterrupt = useCallback(() => {
    if (!currentSessionId || !isStreaming) return;
    interrupt(currentSessionId);
  }, [currentSessionId, interrupt, isStreaming]);

  const handleQuestionAnswer = useCallback((answer: string) => {
    if (!currentSessionId || !pendingQuestion || pendingQuestion.status === 'submitting') return;
    useChatStore.getState().markPendingQuestionSubmitting(currentSessionId, pendingQuestion.tool_call_id);
    const sent = answerQuestion(currentSessionId, pendingQuestion.tool_call_id, answer, 'submit');
    if (!sent) {
      useChatStore.getState().markPendingQuestionIdle(currentSessionId, pendingQuestion.tool_call_id);
    }
  }, [answerQuestion, currentSessionId, pendingQuestion]);

  const handleDismissQuestion = useCallback(() => {
    if (!currentSessionId || !pendingQuestion || pendingQuestion.status === 'submitting') return;
    useChatStore.getState().markPendingQuestionSubmitting(currentSessionId, pendingQuestion.tool_call_id);
    const sent = answerQuestion(currentSessionId, pendingQuestion.tool_call_id, undefined, 'dismiss');
    if (!sent) {
      useChatStore.getState().markPendingQuestionIdle(currentSessionId, pendingQuestion.tool_call_id);
    }
  }, [answerQuestion, currentSessionId, pendingQuestion]);

  const handleOpenChecklistPanel = useCallback(() => {
    if (rightPanelCollapsed) {
      setRightPanelCollapsed(false);
    }
    setRightPanelTab('checklist');
    if (currentSessionId && checklistResultSignature) {
      markNoticeDismissed(currentSessionId, checklistResultSignature);
    }
  }, [
    checklistResultSignature,
    currentSessionId,
    markNoticeDismissed,
    rightPanelCollapsed,
    setRightPanelCollapsed,
    setRightPanelTab,
  ]);

  const handleDismissChecklistNotice = useCallback(() => {
    if (!currentSessionId || !checklistResultSignature) {
      return;
    }
    markNoticeDismissed(currentSessionId, checklistResultSignature);
  }, [checklistResultSignature, currentSessionId, markNoticeDismissed]);

  useEffect(() => {
    if (!currentSessionId || !checklistResultSignature || !isChecklistPanelFocused) {
      return;
    }

    markNoticeDismissed(currentSessionId, checklistResultSignature);
  }, [checklistResultSignature, currentSessionId, isChecklistPanelFocused, markNoticeDismissed]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.08),_transparent_45%)] dark:bg-[radial-gradient(circle_at_top,_rgba(142,160,182,0.14),_transparent_38%)]">
      {checklistResult && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-sky-200/35 via-sky-100/10 to-transparent dark:from-sky-500/15 dark:via-sky-500/5"
        />
      )}

      <MessageList
        messages={messages}
        currentStreamingContent={streamingContent}
        currentReasoningContent={reasoningContent}
        isStreaming={isStreaming}
        assistantStatus={assistantStatus}
        currentToolName={currentToolName}
        currentToolArgumentCharacters={currentToolArgumentCharacters}
        runEvents={runEvents}
        onRetryMessage={handleRetryMessage}
      />

      {showChecklistNotice && checklistResult && (
        <ChecklistResultNotice
          result={checklistResult}
          onOpenChecklist={handleOpenChecklistPanel}
          onDismiss={handleDismissChecklistNotice}
        />
      )}

      {pendingQuestion && (
        <PendingQuestionCard
          question={pendingQuestion}
          onSubmitAnswer={handleQuestionAnswer}
          onDismiss={handleDismissQuestion}
        />
      )}

      {isSessionModelMismatch && lockedModel && primaryProfile?.model && (
        <div className="mx-4 mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>
              {t('chat.input.sessionLockedNotice', {
                sessionProvider: lockedProviderLabel,
                sessionModel: lockedModel.model,
                configProvider: configuredProviderLabel,
                configModel: primaryProfile.model,
              })}
            </p>
            <button
              type="button"
              onClick={() => {
                createSession();
              }}
              className="shrink-0 rounded-xl bg-amber-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-950 dark:bg-amber-100 dark:text-amber-950 dark:hover:bg-white"
            >
              {t('sessions.new')}
            </button>
          </div>
        </div>
      )}

      <ScenarioBadgeBar
        scenarios={scenarioOptions}
        activeScenarioId={activeScenarioId}
        onSelect={handleScenarioSelect}
        disabled={!currentWorkspace?.path}
      />

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
