import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { AssistantStatus, Message } from '../../types';
import { markdownComponents, markdownRemarkPlugins, parseMarkdown } from '../../utils/markdown';
import { ReasoningBlock } from '../Reasoning/ReasoningBlock';
import { ToolCallDisplay, ToolMessageDisplay } from '../Tools';
import { MessageItem } from './MessageItem';
import { AssistantStatusIndicator } from './AssistantStatusIndicator';
import { CopyMessageButton } from './CopyMessageButton';
import { DelegatedWorkerCards, DelegatedWorkerViewModel } from './DelegatedWorkerCards';

interface AssistantTurnProps {
  messages: Message[];
  delegatedWorkers?: DelegatedWorkerViewModel[];
  isStreaming?: boolean;
  streamingContent?: string;
  currentReasoningContent?: string;
  assistantStatus?: AssistantStatus;
  currentToolName?: string;
  elapsedLabel?: string;
  onRetry?: () => void;
}

function hasVisibleToolResult(message: Message, hiddenToolCallIds: Set<string>): boolean {
  if (message.role !== 'tool') {
    return false;
  }

  return !(message.tool_call_id && hiddenToolCallIds.has(message.tool_call_id));
}

function getVisibleToolCalls(message: Message, hiddenToolCallIds: Set<string>) {
  return (message.tool_calls || []).filter((toolCall) => !hiddenToolCallIds.has(toolCall.tool_call_id));
}

function hasVisibleDetailContent(message: Message, hiddenToolCallIds: Set<string>): boolean {
  if (message.role === 'reasoning') {
    return Boolean(message.content);
  }

  if (message.role === 'tool') {
    return hasVisibleToolResult(message, hiddenToolCallIds);
  }

  if (message.role === 'assistant') {
    return Boolean(message.content) || getVisibleToolCalls(message, hiddenToolCallIds).length > 0;
  }

  return false;
}

function getRoundDetailsLabel(
  messages: Message[],
  hasStreamingReasoning: boolean,
  hiddenToolCallIds: Set<string>,
): string {
  let reasoningCount = hasStreamingReasoning ? 1 : 0;
  let toolCallCount = 0;
  let toolResultCount = 0;
  let userActionCount = 0;

  messages.forEach((message) => {
    if (message.role === 'reasoning') {
      reasoningCount += 1;
      return;
    }

    if (message.role === 'assistant' && message.tool_calls?.length) {
      toolCallCount += getVisibleToolCalls(message, hiddenToolCallIds).length;
      return;
    }

    if (message.role === 'tool') {
      if (message.tool_call_id && hiddenToolCallIds.has(message.tool_call_id)) {
        return;
      }
      if (message.toolMessage?.kind === 'decision') {
        userActionCount += 1;
        return;
      }
      toolResultCount += 1;
    }
  });

  const parts: string[] = [];
  if (reasoningCount > 0) {
    parts.push(`thinking ${reasoningCount}`);
  }
  if (toolCallCount > 0) {
    parts.push(`tool calls ${toolCallCount}`);
  }
  if (toolResultCount > 0) {
    parts.push(`tool results ${toolResultCount}`);
  }
  if (userActionCount > 0) {
    parts.push(`user actions ${userActionCount}`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'Round details';
}

function renderToolMessage(message: Message) {
  return <ToolMessageDisplay message={message} collapsible={false} />;
}

function renderDetailMessage(message: Message, hiddenToolCallIds: Set<string>) {
  if (message.role === 'reasoning') {
    return <ReasoningBlock content={message.content || ''} collapsible={false} defaultExpanded={true} />;
  }

  if (message.role === 'tool') {
    if (message.tool_call_id && hiddenToolCallIds.has(message.tool_call_id)) {
      return null;
    }
    return renderToolMessage(message);
  }

  if (message.role === 'assistant') {
    const hasContent = Boolean(message.content);
    const visibleToolCalls = getVisibleToolCalls(message, hiddenToolCallIds);
    const hasToolCalls = visibleToolCalls.length > 0;
    if (!hasContent && !hasToolCalls) {
      return null;
    }

    return (
      <div className="rounded-2xl border border-gray-200/80 bg-white/70 p-4 dark:border-gray-700/80 dark:bg-gray-900/50">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
            Assistant activity
          </div>
          {hasContent && <CopyMessageButton text={message.content || ''} />}
        </div>
        {hasContent && (
          <div className="prose prose-sm mt-3 max-w-none text-gray-900 leading-relaxed dark:prose-invert dark:text-gray-100">
            <ReactMarkdown components={markdownComponents} remarkPlugins={markdownRemarkPlugins}>
              {parseMarkdown(message.content || '')}
            </ReactMarkdown>
          </div>
        )}
        {hasToolCalls && (
          <div className={`${hasContent ? 'mt-3' : 'mt-3'} space-y-2`}>
            {visibleToolCalls.map((toolCall) => (
              <ToolCallDisplay
                key={toolCall.tool_call_id}
                toolCall={toolCall}
                collapsible={false}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}

export const AssistantTurn = ({
  messages,
  delegatedWorkers = [],
  isStreaming = false,
  streamingContent = '',
  currentReasoningContent = '',
  assistantStatus,
  currentToolName,
  elapsedLabel,
  onRetry,
}: AssistantTurnProps) => {
  const hiddenDelegatedToolCallIds = useMemo(
    () => new Set(delegatedWorkers.map((worker) => worker.toolCallId)),
    [delegatedWorkers],
  );
  const formalAssistantIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (
        message.role === 'assistant'
        && (!message.tool_calls || message.tool_calls.length === 0)
        && (
          Boolean(message.content?.trim())
          || message.status === 'error'
          || Boolean(message.usage)
        )
      ) {
        return index;
      }
    }

    return -1;
  }, [messages]);

  const formalAssistantMessage = formalAssistantIndex >= 0 ? messages[formalAssistantIndex] : undefined;
  const detailMessages = messages.filter((_, index) => index !== formalAssistantIndex);
  const visibleDetailMessages = detailMessages.filter((message) => hasVisibleDetailContent(message, hiddenDelegatedToolCallIds));
  const hasFormalContent = Boolean(formalAssistantMessage) || Boolean(streamingContent);
  const hasDelegatedWorkers = delegatedWorkers.length > 0;
  const hasHeader = hasFormalContent || hasDelegatedWorkers;
  const hasDetails = visibleDetailMessages.length > 0 || Boolean(currentReasoningContent);
  const copyableContent = streamingContent.trim() || formalAssistantMessage?.content?.trim() || '';
  const isFailedTurn = formalAssistantMessage?.status === 'error';
  const [isExpanded, setIsExpanded] = useState(isStreaming);
  const wasStreamingRef = useRef(isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setIsExpanded(true);
    } else if (wasStreamingRef.current) {
      setIsExpanded(false);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const detailsLabel = getRoundDetailsLabel(
    detailMessages,
    Boolean(currentReasoningContent),
    hiddenDelegatedToolCallIds,
  );

  return (
    <div className="w-full">
      {hasHeader && (
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold text-xs text-gray-600 dark:text-gray-400">
            Assistant
          </span>
          <div className="flex items-center gap-2">
            {elapsedLabel && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {elapsedLabel}
              </span>
            )}
            {formalAssistantMessage?.usage && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {formalAssistantMessage.usage.total_tokens} tokens
              </span>
            )}
            {copyableContent && <CopyMessageButton text={copyableContent} />}
          </div>
        </div>
      )}

      {hasDetails && (
        <div className={`${hasFormalContent ? '' : 'mt-2'} rounded-xl border border-gray-200/80 bg-gray-50/85 p-4 dark:border-gray-700/80 dark:bg-gray-900/50`}>
          <button
            type="button"
            onClick={() => setIsExpanded((value) => !value)}
            className="flex w-full items-center justify-between gap-3 text-left text-sm text-gray-600 transition-colors hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
            aria-expanded={isExpanded}
          >
            <span className="font-medium">{detailsLabel}</span>
            <svg
              className={`h-4 w-4 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {isExpanded && (
            <div className="mt-4 space-y-3 border-t border-gray-200/80 pt-4 dark:border-gray-700/80">
              {visibleDetailMessages.map((message) => {
                const content = renderDetailMessage(message, hiddenDelegatedToolCallIds);
                if (!content) {
                  return null;
                }

                return (
                  <div key={message.id}>
                    {content}
                  </div>
                );
              })}

              {currentReasoningContent && (
                <div className="rounded-2xl border border-gray-200/80 bg-white/70 p-4 dark:border-gray-700/80 dark:bg-gray-900/50">
                  <ReasoningBlock content={currentReasoningContent} collapsible={false} defaultExpanded={true} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {formalAssistantMessage ? (
        <div className={hasDetails ? 'mt-3' : ''}>
          <MessageItem
            message={formalAssistantMessage}
            assistantStatus={assistantStatus}
            currentToolName={currentToolName}
            hideHeader={hasFormalContent}
          />
        </div>
      ) : isStreaming && streamingContent ? (
        <div className={hasDetails ? 'mt-3' : ''}>
          <MessageItem
            message={{
              id: 'streaming-turn',
              role: 'assistant',
              content: '',
              status: 'streaming',
            }}
            isStreaming={true}
            streamingContent={streamingContent}
            assistantStatus={assistantStatus}
            currentToolName={currentToolName}
            hideHeader={hasFormalContent}
          />
        </div>
      ) : null}

      {hasDelegatedWorkers && (
        <div className={(hasFormalContent || hasDetails) ? 'mt-3' : 'mt-2'}>
          <DelegatedWorkerCards workers={delegatedWorkers} />
        </div>
      )}

      {isFailedTurn && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-red-200/80 bg-red-50/80 px-3 py-2 text-xs text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
          <div className="flex items-center gap-2">
            <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M18 10A8 8 0 114 4.73V3a1 1 0 10-2 0v4a1 1 0 001 1h4a1 1 0 100-2H5.22A6 6 0 1010 4a1 1 0 100-2 8 8 0 018 8zm-8-3a1 1 0 00-1 1v3a1 1 0 102 0V8a1 1 0 00-1-1zm0 8a1.25 1.25 0 100-2.5A1.25 1.25 0 0010 15z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">Failed</span>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-200 bg-white/80 text-red-600 transition-colors hover:bg-white hover:text-red-700 dark:border-red-800 dark:bg-red-950/20 dark:text-red-300 dark:hover:bg-red-950/40"
              aria-label="Resend message"
              title="Resend message"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M4.93 4.93a7 7 0 111.06 9.04 1 1 0 10-1.68 1.08A9 9 0 1010 1a1 1 0 100 2 7 7 0 00-5.07 1.93V3a1 1 0 10-2 0v4a1 1 0 001 1h4a1 1 0 000-2H4.93z" />
              </svg>
            </button>
          )}
        </div>
      )}

      {!hasFormalContent && !hasDelegatedWorkers && assistantStatus && (
        <div className="space-y-2">
          {elapsedLabel && (
            <div className="text-xs text-gray-400 dark:text-gray-500">
              {elapsedLabel}
            </div>
          )}
          <AssistantStatusIndicator status={assistantStatus} toolName={currentToolName} />
        </div>
      )}
    </div>
  );
};
