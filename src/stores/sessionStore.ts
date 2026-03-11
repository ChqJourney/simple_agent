import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { scanSessions } from '../utils/storage';

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
  removeSession: (sessionId: string, workspacePath: string) => void;
  getSessionsByWorkspace: (workspacePath: string) => SessionMeta[];
  loadSessionsFromDisk: (workspacePath: string) => Promise<void>;
  ensureSession: (workspacePath: string) => void;
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

      removeSession: (sessionId, workspacePath) => {
        const state = get();
        const workspaceSessions = state.sessions.filter(s => s.workspace_path === workspacePath);
        
        if (workspaceSessions.length <= 1) {
          return;
        }
        
        const newSessionId = uuidv4();
        const now = new Date().toISOString();
        
        set({
          sessions: state.sessions.filter(s => s.session_id !== sessionId),
          currentSessionId: state.currentSessionId === sessionId ? newSessionId : state.currentSessionId,
        });
        
        if (state.sessions.filter(s => s.workspace_path === workspacePath).length === 1) {
          get().addSession({
            session_id: newSessionId,
            workspace_path: workspacePath,
            created_at: now,
            updated_at: now,
          });
        }
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
          
          const existingIds = new Set(fixedSessions.map(s => s.session_id));
          
          const newSessions = diskSessions.filter(s => !existingIds.has(s.session_id));
          
          if (newSessions.length > 0 || JSON.stringify(fixedSessions) !== JSON.stringify(state.sessions)) {
            set({ sessions: [...fixedSessions, ...newSessions] });
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