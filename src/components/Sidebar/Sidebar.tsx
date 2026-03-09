import React, { useState } from 'react';
import { SessionList } from './SessionList';
import { WorkspaceSelector } from './WorkspaceSelector';
import { useSessionStore } from '../../stores/sessionStore';

interface SidebarProps {
  onOpenSettings: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onOpenSettings }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { currentWorkspacePath } = useSessionStore();

  if (isCollapsed) {
    return (
      <div className="w-12 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col items-center py-4">
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-600 dark:text-gray-300"
        >
          ▶
        </button>
      </div>
    );
  }

  return (
    <div className="w-64 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col transition-all duration-200">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">AI Agent</h2>
        <button
          onClick={() => setIsCollapsed(true)}
          className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-600 dark:text-gray-300"
        >
          ◀
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <WorkspaceSelector />
        <SessionList workspacePath={currentWorkspacePath} />
      </div>
      
      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={onOpenSettings}
          className="w-full px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors"
        >
          Settings
        </button>
      </div>
    </div>
  );
};