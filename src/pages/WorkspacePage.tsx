import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWorkspaceStore, useUIStore } from '../stores';
import { TopBar, LeftPanel, RightPanel } from '../components/Workspace';
import { ChatContainer } from '../components/Chat';
import { useWebSocket } from '../contexts/WebSocketContext';

const IS_DEV = import.meta.env.DEV;

export const WorkspacePage: React.FC = () => {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { workspaces, setCurrentWorkspace, currentWorkspace } = useWorkspaceStore();
  const { leftPanelCollapsed, rightPanelCollapsed } = useUIStore();
  const { isConnected, sendWorkspace } = useWebSocket();
  const [backendReady, setBackendReady] = useState(!IS_DEV);
  const prevWorkspaceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (workspaceId && workspaceId !== prevWorkspaceIdRef.current) {
      prevWorkspaceIdRef.current = workspaceId;
      const workspace = workspaces.find((w) => w.id === workspaceId);
      if (workspace) {
        setCurrentWorkspace(workspace);
      } else {
        navigate('/');
      }
    }
  }, [workspaceId, workspaces, setCurrentWorkspace, navigate]);

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

      checkBackend();
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
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      <TopBar />

      <div className="flex flex-1 overflow-hidden">
        {!leftPanelCollapsed && (
          <div className="w-64 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <LeftPanel />
          </div>
        )}

        <main className="flex-1 flex flex-col overflow-hidden">
          {IS_DEV && !backendReady ? (
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
          <div className="w-72 border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <RightPanel />
          </div>
        )}
      </div>
    </div>
  );
};