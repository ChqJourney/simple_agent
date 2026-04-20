import React, { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useBeforeUnload, useNavigate, useParams } from 'react-router-dom';
import {
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  useRunStore,
  useWorkspaceStore,
  useUIStore,
  useSessionStore,
} from '../stores';
import { TopBar, LeftPanel, RightPanel } from '../components/Workspace';
import { ChatContainer } from '../components/Chat';
import { RunTimeline } from '../components/Run';
import { useWebSocket } from '../contexts/WebSocketContext';
import { backendHealthUrl, backendHttpBase } from '../utils/backendEndpoint';
import { buildChecklistResultViewModel } from '../utils/checklistResults';
import { loadSessionHistory } from '../utils/storage';
import { useChatStore } from '../stores/chatStore';
import { RunEventRecord } from '../types';
import { useI18n } from '../i18n';

const IS_DEV = import.meta.env.DEV;

interface AuthorizedWorkspacePath {
  canonical_path: string;
}

type ResizeSide = 'left' | 'right';

function hasTransientChatState(session: {
  isStreaming: boolean;
  currentStreamingContent: string;
  currentReasoningContent: string;
  assistantStatus: string;
  pendingToolConfirm?: unknown;
  queuedToolConfirms?: unknown[];
  pendingQuestion?: unknown;
  queuedQuestions?: unknown[];
}): boolean {
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

function hasActiveCompactionState(events: RunEventRecord[] | undefined): boolean {
  if (!events || events.length === 0) {
    return false;
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event.event_type.startsWith('session_compaction_')) {
      continue;
    }

    return event.event_type === 'session_compaction_started';
  }

  return false;
}

function getLeaveWorkspacePrompt(
  hasActiveReply: boolean,
  hasActiveCompaction: boolean,
  t: ReturnType<typeof useI18n>['t']
): string {
  if (hasActiveReply && hasActiveCompaction) {
    return t('workspace.leave.streamingAndCompaction');
  }

  if (hasActiveReply) {
    return t('workspace.leave.streaming');
  }

  if (hasActiveCompaction) {
    return t('workspace.leave.compaction');
  }

  return t('workspace.leave.generic');
}

function normalizeComparableWorkspacePath(path: string): string {
  const normalizedSeparators = path.replace(/\\/g, '/');
  const hasDriveLetter = /^[A-Za-z]:/.test(normalizedSeparators);
  const parts = normalizedSeparators.split('/');
  const stack: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }

    if (part === '..') {
      const last = stack[stack.length - 1];
      if (last && last !== '..') {
        stack.pop();
        continue;
      }
    }

    stack.push(part);
  }

  const normalizedPath = stack.join('/');
  if (hasDriveLetter) {
    return normalizedPath.toLowerCase();
  }

  return normalizedSeparators.startsWith('/') ? `/${normalizedPath}` : normalizedPath;
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

function clampPanelWidth(width: number): number {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(width)));
}

export const WorkspacePage: React.FC = () => {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { workspaces, setCurrentWorkspace, currentWorkspace, syncWorkspacePath } = useWorkspaceStore();
  const {
    leftPanelCollapsed,
    leftPanelWidth,
    rightPanelCollapsed,
    rightPanelWidth,
    rightPanelTab,
    setLeftPanelWidth,
    setRightPanelCollapsed,
    setRightPanelTab,
    resetLeftPanelWidth,
    setRightPanelWidth,
    resetRightPanelWidth,
    setPageLoading,
  } = useUIStore();
  const { isConnected, sendWorkspace, interrupt } = useWebSocket();
  const { loadSessionsFromDisk, setCurrentSession, currentSessionId, sessions } = useSessionStore();
  const chatSessions = useChatStore((state) => state.sessions);
  const runSessions = useRunStore((state) => state.sessions);
  const [backendReady, setBackendReady] = useState(!IS_DEV);
  const [workspaceAccessError, setWorkspaceAccessError] = useState<string | null>(null);
  const [isTimelineModalOpen, setIsTimelineModalOpen] = useState(false);
  const [leftPanelPreviewWidth, setLeftPanelPreviewWidth] = useState<number | null>(null);
  const [rightPanelPreviewWidth, setRightPanelPreviewWidth] = useState<number | null>(null);
  const prevWorkspaceIdRef = useRef<string | null>(null);
  const workspaceLoadRequestIdRef = useRef(0);
  const activeResizeSideRef = useRef<ResizeSide | null>(null);
  const leaveNavigationPendingRef = useRef(false);
  const autoFocusedChecklistSessionsRef = useRef<Set<string>>(new Set());

  const effectiveLeftPanelWidth = leftPanelPreviewWidth ?? leftPanelWidth;
  const effectiveRightPanelWidth = rightPanelPreviewWidth ?? rightPanelWidth;
  const activeSessionMeta = currentSessionId
    ? sessions.find((session) => session.session_id === currentSessionId)
    : undefined;
  const activeSessionMessages = currentSessionId
    ? chatSessions[currentSessionId]?.messages || []
    : [];
  const checklistResult = buildChecklistResultViewModel({
    scenarioId: activeSessionMeta?.scenario_id,
    messages: activeSessionMessages,
  });
  const hasChecklistResult = Boolean(checklistResult);
  const isChecklistPanelFocused = hasChecklistResult && !rightPanelCollapsed && rightPanelTab === 'checklist';
  const normalizedWorkspacePath = currentWorkspace?.path
    ? normalizeComparableWorkspacePath(currentWorkspace.path)
    : null;
  const leaveGuardState = Array.from(
    new Set([
      ...Object.keys(chatSessions),
      ...Object.keys(runSessions),
    ])
  ).reduce(
    (acc, sessionId) => {
      const chatSession = chatSessions[sessionId];
      const runSession = runSessions[sessionId];
      const hasReply = Boolean(chatSession && hasTransientChatState(chatSession));
      const hasCompaction = hasActiveCompactionState(runSession?.events);

      if (!hasReply && !hasCompaction) {
        return acc;
      }

      let belongsToWorkspace = false;
      if (currentSessionId && sessionId === currentSessionId) {
        belongsToWorkspace = true;
      } else if (normalizedWorkspacePath) {
        const sessionMeta = sessions.find((session) => session.session_id === sessionId);
        if (sessionMeta?.workspace_path) {
          belongsToWorkspace =
            normalizeComparableWorkspacePath(sessionMeta.workspace_path) === normalizedWorkspacePath;
        }
      }

      if (!belongsToWorkspace) {
        return acc;
      }

      acc.sessionIds.push(sessionId);
      acc.hasActiveReply = acc.hasActiveReply || hasReply;
      acc.hasActiveCompaction = acc.hasActiveCompaction || hasCompaction;
      return acc;
    },
    {
      sessionIds: [] as string[],
      hasActiveReply: false,
      hasActiveCompaction: false,
    }
  );
  const activeWorkspaceSessionIds = leaveGuardState.sessionIds;
  const hasActiveReply = leaveGuardState.hasActiveReply;
  const hasActiveCompaction = leaveGuardState.hasActiveCompaction;
  const hasActiveWorkspaceRuns = activeWorkspaceSessionIds.length > 0;
  useBeforeUnload((event) => {
    if (!hasActiveWorkspaceRuns) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
  });

  const confirmLeaveWorkspace = async () => {
    if (!hasActiveWorkspaceRuns) {
      return true;
    }

    const prompt = getLeaveWorkspacePrompt(hasActiveReply, hasActiveCompaction, t);
    const confirmed = hasTauriRuntime()
      ? await (async () => {
          const { confirm } = await import('@tauri-apps/plugin-dialog');
          return confirm(prompt, {
            title: t('workspace.leave.confirmTitle'),
            kind: 'warning',
            okLabel: t('workspace.leave.confirmOk'),
            cancelLabel: t('workspace.leave.confirmCancel'),
          });
        })()
      : window.confirm(prompt);
    if (!confirmed) {
      return false;
    }

    activeWorkspaceSessionIds.forEach((sessionId) => {
      interrupt(sessionId);
    });
    return true;
  };

  const handleNavigateHome = () => {
    if (leaveNavigationPendingRef.current) {
      return;
    }

    leaveNavigationPendingRef.current = true;
    void (async () => {
      try {
        if (!(await confirmLeaveWorkspace())) {
          return;
        }
        navigate('/');
      } finally {
        leaveNavigationPendingRef.current = false;
      }
    })();
  };

  useEffect(() => {
    if (workspaceId && workspaceId !== prevWorkspaceIdRef.current) {
      prevWorkspaceIdRef.current = workspaceId;
      const workspace = workspaces.find((w) => w.id === workspaceId);
      if (workspace) {
        setCurrentWorkspace(workspace);
      } else {
        setPageLoading(false);
        navigate('/');
      }
    }
  }, [workspaceId, workspaces, setCurrentWorkspace, setPageLoading, navigate]);

  useEffect(() => {
    let cancelled = false;

    const loadWorkspaceData = async () => {
      const workspaceId = currentWorkspace?.id;
      const workspacePath = currentWorkspace?.path;
      const requestId = ++workspaceLoadRequestIdRef.current;
      const isLatestRequest = () => workspaceLoadRequestIdRef.current === requestId;
      const matchesWorkspaceSnapshot = () => {
        const latestWorkspace = useWorkspaceStore.getState().currentWorkspace;
        return latestWorkspace?.id === workspaceId && latestWorkspace?.path === workspacePath;
      };

      if (!workspaceId || !workspacePath) {
        return;
      }

      try {
        setWorkspaceAccessError(null);
        const authorizedWorkspace = await invoke<AuthorizedWorkspacePath>('authorize_workspace_path', {
          selectedPath: workspacePath,
        });
        if (cancelled || !isLatestRequest() || !matchesWorkspaceSnapshot()) {
          return;
        }
        const authorizedPath = authorizedWorkspace.canonical_path;

        if (authorizedPath !== workspacePath) {
          syncWorkspacePath(workspaceId, authorizedPath);
        }

        const latestWorkspace = useWorkspaceStore.getState().currentWorkspace;
        if (
          cancelled ||
          !isLatestRequest() ||
          latestWorkspace?.id !== workspaceId ||
          (latestWorkspace?.path !== workspacePath && latestWorkspace?.path !== authorizedPath)
        ) {
          return;
        }

        setCurrentSession(null);
        await loadSessionsFromDisk(authorizedPath);

        if (cancelled || !isLatestRequest() || !matchesWorkspaceSnapshot()) {
          return;
        }

        const { currentSessionId: nextSessionId, sessions } = useSessionStore.getState();
        const nextSession = nextSessionId
          ? sessions.find((session) => session.session_id === nextSessionId && session.workspace_path === authorizedPath)
          : undefined;

        if (nextSessionId && nextSession) {
          const messages = await loadSessionHistory(authorizedPath, nextSessionId);

          if (cancelled || !isLatestRequest() || !matchesWorkspaceSnapshot()) {
            return;
          }

          useChatStore.getState().loadSession(nextSessionId, messages);
        }
      } catch (error) {
        console.error('Failed to prepare workspace:', error);
        if (!cancelled) {
          setWorkspaceAccessError(
            error instanceof Error ? error.message : t('workspace.accessError')
          );
        }
      } finally {
        if (!cancelled) {
          setPageLoading(false);
        }
      }
    };

    void loadWorkspaceData();

    return () => {
      cancelled = true;
    };
  }, [
    workspaceId,
    currentWorkspace?.id,
    currentWorkspace?.path,
    loadSessionsFromDisk,
    setCurrentSession,
    setPageLoading,
    syncWorkspacePath,
  ]);

  useEffect(() => {
    if (isConnected && currentWorkspace?.path) {
      sendWorkspace(currentWorkspace.path);
    }
  }, [isConnected, currentWorkspace?.path, sendWorkspace]);

  useEffect(() => {
    if (IS_DEV && !backendReady) {
      const checkBackend = async () => {
        try {
          const response = await fetch(backendHealthUrl);
          if (response.ok) {
            setBackendReady(true);
          }
        } catch {
          console.log('Backend not ready, retrying...');
        }
      };

      void checkBackend();
      const interval = setInterval(checkBackend, 2000);
      return () => clearInterval(interval);
    }
  }, [backendReady]);

  useEffect(() => {
    if (!isTimelineModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsTimelineModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTimelineModalOpen]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (activeResizeSideRef.current === 'left') {
        setLeftPanelPreviewWidth(clampPanelWidth(event.clientX));
      } else if (activeResizeSideRef.current === 'right') {
        setRightPanelPreviewWidth(clampPanelWidth(window.innerWidth - event.clientX));
      }
    };

    const handleMouseUp = () => {
      const activeSide = activeResizeSideRef.current;
      if (!activeSide) {
        return;
      }

      if (activeSide === 'left' && leftPanelPreviewWidth !== null) {
        setLeftPanelWidth(leftPanelPreviewWidth);
      }
      if (activeSide === 'right' && rightPanelPreviewWidth !== null) {
        setRightPanelWidth(rightPanelPreviewWidth);
      }

      setLeftPanelPreviewWidth(null);
      setRightPanelPreviewWidth(null);
      activeResizeSideRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [leftPanelPreviewWidth, rightPanelPreviewWidth, setLeftPanelWidth, setRightPanelWidth]);

  useEffect(() => {
    if (!currentSessionId || !hasChecklistResult) {
      return;
    }

    if (autoFocusedChecklistSessionsRef.current.has(currentSessionId)) {
      return;
    }

    autoFocusedChecklistSessionsRef.current.add(currentSessionId);
    setRightPanelCollapsed(false);
    setRightPanelTab('checklist');
  }, [currentSessionId, hasChecklistResult, setRightPanelCollapsed, setRightPanelTab]);

  const startResize = (side: ResizeSide) => (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    activeResizeSideRef.current = side;
    if (side === 'left') {
      setLeftPanelPreviewWidth(leftPanelWidth);
    } else {
      setRightPanelPreviewWidth(rightPanelWidth);
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  if (!currentWorkspace) {
    return (
      <div className="flex h-screen items-center justify-center bg-white dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400">{t('workspace.loading')}</div>
      </div>
    );
  }
  return (
    <div className="flex h-screen flex-col bg-gray-100 dark:bg-gray-950">
      <TopBar onOpenTimeline={() => setIsTimelineModalOpen(true)} onBackHome={handleNavigateHome} />

      <div className="flex flex-1 overflow-hidden">
        {!leftPanelCollapsed && (
          <div
            data-testid="workspace-left-panel"
            className="bg-white/70 dark:bg-gray-900/60"
            style={{ width: `${effectiveLeftPanelWidth}px`, minWidth: `${effectiveLeftPanelWidth}px` }}
          >
            <LeftPanel />
          </div>
        )}

        {!leftPanelCollapsed && (
          <div
            data-testid="workspace-left-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('workspace.resizeLeftPanel')}
            className="w-1 cursor-col-resize bg-transparent transition-colors hover:bg-blue-200/70 dark:hover:bg-blue-900/70"
            onMouseDown={startResize('left')}
            onDoubleClick={resetLeftPanelWidth}
          />
        )}

        <main
          data-testid="workspace-main-panel"
          className={[
            'relative flex-1 overflow-hidden transition-colors duration-300',
            hasChecklistResult
              ? 'border-r border-sky-200/80 shadow-[inset_-18px_0_30px_-28px_rgba(14,116,144,0.7)] dark:border-sky-900/80 dark:shadow-[inset_-18px_0_30px_-28px_rgba(56,189,248,0.35)]'
              : '',
          ].join(' ')}
        >
          {workspaceAccessError ? (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-red-700 dark:text-red-200">
              <div className="max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900 dark:bg-red-950">
                {workspaceAccessError}
              </div>
            </div>
          ) : IS_DEV && !backendReady ? (
            <div className="flex-1 flex items-center justify-center p-4 bg-yellow-50 dark:bg-yellow-950 text-yellow-900 dark:text-yellow-200 text-center text-sm">
              <div>
                {t('workspace.backendWaiting', { url: backendHttpBase })}
                <br />
                <code className="text-xs bg-yellow-100 dark:bg-yellow-900 px-1.5 py-0.5 rounded">
                  {t('workspace.backendWaitingCommand')}
                </code>
              </div>
            </div>
          ) : (
            <ChatContainer />
          )}
        </main>

        {!rightPanelCollapsed && (
          <div
            data-testid="workspace-right-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('workspace.resizeRightPanel')}
            className={[
              'w-1 cursor-col-resize bg-transparent transition-colors',
              isChecklistPanelFocused
                ? 'bg-sky-300/70 hover:bg-sky-400/80 dark:bg-sky-700/80 dark:hover:bg-sky-600/80'
                : hasChecklistResult
                  ? 'hover:bg-sky-200/70 dark:hover:bg-sky-900/70'
                  : 'hover:bg-blue-200/70 dark:hover:bg-blue-900/70',
            ].join(' ')}
            onMouseDown={startResize('right')}
            onDoubleClick={resetRightPanelWidth}
          />
        )}

        {!rightPanelCollapsed && (
          <div
            data-testid="workspace-right-panel"
            className={[
              'bg-white/70 transition-all duration-300 dark:bg-gray-900/60',
              isChecklistPanelFocused
                ? 'border-l border-sky-200/90 shadow-[-20px_0_40px_-32px_rgba(14,116,144,0.75)] dark:border-sky-900/90 dark:shadow-[-20px_0_40px_-32px_rgba(56,189,248,0.45)]'
                : hasChecklistResult
                  ? 'border-l border-sky-100/80 dark:border-sky-950/80'
                  : '',
            ].join(' ')}
            style={{ width: `${effectiveRightPanelWidth}px`, minWidth: `${effectiveRightPanelWidth}px` }}
          >
            <RightPanel />
          </div>
        )}
      </div>

      {isTimelineModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/55 p-4 backdrop-blur-sm"
          onClick={() => setIsTimelineModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('workspace.timeline')}
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.75rem] border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('workspace.timeline')}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('workspace.timelineSubtitle')}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsTimelineModalOpen(false)}
                className="rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                aria-label={t('workspace.closeRunTimeline')}
                title={t('workspace.closeRunTimeline')}
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <RunTimeline sessionId={currentSessionId} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
