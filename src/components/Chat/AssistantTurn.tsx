import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { AssistantStatus, Message } from '../../types';
import { markdownComponents, markdownRemarkPlugins, parseMarkdown } from '../../utils/markdown';
import { ReasoningBlock } from '../Reasoning/ReasoningBlock';
import { ToolCallDisplay, ToolCard } from '../Tools';
import { MessageItem } from './MessageItem';
import { AssistantStatusIndicator } from './AssistantStatusIndicator';
import { CopyMessageButton } from './CopyMessageButton';

interface AssistantTurnProps {
  messages: Message[];
  isStreaming?: boolean;
  streamingContent?: string;
  currentReasoningContent?: string;
  assistantStatus?: AssistantStatus;
  currentToolName?: string;
}

function getRoundDetailsLabel(messages: Message[], hasStreamingReasoning: boolean): string {
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
      toolCallCount += message.tool_calls.length;
      return;
    }

    if (message.role === 'tool') {
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
  const toolSummary = message.content || message.name || 'Tool';

  if (message.toolMessage?.kind === 'decision') {
    const tone = message.toolMessage.decision === 'reject' ? 'danger' : 'success';

    return (
      <ToolCard summary={toolSummary} tone={tone}>
        <div className="text-xs leading-5">
          <div>scope: {message.toolMessage.scope}</div>
          {message.toolMessage.reason && message.toolMessage.reason !== 'user_action' && (
            <div>reason: {message.toolMessage.reason}</div>
          )}
        </div>
      </ToolCard>
    );
  }

  if (message.toolMessage?.kind === 'result') {
    return (
      <ToolCard summary={toolSummary}>
        <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-gray-700 dark:text-gray-300">
          {message.toolMessage.details}
        </pre>
      </ToolCard>
    );
  }

  return (
    <ToolCard summary={toolSummary}>
      {message.content && (
        <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-gray-700 dark:text-gray-300">
          {message.content}
        </pre>
      )}
    </ToolCard>
  );
}

function renderDetailMessage(message: Message) {
  if (message.role === 'reasoning') {
    return <ReasoningBlock content={message.content || ''} collapsible={false} defaultExpanded={true} />;
  }

  if (message.role === 'tool') {
    return renderToolMessage(message);
  }

  if (message.role === 'assistant') {
    const hasContent = Boolean(message.content);
    const hasToolCalls = Boolean(message.tool_calls && message.tool_calls.length > 0);
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
            {message.tool_calls?.map((toolCall) => (
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
  isStreaming = false,
  streamingContent = '',
  currentReasoningContent = '',
  assistantStatus,
  currentToolName,
}: AssistantTurnProps) => {
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
  const hasFormalContent = Boolean(formalAssistantMessage) || Boolean(streamingContent);
  const hasDetails = detailMessages.length > 0 || Boolean(currentReasoningContent);
  const copyableContent = streamingContent.trim() || formalAssistantMessage?.content?.trim() || '';
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

  const detailsLabel = getRoundDetailsLabel(detailMessages, Boolean(currentReasoningContent));

  return (
    <div className="w-full">
      {hasFormalContent && (
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold text-xs text-gray-600 dark:text-gray-400">
            Assistant
          </span>
          <div className="flex items-center gap-2">
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
              {currentReasoningContent && (
                <div className="rounded-2xl border border-gray-200/80 bg-white/70 p-4 dark:border-gray-700/80 dark:bg-gray-900/50">
                  <ReasoningBlock content={currentReasoningContent} collapsible={false} defaultExpanded={true} />
                </div>
              )}

              {detailMessages.map((message) => {
                const content = renderDetailMessage(message);
                if (!content) {
                  return null;
                }

                return (
                  <div key={message.id}>
                    {content}
                  </div>
                );
              })}
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

      {!hasFormalContent && assistantStatus && (
        <AssistantStatusIndicator status={assistantStatus} toolName={currentToolName} />
      )}
    </div>
  );
};
