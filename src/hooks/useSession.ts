import { useCallback } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useChatStore } from '../stores/chatStore';
import { v4 as uuidv4 } from 'uuid';

interface UseSessionReturn {
  currentSessionId: string | null;
  currentWorkspacePath: string | null;
  createSession: () => string;
  switchSession: (sessionId: string) => void;
  clearCurrentSession: () => void;
}

export function useSession(): UseSessionReturn {
  const { 
    currentSessionId, 
    currentWorkspacePath,
    setCurrentSession,
    addSession,
  } = useSessionStore();
  const { clearSession } = useChatStore();

  const createSession = useCallback((): string => {
    const sessionId = uuidv4();
    const now = new Date().toISOString();
    const workspacePath = currentWorkspacePath || '.';

    addSession({
      session_id: sessionId,
      workspace_path: workspacePath,
      created_at: now,
      updated_at: now,
    });

    return sessionId;
  }, [currentWorkspacePath, addSession]);

  const switchSession = useCallback((sessionId: string) => {
    setCurrentSession(sessionId);
  }, [setCurrentSession]);

  const clearCurrentSession = useCallback(() => {
    if (currentSessionId) {
      clearSession(currentSessionId);
      setCurrentSession(null);
    }
  }, [currentSessionId, clearSession, setCurrentSession]);

  return {
    currentSessionId,
    currentWorkspacePath,
    createSession,
    switchSession,
    clearCurrentSession,
  };
}