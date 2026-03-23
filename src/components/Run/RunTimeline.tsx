import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useRunStore } from '../../stores/runStore';
import { RunEventRecord } from '../../types';

interface RunTimelineProps {
  sessionId?: string | null;
}

const EVENT_LABELS: Record<string, string> = {
  run_started: 'Run started',
  retry_scheduled: 'Retry scheduled',
  tool_call_requested: 'Tool requested',
  tool_execution_started: 'Tool started',
  tool_execution_completed: 'Tool completed',
  skill_catalog_prepared: 'Skills indexed',
  skill_loaded: 'Skill loaded',
  run_completed: 'Run completed',
  run_failed: 'Run failed',
  run_interrupted: 'Run interrupted',
  run_max_rounds_reached: 'Max rounds reached',
};

const EMPTY_RUN_SESSION = {
  events: [],
  currentRunId: undefined,
  status: 'idle' as const,
};

function formatEventDetails(event: RunEventRecord): string | null {
  const toolName = typeof event.payload.tool_name === 'string' ? event.payload.tool_name : null;
  const attempt = typeof event.payload.attempt === 'number' ? event.payload.attempt : null;
  const hitCount = typeof event.payload.hit_count === 'number' ? event.payload.hit_count : null;
  const skillName = typeof event.payload.skill_name === 'string' ? event.payload.skill_name : null;
  const skillNames = Array.isArray(event.payload.skill_names)
    ? event.payload.skill_names.filter((value): value is string => typeof value === 'string')
    : [];

  if (toolName) {
    return toolName;
  }
  if (skillName) {
    return skillName;
  }
  if (skillNames.length > 0) {
    return skillNames.join(', ');
  }
  if (attempt !== null) {
    return `attempt ${attempt}`;
  }
  if (hitCount !== null) {
    return hitCount === 1 ? '1 hit' : `${hitCount} hits`;
  }
  return null;
}

function eventTone(eventType: string): string {
  if (eventType === 'run_failed' || eventType === 'run_interrupted') {
    return 'text-red-600 dark:text-red-400';
  }
  if (eventType === 'run_completed') {
    return 'text-green-600 dark:text-green-400';
  }
  return 'text-gray-600 dark:text-gray-300';
}

export const RunTimeline: React.FC<RunTimelineProps> = ({ sessionId }) => {
  const session = useRunStore(
    useShallow((state) => (sessionId ? state.sessions[sessionId] || EMPTY_RUN_SESSION : EMPTY_RUN_SESSION))
  );
  const timelineEvents = useMemo(() => session.events.slice(-8), [session.events]);

  if (!sessionId) {
    return (
      <div className="flex h-full min-h-56 items-center justify-center rounded-[1.5rem] border border-dashed border-gray-300 bg-gray-50/80 px-6 py-8 text-center dark:border-gray-700 dark:bg-gray-950/40">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">No session selected</h3>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Select or create a session to see its run timeline here.
          </p>
        </div>
      </div>
    );
  }

  if (session.events.length === 0) {
    return (
      <div className="flex h-full min-h-56 items-center justify-center rounded-[1.5rem] border border-dashed border-gray-300 bg-gray-50/80 px-6 py-8 text-center dark:border-gray-700 dark:bg-gray-950/40">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">No runs yet</h3>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Start a run in this session and recent events will appear here.
          </p>
        </div>
      </div>
    );
  }

  const latestEvent = session.events[session.events.length - 1];
  const latestLabel = EVENT_LABELS[latestEvent.event_type] || latestEvent.event_type;
  const latestDetails = formatEventDetails(latestEvent);

  return (
    <div className="rounded-[1.5rem] border border-gray-200/80 bg-gray-50/80 p-5 dark:border-gray-700/80 dark:bg-gray-950/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              Run Timeline
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
            const label = EVENT_LABELS[event.event_type] || event.event_type;
            const details = formatEventDetails(event);

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
                  {new Date(event.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
