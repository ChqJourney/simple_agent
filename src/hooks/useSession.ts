import { useCallback } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useChatStore } from '../stores/chatStore';
import { useRunStore } from '../stores/runStore';
import { useTaskStore } from '../stores/taskStore';
import { v4 as uuidv4 } from 'uuid';
import { loadSessionHistory } from '../utils/storage';
import { useWebSocket } from '../contexts/WebSocketContext';

interface UseSessionReturn {
  currentSessionId: string | null;
  createSession: () => string;
  switchSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<string | null>;
  clearCurrentSession: () => void;
}

function hasTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const tauriWindow = window as Window & {
    __TAURI_INTERNALS__?: {
      invoke?: unknown;
    };
  };

  return typeof tauriWindow.__TAURI_INTERNALS__?.invoke === 'function';
}

function hasActiveReply(session: {
  isStreaming: boolean;
  currentStreamingContent: string;
  currentReasoningContent: string;
  assistantStatus: string;
  pendingToolConfirm?: unknown;
  pendingQuestion?: unknown;
} | undefined): boolean {
  if (!session) {
    return false;
  }

  return (
    session.isStreaming
    || Boolean(session.currentStreamingContent)
    || Boolean(session.currentReasoningContent)
    || session.assistantStatus === 'waiting'
    || session.assistantStatus === 'thinking'
    || session.assistantStatus === 'streaming'
    || session.assistantStatus === 'tool_calling'
    || Boolean(session.pendingToolConfirm)
    || Boolean(session.pendingQuestion)
  );
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
  const clearRunSession = useRunStore((state) => state.clearSession);
  const clearSessionTasks = useTaskStore((state) => state.clearSessionTasks);
  const { interrupt } = useWebSocket();

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
    const previousSessionId = useSessionStore.getState().currentSessionId;
    const previousSession = previousSessionId
      ? useChatStore.getState().sessions[previousSessionId]
      : undefined;
    const shouldWarn = (
      previousSessionId
      && previousSessionId !== sessionId
      && hasActiveReply(previousSession)
    );

    if (shouldWarn) {
      const prompt = 'A reply is still streaming. Switch sessions and stop it?';
      const confirmed = hasTauriRuntime()
        ? await (async () => {
            const { confirm } = await import('@tauri-apps/plugin-dialog');
            return confirm(prompt, {
              title: 'Stop running task?',
              kind: 'warning',
              okLabel: 'Switch',
              cancelLabel: 'Stay',
            });
          })()
        : window.confirm(prompt);

      if (!confirmed) {
        return;
      }
    }

    if (shouldWarn && previousSessionId) {
      interrupt(previousSessionId);
    }

    setCurrentSession(sessionId);

    if (previousSessionId && previousSessionId !== sessionId) {
      clearSession(previousSessionId);
    }

    const session = sessions.find(s => s.session_id === sessionId);
    if (session) {
      const messages = await loadSessionHistory(session.workspace_path, sessionId);
      loadChatSession(sessionId, messages);
    }
  }, [clearSession, interrupt, setCurrentSession, sessions, loadChatSession]);

  const deleteSession = useCallback(async (sessionId: string) => {
    const workspacePath = currentWorkspace?.path;
    if (!workspacePath) {
      console.error('useSession: no workspace path available for deletion');
      return null;
    }

    const nextSessionId = await removeSession(sessionId, workspacePath);
    clearSession(sessionId);
    clearRunSession(sessionId);
    clearSessionTasks(sessionId);

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
  }, [clearRunSession, clearSession, clearSessionTasks, currentWorkspace?.path, loadChatSession, removeSession]);

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
