import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { Message, AssistantStatus, RunEventRecord } from '../../types';
import { MessageItem } from './MessageItem';
import { AssistantTurn } from './AssistantTurn';
import { DelegatedWorkerViewModel } from './DelegatedWorkerCards';

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

interface DelegatedTaskOutput {
  event: 'delegated_task';
  summary?: string;
  data?: unknown;
  expected_output?: string;
  worker?: {
    profile_name?: string;
    provider?: string;
    model?: string;
  };
}

interface DelegatedWorkerAccumulator {
  toolCallId: string;
  order: number;
  taskLabel?: string;
  status?: DelegatedWorkerViewModel['status'];
  expectedOutput?: string;
  summary?: string;
  data?: unknown;
  error?: string | null;
  startedAt?: string;
  completedAt?: string;
  workerProfileName?: string;
  workerProvider?: string;
  workerModel?: string;
}

const TERMINAL_RUN_EVENT_TYPES = new Set(['run_completed', 'run_failed', 'run_interrupted']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

function parseDelegatedTaskOutput(value: unknown): DelegatedTaskOutput | null {
  if (!isRecord(value) || value.event !== 'delegated_task') {
    return null;
  }

  const worker = isRecord(value.worker) ? value.worker : undefined;

  return {
    event: 'delegated_task',
    summary: typeof value.summary === 'string' ? value.summary : undefined,
    data: value.data,
    expected_output: typeof value.expected_output === 'string' ? value.expected_output : undefined,
    worker: worker
      ? {
          profile_name: typeof worker.profile_name === 'string' ? worker.profile_name : undefined,
          provider: typeof worker.provider === 'string' ? worker.provider : undefined,
          model: typeof worker.model === 'string' ? worker.model : undefined,
        }
      : undefined,
  };
}

function parseDelegatedTaskOutputFromMessage(message: Message): DelegatedTaskOutput | null {
  if (
    message.role !== 'tool'
    || message.name !== 'delegate_task'
    || message.toolMessage?.kind !== 'result'
  ) {
    return null;
  }

  const parsedFromRawOutput = parseDelegatedTaskOutput(message.toolMessage.output);
  if (parsedFromRawOutput) {
    return parsedFromRawOutput;
  }

  const rawDetails = message.toolMessage.details.trim();
  if (!rawDetails.startsWith('{')) {
    return null;
  }

  try {
    return parseDelegatedTaskOutput(JSON.parse(rawDetails));
  } catch {
    return null;
  }
}

function buildDelegatedWorkers(
  assistantMessages: Message[],
  runEvents: RunEventRecord[],
  now: number,
  t: ReturnType<typeof useI18n>['t'],
): DelegatedWorkerViewModel[] {
  const workers = new Map<string, DelegatedWorkerAccumulator>();
  let nextOrder = 0;

  const ensureWorker = (toolCallId: string): DelegatedWorkerAccumulator => {
    const existing = workers.get(toolCallId);
    if (existing) {
      return existing;
    }

    const created: DelegatedWorkerAccumulator = {
      toolCallId,
      order: nextOrder,
    };
    nextOrder += 1;
    workers.set(toolCallId, created);
    return created;
  };

  assistantMessages.forEach((message) => {
    if (message.role === 'assistant') {
      message.tool_calls?.forEach((toolCall) => {
        if (toolCall.name !== 'delegate_task') {
          return;
        }
        ensureWorker(toolCall.tool_call_id);
      });
    }

    if (message.role === 'tool' && message.name === 'delegate_task' && message.tool_call_id) {
      ensureWorker(message.tool_call_id);
    }
  });

  if (workers.size === 0) {
    return [];
  }

  runEvents.forEach((event) => {
    if (event.event_type !== 'delegated_task_started' && event.event_type !== 'delegated_task_completed') {
      return;
    }

    const toolCallId = typeof event.payload.tool_call_id === 'string' ? event.payload.tool_call_id : undefined;
    if (!toolCallId || !workers.has(toolCallId)) {
      return;
    }

    const worker = ensureWorker(toolCallId);
    if (event.event_type === 'delegated_task_started') {
      if (typeof event.payload.task === 'string' && event.payload.task.trim()) {
        worker.taskLabel = event.payload.task.trim();
      }
      if (typeof event.payload.expected_output === 'string' && event.payload.expected_output.trim()) {
        worker.expectedOutput = event.payload.expected_output.trim();
      }
      worker.startedAt = worker.startedAt || event.timestamp;
      if (!worker.status) {
        worker.status = 'running';
      }
      return;
    }

    worker.completedAt = event.timestamp;
    if (typeof event.payload.worker_profile_name === 'string') {
      worker.workerProfileName = event.payload.worker_profile_name;
    }
    if (typeof event.payload.worker_provider === 'string') {
      worker.workerProvider = event.payload.worker_provider;
    }
    if (typeof event.payload.worker_model === 'string') {
      worker.workerModel = event.payload.worker_model;
    }
    if (typeof event.payload.error === 'string' && event.payload.error.trim()) {
      worker.error = event.payload.error;
    }

    worker.status = event.payload.success === false ? 'failed' : 'completed';
  });

  assistantMessages.forEach((message) => {
    if (message.role !== 'tool' || message.name !== 'delegate_task' || !message.tool_call_id) {
      return;
    }

    const worker = ensureWorker(message.tool_call_id);
    const delegatedOutput = parseDelegatedTaskOutputFromMessage(message);
    if (!worker.completedAt && message.timestamp) {
      worker.completedAt = message.timestamp;
    }

    if (message.status === 'error') {
      worker.status = 'failed';
    } else if (worker.status !== 'failed') {
      worker.status = worker.completedAt ? 'completed' : worker.status;
    }

    if (message.toolMessage?.kind === 'result' && typeof message.toolMessage.error === 'string' && message.toolMessage.error.trim()) {
      worker.error = message.toolMessage.error;
    }

    if (!delegatedOutput) {
      return;
    }

    if (delegatedOutput.summary) {
      worker.summary = delegatedOutput.summary;
      if (!worker.taskLabel) {
        worker.taskLabel = delegatedOutput.summary;
      }
    }
    if (typeof delegatedOutput.data !== 'undefined') {
      worker.data = delegatedOutput.data;
    }
    if (delegatedOutput.expected_output) {
      worker.expectedOutput = delegatedOutput.expected_output;
    }
    if (delegatedOutput.worker?.profile_name) {
      worker.workerProfileName = delegatedOutput.worker.profile_name;
    }
    if (delegatedOutput.worker?.provider) {
      worker.workerProvider = delegatedOutput.worker.provider;
    }
    if (delegatedOutput.worker?.model) {
      worker.workerModel = delegatedOutput.worker.model;
    }
  });

  return Array.from(workers.values())
    .sort((left, right) => {
      const leftStart = parseTimestamp(left.startedAt);
      const rightStart = parseTimestamp(right.startedAt);
      if (leftStart !== null && rightStart !== null && leftStart !== rightStart) {
        return leftStart - rightStart;
      }
      if (leftStart !== null && rightStart === null) {
        return -1;
      }
      if (leftStart === null && rightStart !== null) {
        return 1;
      }
      return left.order - right.order;
    })
    .map((worker) => {
      const startedAt = parseTimestamp(worker.startedAt);
      const completedAt = parseTimestamp(worker.completedAt);
      const elapsedMs = startedAt !== null
        ? ((completedAt ?? now) - startedAt)
        : Number.NaN;
      const status = worker.status || (completedAt !== null ? 'completed' : 'running');

      return {
        toolCallId: worker.toolCallId,
        taskLabel: worker.taskLabel || t('chat.delegated.task'),
        status,
        statusLabel:
          status === 'running'
            ? t('chat.delegated.running')
            : status === 'failed'
              ? t('chat.assistant.failed')
              : t('chat.assistant.completed'),
        elapsedLabel: formatElapsedLabel(elapsedMs),
        expectedOutput: worker.expectedOutput,
        summary: worker.summary,
        data: worker.data,
        error: worker.error,
        startedAt: worker.startedAt,
        completedAt: worker.completedAt,
        workerProfileName: worker.workerProfileName,
        workerProvider: worker.workerProvider,
        workerModel: worker.workerModel,
      };
    });
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
  const { t } = useI18n();
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

  const delegatedWorkersByGroup = groups.map((group) => buildDelegatedWorkers(group.assistantMessages, runEvents, now, t));

  return (
    <div
      ref={listRef}
      data-testid="message-list-scroll"
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-5 py-6 md:px-8"
    >
      {messages.length === 0 && !isStreaming && (
        <div className="text-center text-gray-500 dark:text-gray-400 py-8">
          <p>{t('chat.messageList.empty')}</p>
        </div>
      )}

      <div className="space-y-5">
        {groups.map((group, index) => {
          const delegatedWorkers = delegatedWorkersByGroup[index] || [];
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
                  delegatedWorkers={delegatedWorkers}
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
