import React, { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useBeforeUnload, useNavigate, useParams } from 'react-router-dom';
import {
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  useWorkspaceStore,
  useUIStore,
  useSessionStore,
} from '../stores';
import { TopBar, LeftPanel, RightPanel } from '../components/Workspace';
import { ChatContainer } from '../components/Chat';
import { RunTimeline } from '../components/Run';
import { useWebSocket } from '../contexts/WebSocketContext';
import { backendHealthUrl, backendHttpBase } from '../utils/backendEndpoint';
import { loadSessionHistory } from '../utils/storage';
import { useChatStore } from '../stores/chatStore';

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
  pendingQuestion?: unknown;
}): boolean {
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
  const { workspaces, setCurrentWorkspace, currentWorkspace, syncWorkspacePath } = useWorkspaceStore();
  const {
    leftPanelCollapsed,
    leftPanelWidth,
    rightPanelCollapsed,
    rightPanelWidth,
    setLeftPanelWidth,
    resetLeftPanelWidth,
    setRightPanelWidth,
    resetRightPanelWidth,
    setPageLoading,
  } = useUIStore();
  const { isConnected, sendWorkspace, interrupt } = useWebSocket();
  const { loadSessionsFromDisk, setCurrentSession, currentSessionId, sessions } = useSessionStore();
  const chatSessions = useChatStore((state) => state.sessions);
  const [backendReady, setBackendReady] = useState(!IS_DEV);
  const [workspaceAccessError, setWorkspaceAccessError] = useState<string | null>(null);
  const [isTimelineModalOpen, setIsTimelineModalOpen] = useState(false);
  const [leftPanelPreviewWidth, setLeftPanelPreviewWidth] = useState<number | null>(null);
  const [rightPanelPreviewWidth, setRightPanelPreviewWidth] = useState<number | null>(null);
  const prevWorkspaceIdRef = useRef<string | null>(null);
  const workspaceLoadRequestIdRef = useRef(0);
  const activeResizeSideRef = useRef<ResizeSide | null>(null);
  const leaveNavigationPendingRef = useRef(false);

  const effectiveLeftPanelWidth = leftPanelPreviewWidth ?? leftPanelWidth;
  const effectiveRightPanelWidth = rightPanelPreviewWidth ?? rightPanelWidth;
  const normalizedWorkspacePath = currentWorkspace?.path
    ? normalizeComparableWorkspacePath(currentWorkspace.path)
    : null;
  const activeWorkspaceSessionIds = Array.from(
    new Set(
      Object.entries(chatSessions)
        .filter(([sessionId, chatSession]) => {
          if (!hasTransientChatState(chatSession)) {
            return false;
          }

          if (currentSessionId && sessionId === currentSessionId) {
            return true;
          }

          if (!normalizedWorkspacePath) {
            return false;
          }

          const sessionMeta = sessions.find((session) => session.session_id === sessionId);
          if (!sessionMeta?.workspace_path) {
            return false;
          }

          return normalizeComparableWorkspacePath(sessionMeta.workspace_path) === normalizedWorkspacePath;
        })
        .map(([sessionId]) => sessionId)
    )
  );
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

    const prompt = 'A task is still running. Leave this workspace and stop it?';
    const confirmed = hasTauriRuntime()
      ? await (async () => {
          const { confirm } = await import('@tauri-apps/plugin-dialog');
          return confirm(prompt, {
            title: 'Stop running task?',
            kind: 'warning',
            okLabel: 'Leave',
            cancelLabel: 'Stay',
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
            error instanceof Error ? error.message : 'Failed to access the selected workspace.'
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
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
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
            aria-label="Resize left panel"
            className="w-1 cursor-col-resize bg-transparent transition-colors hover:bg-blue-200/70 dark:hover:bg-blue-900/70"
            onMouseDown={startResize('left')}
            onDoubleClick={resetLeftPanelWidth}
          />
        )}

        <main className="flex-1 overflow-hidden">
          {workspaceAccessError ? (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-red-700 dark:text-red-200">
              <div className="max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900 dark:bg-red-950">
                {workspaceAccessError}
              </div>
            </div>
          ) : IS_DEV && !backendReady ? (
            <div className="flex-1 flex items-center justify-center p-4 bg-yellow-50 dark:bg-yellow-950 text-yellow-900 dark:text-yellow-200 text-center text-sm">
              <div>
                Waiting for Python backend at {backendHttpBase}...
                <br />
                <code className="text-xs bg-yellow-100 dark:bg-yellow-900 px-1.5 py-0.5 rounded">
                  cd python_backend && python main.py
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
            aria-label="Resize right panel"
            className="w-1 cursor-col-resize bg-transparent transition-colors hover:bg-blue-200/70 dark:hover:bg-blue-900/70"
            onMouseDown={startResize('right')}
            onDoubleClick={resetRightPanelWidth}
          />
        )}

        {!rightPanelCollapsed && (
          <div
            data-testid="workspace-right-panel"
            className="bg-white/70 dark:bg-gray-900/60"
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
            aria-label="Run timeline"
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.75rem] border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Run timeline</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Review recent execution events for the active session.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsTimelineModalOpen(false)}
                className="rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                aria-label="Close run timeline"
                title="Close run timeline"
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
