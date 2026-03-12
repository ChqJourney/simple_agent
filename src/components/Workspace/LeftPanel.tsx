import React from 'react';
import { useWorkspaceStore, useConfigStore } from '../../stores';
import { SessionList } from '../Sidebar/SessionList';

export const LeftPanel: React.FC = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const { config } = useConfigStore();

  if (!currentWorkspace) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        No workspace selected
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4">
        <h3 className="font-medium text-gray-900 dark:text-white mb-2">
          Workspace
        </h3>
        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="truncate">{currentWorkspace.path}</span>
          </div>
          {config && (
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span className="truncate">{config.model}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-2 pb-2">
        <SessionList workspacePath={currentWorkspace.path} />
      </div>
    </div>
  );
};
