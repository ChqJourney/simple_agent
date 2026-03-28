import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Message, AssistantStatus, RunEventRecord } from '../../types';
import { MessageItem } from './MessageItem';
import { AssistantTurn } from './AssistantTurn';

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 32;

function isNearBottom(element: HTMLDivElement): boolean {
  return (
    element.scrollHeight - (element.scrollTop + element.clientHeight)
    <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX
  );
}

interface MessageListProps {
  messages: Message[];
  currentStreamingContent?: string;
  currentReasoningContent?: string;
  isStreaming?: boolean;
  assistantStatus?: AssistantStatus;
  currentToolName?: string;
  runEvents?: RunEventRecord[];
  onRetryMessage?: (message: Message) => void;
}

interface MessageGroup {
  user?: Message;
  assistantMessages: Message[];
}

interface RunTiming {
  startedAt?: string;
  endedAt?: string;
}

const TERMINAL_RUN_EVENT_TYPES = new Set(['run_completed', 'run_failed', 'run_interrupted']);

function parseTimestamp(timestamp?: string): number | null {
  if (!timestamp) {
    return null;
  }

  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : null;
}

function formatElapsedLabel(elapsedMs: number): string | undefined {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return undefined;
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function getCurrentRunTiming(runEvents: RunEventRecord[]): RunTiming | undefined {
  for (let index = runEvents.length - 1; index >= 0; index -= 1) {
    const event = runEvents[index];
    if (event.event_type !== 'run_started') {
      continue;
    }

    const startedAt = event.timestamp;
    let endedAt: string | undefined;

    for (let endIndex = runEvents.length - 1; endIndex > index; endIndex -= 1) {
      const candidate = runEvents[endIndex];
      if (candidate.run_id !== event.run_id || !TERMINAL_RUN_EVENT_TYPES.has(candidate.event_type)) {
        continue;
      }
      endedAt = candidate.timestamp;
      break;
    }

    return { startedAt, endedAt };
  }

  return undefined;
}

function getGroupElapsedMs(group: MessageGroup): number | undefined {
  const startCandidates = [
    parseTimestamp(group.user?.timestamp),
    ...group.assistantMessages.map((message) => parseTimestamp(message.timestamp)),
  ].filter((value): value is number => value !== null);
  const endCandidates = group.assistantMessages
    .map((message) => parseTimestamp(message.timestamp))
    .filter((value): value is number => value !== null);

  if (startCandidates.length === 0 || endCandidates.length === 0) {
    return undefined;
  }

  const startedAt = Math.min(...startCandidates);
  const endedAt = Math.max(...endCandidates);
  return endedAt >= startedAt ? endedAt - startedAt : undefined;
}

export const MessageList = memo<MessageListProps>(({
  messages,
  currentStreamingContent = '',
  currentReasoningContent = '',
  isStreaming = false,
  assistantStatus,
  currentToolName,
  runEvents = [],
  onRetryMessage,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const currentRunTiming = useMemo(() => getCurrentRunTiming(runEvents), [runEvents]);
  const [now, setNow] = useState(() => Date.now());

  const handleScroll = useCallback(() => {
    if (!listRef.current) {
      return;
    }

    shouldAutoScrollRef.current = isNearBottom(listRef.current);
  }, []);

  useEffect(() => {
    if (listRef.current && shouldAutoScrollRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, currentStreamingContent, currentReasoningContent]);

  useEffect(() => {
    const startedAt = parseTimestamp(currentRunTiming?.startedAt);
    const endedAt = parseTimestamp(currentRunTiming?.endedAt);
    if (startedAt === null || endedAt !== null) {
      return undefined;
    }

    setNow(Date.now());
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [currentRunTiming?.endedAt, currentRunTiming?.startedAt]);

  const groups: MessageGroup[] = [];
  let currentGroup: MessageGroup | null = null;

  messages.forEach((message) => {
    if (message.role === 'user') {
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = { user: message, assistantMessages: [] };
      return;
    }

    if (!currentGroup) {
      currentGroup = { assistantMessages: [] };
    }
    currentGroup.assistantMessages.push(message);
  });

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return (
    <div
      ref={listRef}
      data-testid="message-list-scroll"
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-5 py-6 md:px-8"
    >
      {messages.length === 0 && !isStreaming && (
        <div className="text-center text-gray-500 dark:text-gray-400 py-8">
          <p>Just input what you want</p>
        </div>
      )}

      <div className="space-y-5">
        {groups.map((group, index) => {
          const isLastGroup = index === groups.length - 1;
          const isActiveTurn = isLastGroup && (isStreaming || assistantStatus === 'completed');
          const historicalElapsedLabel = formatElapsedLabel(getGroupElapsedMs(group) ?? Number.NaN);
          const runStart = parseTimestamp(currentRunTiming?.startedAt);
          const runEnd = parseTimestamp(currentRunTiming?.endedAt);
          const activeElapsedLabel = runStart !== null
            ? formatElapsedLabel((runEnd ?? now) - runStart)
            : undefined;
          const elapsedLabel = isLastGroup ? activeElapsedLabel ?? historicalElapsedLabel : historicalElapsedLabel;
          const hasFailedAssistantMessage = group.assistantMessages.some(
            (message) => message.role === 'assistant' && message.status === 'error'
          );
          const retryMessage = hasFailedAssistantMessage && group.user ? group.user : undefined;

          return (
            <Fragment key={group.user?.id || `assistant-turn-${index}`}>
              {group.user && <MessageItem message={group.user} />}
              {(group.assistantMessages.length > 0 || (isStreaming && isLastGroup)) && (
                <AssistantTurn
                  messages={group.assistantMessages}
                  isStreaming={isStreaming && isLastGroup}
                  streamingContent={isActiveTurn ? currentStreamingContent : ''}
                  currentReasoningContent={isActiveTurn ? currentReasoningContent : ''}
                  assistantStatus={isActiveTurn ? assistantStatus : undefined}
                  currentToolName={isActiveTurn ? currentToolName : undefined}
                  elapsedLabel={elapsedLabel}
                  onRetry={retryMessage && onRetryMessage ? () => onRetryMessage(retryMessage) : undefined}
                />
              )}
            </Fragment>
          );
        })}

        {groups.length === 0 && isStreaming && (
          <AssistantTurn
            messages={[]}
            isStreaming={true}
            streamingContent={currentStreamingContent}
            currentReasoningContent={currentReasoningContent}
            assistantStatus={assistantStatus}
            currentToolName={currentToolName}
            elapsedLabel={formatElapsedLabel(
              (() => {
                const runStart = parseTimestamp(currentRunTiming?.startedAt);
                if (runStart === null) {
                  return Number.NaN;
                }
                const runEnd = parseTimestamp(currentRunTiming?.endedAt);
                return (runEnd ?? now) - runStart;
              })()
            )}
          />
        )}
      </div>
    </div>
  );
});

MessageList.displayName = 'MessageList';
