import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useRunStore } from '../../stores/runStore';
import { RunEventRecord } from '../../types';

interface RunTimelineProps {
  sessionId: string;
}

const EVENT_LABELS: Record<string, string> = {
  run_started: 'Run started',
  retry_scheduled: 'Retry scheduled',
  tool_call_requested: 'Tool requested',
  tool_execution_started: 'Tool started',
  tool_execution_completed: 'Tool completed',
  skill_resolution_completed: 'Skill resolved',
  retrieval_completed: 'Retrieval completed',
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
  const skillNames = Array.isArray(event.payload.skill_names)
    ? event.payload.skill_names.filter((value): value is string => typeof value === 'string')
    : [];

  if (toolName) {
    return toolName;
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
    useShallow((state) => state.sessions[sessionId] || EMPTY_RUN_SESSION)
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const timelineEvents = useMemo(() => session.events.slice(-8), [session.events]);

  if (session.events.length === 0) {
    return null;
  }

  const latestEvent = session.events[session.events.length - 1];
  const latestLabel = EVENT_LABELS[latestEvent.event_type] || latestEvent.event_type;
  const latestDetails = formatEventDetails(latestEvent);

  return (
    <div className="mx-5 mt-4 rounded-2xl border border-gray-200/70 bg-white/70 px-4 py-3 backdrop-blur md:mx-6 dark:border-gray-700/70 dark:bg-gray-900/60">
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? 'Collapse run timeline' : 'Expand run timeline'}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              Run Timeline
            </h2>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {session.status}
            </span>
          </div>
          <div className="mt-1 truncate text-sm font-medium text-gray-700 dark:text-gray-200">
            {latestLabel}
            {latestDetails ? ` - ${latestDetails}` : ''}
          </div>
        </div>

        <span className="shrink-0 text-xs text-blue-600 dark:text-blue-300">
          {isExpanded ? 'Hide details' : 'Show details'}
        </span>
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-2 border-t border-gray-200/70 pt-3 dark:border-gray-700/70">
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
