import React, { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useParams, useNavigate } from 'react-router-dom';
import { useWorkspaceStore, useUIStore, useSessionStore } from '../stores';
import { TopBar, LeftPanel, RightPanel } from '../components/Workspace';
import { ChatContainer } from '../components/Chat';
import { useWebSocket } from '../contexts/WebSocketContext';

const IS_DEV = import.meta.env.DEV;

interface AuthorizedWorkspacePath {
  canonical_path: string;
}

export const WorkspacePage: React.FC = () => {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { workspaces, setCurrentWorkspace, currentWorkspace, syncWorkspacePath } = useWorkspaceStore();
  const { leftPanelCollapsed, rightPanelCollapsed, setPageLoading } = useUIStore();
  const { isConnected, sendWorkspace } = useWebSocket();
  const { loadSessionsFromDisk, setCurrentSession } = useSessionStore();
  const [backendReady, setBackendReady] = useState(!IS_DEV);
  const [workspaceAccessError, setWorkspaceAccessError] = useState<string | null>(null);
  const prevWorkspaceIdRef = useRef<string | null>(null);

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
      if (!currentWorkspace?.id || !currentWorkspace.path) {
        return;
      }

      try {
        setWorkspaceAccessError(null);
        const authorizedWorkspace = await invoke<AuthorizedWorkspacePath>('authorize_workspace_path', {
          selectedPath: currentWorkspace.path,
        });
        const authorizedPath = authorizedWorkspace.canonical_path;

        if (authorizedPath !== currentWorkspace.path) {
          syncWorkspacePath(currentWorkspace.id, authorizedPath);
        }

        setCurrentSession(null);
        await loadSessionsFromDisk(authorizedPath);
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
          const response = await fetch('http://127.0.0.1:8765/health');
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

  if (!currentWorkspace) {
    return (
      <div className="flex h-screen items-center justify-center bg-white dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-gray-100 dark:bg-gray-950">
      <TopBar />

      <div className="flex flex-1 overflow-hidden">
        {!leftPanelCollapsed && (
          <div className="w-64 bg-white/70 dark:bg-gray-900/60">
            <LeftPanel />
          </div>
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
                Waiting for Python backend at http://127.0.0.1:8765...
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
          <div className="w-72 bg-white/70 dark:bg-gray-900/60">
            <RightPanel />
          </div>
        )}
      </div>
    </div>
  );
};
