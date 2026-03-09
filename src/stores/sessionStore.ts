import { create } from 'zustand';
import { persist } from 'zustand/middleware';


interface SessionMeta {
  session_id: string;
  workspace_path: string;
  created_at: string;
  updated_at: string;
}

interface SessionState {
  sessions: SessionMeta[];
  currentSessionId: string | null;
  currentWorkspacePath: string | null;
  
  setWorkspace: (path: string) => void;
  setCurrentSession: (sessionId: string | null) => void;
  addSession: (session: SessionMeta) => void;
  updateSession: (sessionId: string, updates: Partial<SessionMeta>) => void;
  removeSession: (sessionId: string) => void;
  getSessionsByWorkspace: (workspacePath: string) => SessionMeta[];
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,
      currentWorkspacePath: null,

      setWorkspace: (path) => set({ 
        currentWorkspacePath: path,
        currentSessionId: null,
      }),

      setCurrentSession: (sessionId) => set({ 
        currentSessionId: sessionId,
      }),

      addSession: (session) => set((state) => ({
        sessions: [...state.sessions, session],
        currentSessionId: session.session_id,
      })),

      updateSession: (sessionId, updates) => set((state) => ({
        sessions: state.sessions.map(s =>
          s.session_id === sessionId ? { ...s, ...updates } : s
        ),
      })),

      removeSession: (sessionId) => set((state) => ({
        sessions: state.sessions.filter(s => s.session_id !== sessionId),
        currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId,
      })),

      getSessionsByWorkspace: (workspacePath) => {
        return get().sessions.filter(s => s.workspace_path === workspacePath);
      },
    }),
    {
      name: 'session-storage',
    }
  )
);