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
  deleteSession: (sessionId: string) => Promise<string | null>;
  clearCurrentSession: () => void;
}

export function useSession(): UseSessionReturn {
  const {
    currentSessionId,
    setCurrentSession,
    addSession,
    removeSession,
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

  const deleteSession = useCallback(async (sessionId: string) => {
    const workspacePath = currentWorkspace?.path;
    if (!workspacePath) {
      console.error('useSession: no workspace path available for deletion');
      return null;
    }

    const nextSessionId = await removeSession(sessionId, workspacePath);
    clearSession(sessionId);

    if (!nextSessionId) {
      return null;
    }

    const nextSession = useSessionStore.getState().sessions.find(s => s.session_id === nextSessionId);
    if (!nextSession) {
      loadChatSession(nextSessionId, []);
      return nextSessionId;
    }

    const messages = await loadSessionHistory(nextSession.workspace_path, nextSessionId);
    loadChatSession(nextSessionId, messages);
    return nextSessionId;
  }, [clearSession, currentWorkspace?.path, loadChatSession, removeSession]);

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
    deleteSession,
    clearCurrentSession,
  };
}
