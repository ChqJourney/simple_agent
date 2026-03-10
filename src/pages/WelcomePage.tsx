import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspaceStore } from '../stores';
import { WorkspaceList } from '../components/Welcome/WorkspaceList';
import { WorkspaceDrawer } from '../components/Welcome/WorkspaceDrawer';

export const WelcomePage: React.FC = () => {
  const navigate = useNavigate();
  const { workspaces, addWorkspace, setCurrentWorkspace } = useWorkspaceStore();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateWorkspace = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Workspace Folder',
      });
      if (selected && typeof selected === 'string') {
        const existing = workspaces.find((w) => w.path === selected);
        if (existing) {
          setCurrentWorkspace(existing);
          navigate(`/workspace/${existing.id}`);
        } else {
          const workspace = await addWorkspace(selected);
          navigate(`/workspace/${workspace.id}`);
        }
      }
    } catch (error) {
      console.error('Failed to create workspace:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenWorkspace = (workspaceId: string) => {
    const workspace = workspaces.find((w) => w.id === workspaceId);
    if (workspace) {
      setCurrentWorkspace(workspace);
      navigate(`/workspace/${workspaceId}`);
    }
  };

  const recentWorkspaces = [...workspaces]
    .sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime())
    .slice(0, 5);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <header className="fixed top-0 left-0 right-0 h-14 flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <button
          onClick={() => setIsDrawerOpen(true)}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          title="Workspace list"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <button
          onClick={() => navigate('/settings')}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          title="Settings"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </header>

      <main className="flex flex-col items-center justify-center min-h-screen px-4 pt-14">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            AI Agent
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Your AI Assistant
          </p>
        </div>

        <button
          onClick={handleCreateWorkspace}
          disabled={isCreating}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors mb-8"
        >
          {isCreating ? 'Creating...' : '+ New Workspace'}
        </button>

        {recentWorkspaces.length > 0 && (
          <div className="w-full max-w-md">
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3 text-center">
              Recent Workspaces
            </h2>
            <WorkspaceList
              workspaces={recentWorkspaces}
              onSelect={handleOpenWorkspace}
            />
          </div>
        )}
      </main>

      <WorkspaceDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onSelect={handleOpenWorkspace}
      />
    </div>
  );
};