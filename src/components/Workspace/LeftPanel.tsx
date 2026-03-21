import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSessionStore, useWorkspaceStore } from '../../stores';
import { SessionList } from '../Sidebar/SessionList';

export const LeftPanel: React.FC = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const sessions = useSessionStore((state) => state.sessions);
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);

  if (!currentWorkspace) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        No workspace selected
      </div>
    );
  }

  const folderName = currentWorkspace.name || currentWorkspace.path.split(/[\\/]/).filter(Boolean).pop() || currentWorkspace.path;
  const sessionCount = sessions.filter((session) => session.workspace_path === currentWorkspace.path).length;
  const sessionLabel = sessionCount === 1 ? '1 session' : `${sessionCount} sessions`;

  const handleOpenWorkspace = async () => {
    if (isOpeningWorkspace) {
      return;
    }

    setIsOpeningWorkspace(true);
    try {
      await invoke('open_workspace_folder', { selectedPath: currentWorkspace.path });
    } catch (error) {
      console.error('Failed to open workspace folder:', error);
    } finally {
      setIsOpeningWorkspace(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-gray-200/70 p-4 dark:border-gray-800/80">
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-gray-900 dark:text-white">
              {`Workspace - ${folderName}`}
            </div>
            <button
              type="button"
              onClick={() => void handleOpenWorkspace()}
              disabled={isOpeningWorkspace}
              aria-label="Open workspace folder"
              title="Open workspace folder"
              className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 5.75H4.5A1.75 1.75 0 002.75 7.5v8A1.75 1.75 0 004.5 17.25h8A1.75 1.75 0 0014.25 15V12.75" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 4.25h5.75V10" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 11.75L15.5 4.5" />
              </svg>
            </button>
          </div>
          <div className="text-gray-600 dark:text-gray-400" title={currentWorkspace.path}>
            <span className="block truncate">{currentWorkspace.path}</span>
          </div>
          <div className="text-gray-500 dark:text-gray-400">{sessionLabel}</div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-2 pb-2">
        <SessionList workspacePath={currentWorkspace.path} />
      </div>
    </div>
  );
};
