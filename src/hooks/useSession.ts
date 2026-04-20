import { useCallback } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useChatStore } from '../stores/chatStore';
import { useRunStore } from '../stores/runStore';
import { useTaskStore } from '../stores/taskStore';
import { v4 as uuidv4 } from 'uuid';
import { loadSessionHistory } from '../utils/storage';
import { useWebSocket } from '../contexts/WebSocketContext';
import { ScenarioId } from '../types';

interface UseSessionReturn {
  currentSessionId: string | null;
  createSession: (scenario?: {
    id?: ScenarioId;
    version?: number;
    label?: string;
  }) => string;
  updateSessionScenario: (sessionId: string, scenario: {
    id?: ScenarioId;
    version?: number;
    label?: string;
  }) => void;
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
  queuedToolConfirms?: unknown[];
  pendingQuestion?: unknown;
  queuedQuestions?: unknown[];
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
    || session.assistantStatus === 'preparing_tool'
    || session.assistantStatus === 'tool_calling'
    || Boolean(session.pendingToolConfirm)
    || Boolean(session.queuedToolConfirms?.length)
    || Boolean(session.pendingQuestion)
    || Boolean(session.queuedQuestions?.length)
  );
}

export function useSession(): UseSessionReturn {
  const {
    currentSessionId,
    setCurrentSession,
    addSession,
    removeSession,
    sessions,
    updateSession,
  } = useSessionStore();
  const { currentWorkspace } = useWorkspaceStore();
  const { clearSession, loadSession: loadChatSession } = useChatStore();
  const clearRunSession = useRunStore((state) => state.clearSession);
  const clearSessionTasks = useTaskStore((state) => state.clearSessionTasks);
  const { interrupt, createSession: createRemoteSession, updateSessionScenario: updateRemoteSessionScenario } = useWebSocket();

  const createSession = useCallback((scenario?: { id?: ScenarioId; version?: number; label?: string }): string => {
    const sessionId = uuidv4();
    const now = new Date().toISOString();
    const workspacePath = currentWorkspace?.path;
    const scenarioId = scenario?.id ?? 'default';
    const scenarioVersion = scenario?.version ?? 1;
    const scenarioLabel = scenario?.label;

    if (!workspacePath) {
      console.error('useSession: no workspace path available');
      return sessionId;
    }

    addSession({
      session_id: sessionId,
      workspace_path: workspacePath,
      created_at: now,
      updated_at: now,
      scenario_id: scenarioId,
      scenario_version: scenarioVersion,
      scenario_label: scenarioLabel,
    });
    createRemoteSession({
      sessionId,
      workspacePath,
      scenarioId,
      scenarioVersion,
      scenarioLabel,
    });

    return sessionId;
  }, [currentWorkspace?.path, addSession, createRemoteSession]);

  const updateSessionScenario = useCallback((sessionId: string, scenario: { id?: ScenarioId; version?: number; label?: string }) => {
    const scenarioId = scenario.id ?? 'default';
    const scenarioVersion = scenario.version ?? 1;
    const scenarioLabel = scenario.label;
    updateSession(sessionId, {
      scenario_id: scenarioId,
      scenario_version: scenarioVersion,
      scenario_label: scenarioLabel,
    });
    updateRemoteSessionScenario({
      sessionId,
      workspacePath: currentWorkspace?.path,
      scenarioId,
      scenarioVersion,
      scenarioLabel,
    });
  }, [currentWorkspace?.path, updateRemoteSessionScenario, updateSession]);

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
    updateSessionScenario,
    switchSession,
    deleteSession,
    clearCurrentSession,
  };
}
