import { useCallback } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useChatStore } from '../stores/chatStore';
import { v4 as uuidv4 } from 'uuid';
import { loadSessionHistory } from '../utils/storage';

interface UseSessionReturn {
  currentSessionId: string | null;
  createSession: () => string;
  switchSession: (sessionId: string) => Promise<void>;
  clearCurrentSession: () => void;
}

export function useSession(): UseSessionReturn {
  const { 
    currentSessionId, 
    setCurrentSession,
    addSession,
    sessions,
  } = useSessionStore();
  const { currentWorkspace } = useWorkspaceStore();
  const { clearSession, loadSession: loadChatSession } = useChatStore();

  const createSession = useCallback((): string => {
    const sessionId = uuidv4();
    const now = new Date().toISOString();
    const workspacePath = currentWorkspace?.path;

    if (!workspacePath) {
      console.error('useSession: no workspace path available');
      return sessionId;
    }

    addSession({
      session_id: sessionId,
      workspace_path: workspacePath,
      created_at: now,
      updated_at: now,
    });

    return sessionId;
  }, [currentWorkspace?.path, addSession]);

  const switchSession = useCallback(async (sessionId: string) => {
    setCurrentSession(sessionId);
    
    const session = sessions.find(s => s.session_id === sessionId);
    if (session) {
      const messages = await loadSessionHistory(session.workspace_path, sessionId);
      loadChatSession(sessionId, messages);
    }
  }, [setCurrentSession, sessions, loadChatSession]);

  const clearCurrentSession = useCallback(() => {
    if (currentSessionId) {
      clearSession(currentSessionId);
      setCurrentSession(null);
    }
  }, [currentSessionId, clearSession, setCurrentSession]);

  return {
    currentSessionId,
    createSession,
    switchSession,
    clearCurrentSession,
  };
}