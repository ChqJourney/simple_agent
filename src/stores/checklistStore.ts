import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChecklistRowOverride } from '../utils/checklistResults';

interface ChecklistSessionState {
  rowOverrides: Record<string, ChecklistRowOverride>;
  dismissedNoticeSignature?: string;
}

interface ChecklistState {
  sessions: Record<string, ChecklistSessionState>;
  upsertRowOverride: (
    sessionId: string,
    rowKey: string,
    patch: Partial<ChecklistRowOverride>
  ) => void;
  clearRowOverride: (sessionId: string, rowKey: string) => void;
  markNoticeDismissed: (sessionId: string, signature: string) => void;
}

function createEmptyChecklistSession(): ChecklistSessionState {
  return {
    rowOverrides: {},
    dismissedNoticeSignature: undefined,
  };
}

function normalizeOverride(
  previous: ChecklistRowOverride | undefined,
  patch: Partial<ChecklistRowOverride>
): ChecklistRowOverride {
  return {
    ...previous,
    ...patch,
  };
}

export const useChecklistStore = create<ChecklistState>()(
  persist(
    (set) => ({
      sessions: {},

      upsertRowOverride: (sessionId, rowKey, patch) => set((state) => {
        const session = state.sessions[sessionId] || createEmptyChecklistSession();
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              rowOverrides: {
                ...session.rowOverrides,
                [rowKey]: normalizeOverride(session.rowOverrides[rowKey], patch),
              },
            },
          },
        };
      }),

      clearRowOverride: (sessionId, rowKey) => set((state) => {
        const session = state.sessions[sessionId];
        if (!session?.rowOverrides[rowKey]) {
          return state;
        }

        const nextOverrides = { ...session.rowOverrides };
        delete nextOverrides[rowKey];

        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              rowOverrides: nextOverrides,
            },
          },
        };
      }),

      markNoticeDismissed: (sessionId, signature) => set((state) => {
        const session = state.sessions[sessionId] || createEmptyChecklistSession();
        if (session.dismissedNoticeSignature === signature) {
          return state;
        }

        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              dismissedNoticeSignature: signature,
            },
          },
        };
      }),
    }),
    {
      name: 'checklist-ui-storage',
      partialize: (state) => ({
        sessions: state.sessions,
      }),
    }
  )
);
