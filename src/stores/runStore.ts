import { create } from 'zustand';
import { RunEventRecord } from '../types';

export type RunLifecycleStatus = 'idle' | 'running' | 'completed' | 'failed' | 'interrupted';

interface RunSessionState {
  events: RunEventRecord[];
  currentRunId?: string;
  status: RunLifecycleStatus;
}

interface RunState {
  sessions: Record<string, RunSessionState>;
  addEvent: (sessionId: string, event: RunEventRecord) => void;
  clearSession: (sessionId: string) => void;
}

const createEmptyRunSession = (): RunSessionState => ({
  events: [],
  currentRunId: undefined,
  status: 'idle',
});

function deriveStatus(eventType: string, previousStatus: RunLifecycleStatus): RunLifecycleStatus {
  switch (eventType) {
    case 'run_started':
      return 'running';
    case 'run_completed':
      return 'completed';
    case 'run_failed':
      return 'failed';
    case 'run_interrupted':
      return 'interrupted';
    default:
      return previousStatus === 'idle' ? 'running' : previousStatus;
  }
}

export const useRunStore = create<RunState>((set) => ({
  sessions: {},

  addEvent: (sessionId, event) => set((state) => {
    const session = state.sessions[sessionId] || createEmptyRunSession();

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          events: [...session.events, event],
          currentRunId: event.run_id,
          status: deriveStatus(event.event_type, session.status),
        },
      },
    };
  }),

  clearSession: (sessionId) => set((state) => {
    const { [sessionId]: _removed, ...rest } = state.sessions;
    return { sessions: rest };
  }),
}));
