import React from 'react';
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

  if (session.events.length === 0) {
    return null;
  }

  return (
    <div className="mx-5 mt-4 rounded-2xl border border-gray-200/70 bg-white/70 px-4 py-3 backdrop-blur md:mx-6 dark:border-gray-700/70 dark:bg-gray-900/60">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
          Run Timeline
        </h2>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {session.status}
        </span>
      </div>

      <div className="space-y-2">
        {session.events.slice(-8).map((event) => {
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
    </div>
  );
};
