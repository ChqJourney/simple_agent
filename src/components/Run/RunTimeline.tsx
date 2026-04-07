import React, { useMemo } from 'react';
import { useI18n } from '../../i18n';
import { useShallow } from 'zustand/react/shallow';
import { useRunStore } from '../../stores/runStore';
import { formatRunEventDetails } from '../../utils/runTimeline';

interface RunTimelineProps {
  sessionId?: string | null;
}

const EMPTY_RUN_SESSION = {
  events: [],
  currentRunId: undefined,
  status: 'idle' as const,
};

function eventTone(eventType: string): string {
  if (eventType === 'run_failed' || eventType === 'run_interrupted' || eventType === 'session_compaction_failed') {
    return 'text-red-600 dark:text-red-400';
  }
  if (eventType === 'run_completed' || eventType === 'session_compaction_completed') {
    return 'text-green-600 dark:text-green-400';
  }
  return 'text-gray-600 dark:text-gray-300';
}

export const RunTimeline: React.FC<RunTimelineProps> = ({ sessionId }) => {
  const { t, formatTime } = useI18n();
  const session = useRunStore(
    useShallow((state) => (sessionId ? state.sessions[sessionId] || EMPTY_RUN_SESSION : EMPTY_RUN_SESSION))
  );
  const timelineEvents = useMemo(() => session.events.slice(-8), [session.events]);

  if (!sessionId) {
    return (
      <div className="flex h-full min-h-56 items-center justify-center rounded-[1.5rem] border border-dashed border-gray-300 bg-gray-50/80 px-6 py-8 text-center dark:border-gray-700 dark:bg-gray-950/40">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{t('timeline.emptyTitle')}</h3>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {t('timeline.emptyBody')}
          </p>
        </div>
      </div>
    );
  }

  if (session.events.length === 0) {
    return (
      <div className="flex h-full min-h-56 items-center justify-center rounded-[1.5rem] border border-dashed border-gray-300 bg-gray-50/80 px-6 py-8 text-center dark:border-gray-700 dark:bg-gray-950/40">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{t('timeline.noRunsTitle')}</h3>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {t('timeline.noRunsBody')}
          </p>
        </div>
      </div>
    );
  }

  const latestEvent = session.events[session.events.length - 1];
  const latestLabel = t(`timeline.event.${latestEvent.event_type}` as const);
  const latestDetails = formatRunEventDetails(latestEvent, t);

  return (
    <div className="rounded-[1.5rem] border border-gray-200/80 bg-gray-50/80 p-5 dark:border-gray-700/80 dark:bg-gray-950/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              {t('timeline.title')}
            </h2>
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600 shadow-sm dark:bg-gray-800 dark:text-gray-300">
              {session.status}
            </span>
          </div>
          <div className="mt-2 text-base font-semibold text-gray-900 dark:text-gray-100">
            {latestLabel}
            {latestDetails ? ` - ${latestDetails}` : ''}
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-gray-200/70 pt-4 dark:border-gray-800">
        <div className="space-y-3">
          {timelineEvents.map((event) => {
            const label = t(`timeline.event.${event.event_type}` as const);
            const details = formatRunEventDetails(event, t);

            return (
              <div
                key={`${event.run_id}-${event.timestamp}-${event.event_type}`}
                className="flex items-start gap-3 text-sm"
              >
                <div className="mt-1 h-2.5 w-2.5 rounded-full bg-blue-500/80" />
                <div className="min-w-0 flex-1">
                  <div className={`font-medium ${eventTone(event.event_type)}`}>{label}</div>
                  {details && (
                    <div className="truncate text-xs text-gray-500 dark:text-gray-400">{details}</div>
                  )}
                </div>
                <div className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                  {formatTime(event.timestamp)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
