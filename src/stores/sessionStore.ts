import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { deleteSessionHistory, scanSessions } from '../utils/storage';
import { LockedModelRef } from '../types';

interface SessionMeta {
  session_id: string;
  workspace_path: string;
  created_at: string;
  updated_at: string;
  title?: string;
  locked_model?: LockedModelRef;
}

interface SessionState {
  sessions: SessionMeta[];
  currentSessionId: string | null;

  setCurrentSession: (sessionId: string | null) => void;
  addSession: (session: SessionMeta) => void;
  updateSession: (sessionId: string, updates: Partial<SessionMeta>) => void;
  removeSession: (sessionId: string, workspacePath: string) => Promise<string | null>;
  getSessionsByWorkspace: (workspacePath: string) => SessionMeta[];
  loadSessionsFromDisk: (workspacePath: string) => Promise<void>;
  ensureSession: (workspacePath: string) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,

      setCurrentSession: (sessionId) => set({
        currentSessionId: sessionId,
      }),

      addSession: (session) => set((state) => {
        const exists = state.sessions.some(s => s.session_id === session.session_id);
        if (exists) {
          return { currentSessionId: session.session_id };
        }
        return {
          sessions: [...state.sessions, session],
          currentSessionId: session.session_id,
        };
      }),

      updateSession: (sessionId, updates) => set((state) => ({
        sessions: state.sessions.map(s =>
          s.session_id === sessionId ? { ...s, ...updates } : s
        ),
      })),

      removeSession: async (sessionId, workspacePath) => {
        await deleteSessionHistory(workspacePath, sessionId);

        const state = get();
        const remainingSessions = state.sessions.filter(s => s.session_id !== sessionId);
        const workspaceSessions = remainingSessions.filter(s => s.workspace_path === workspacePath);

        let nextSessionId = state.currentSessionId === sessionId
          ? (workspaceSessions[0]?.session_id ?? null)
          : state.currentSessionId;

        if (workspaceSessions.length === 0) {
          const replacementSessionId = uuidv4();
          const now = new Date().toISOString();
          const replacementSession: SessionMeta = {
            session_id: replacementSessionId,
            workspace_path: workspacePath,
            created_at: now,
            updated_at: now,
          };

          set({
            sessions: [...remainingSessions, replacementSession],
            currentSessionId: replacementSessionId,
          });

          return replacementSessionId;
        }

        set({
          sessions: remainingSessions,
          currentSessionId: nextSessionId,
        });

        return nextSessionId;
      },

      getSessionsByWorkspace: (workspacePath) => {
        return get().sessions.filter(s => s.workspace_path === workspacePath);
      },

      ensureSession: (workspacePath) => {
        const state = get();
        const workspaceSessions = state.sessions.filter(s => s.workspace_path === workspacePath);

        if (workspaceSessions.length === 0) {
          const sessionId = uuidv4();
          const now = new Date().toISOString();

          set({
            sessions: [...state.sessions, {
              session_id: sessionId,
              workspace_path: workspacePath,
              created_at: now,
              updated_at: now,
            }],
            currentSessionId: sessionId,
          });
        }
      },

      loadSessionsFromDisk: async (workspacePath) => {
        try {
          const diskSessions = await scanSessions(workspacePath);

          const state = get();

          const fixedSessions = state.sessions.map(s =>
            s.workspace_path === '.' || !s.workspace_path
              ? { ...s, workspace_path: workspacePath }
              : s
          );

          const diskSessionMap = new Map(diskSessions.map((session) => [session.session_id, session]));
          const mergedSessions = fixedSessions.map((session) =>
            diskSessionMap.get(session.session_id)
              ? { ...session, ...diskSessionMap.get(session.session_id) }
              : session
          );
          const existingIds = new Set(mergedSessions.map(s => s.session_id));
          const newSessions = diskSessions.filter(s => !existingIds.has(s.session_id));
          mergedSessions.push(...newSessions);
          const workspaceSessions = mergedSessions.filter(s => s.workspace_path === workspacePath);
          const hasCurrentWorkspaceSession = workspaceSessions.some(
            s => s.session_id === state.currentSessionId
          );
          const nextCurrentSessionId = hasCurrentWorkspaceSession
            ? state.currentSessionId
            : (workspaceSessions[0]?.session_id ?? null);

          if (
            newSessions.length > 0 ||
            JSON.stringify(mergedSessions) !== JSON.stringify(state.sessions) ||
            nextCurrentSessionId !== state.currentSessionId
          ) {
            set({
              sessions: mergedSessions,
              currentSessionId: nextCurrentSessionId,
            });
          }

          get().ensureSession(workspacePath);
        } catch (error) {
          console.error('Failed to load sessions from disk:', error);
        }
      },
    }),
    {
      name: 'session-storage',
    }
  )
);
