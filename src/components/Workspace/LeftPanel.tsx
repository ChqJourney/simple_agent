import React from 'react';
import { useSessionStore, useWorkspaceStore } from '../../stores';
import { SessionList } from '../Sidebar/SessionList';

export const LeftPanel: React.FC = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const sessions = useSessionStore((state) => state.sessions);

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

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-gray-200/70 p-4 dark:border-gray-800/80">
        <div className="space-y-2 text-sm">
          <div className="font-medium text-gray-900 dark:text-white">
            {`Workspace - ${folderName}`}
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
