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
      <div className="sidebar-collapsed w-12 bg-gray-100 border-r flex flex-col items-center py-4">
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-2 hover:bg-gray-200 rounded"
        >
          ▶
        </button>
      </div>
    );
  }

  return (
    <div className="sidebar w-64 bg-gray-100 border-r flex flex-col">
      <div className="p-4 border-b flex justify-between items-center">
        <h2 className="font-semibold text-gray-800">AI Agent</h2>
        <button
          onClick={() => setIsCollapsed(true)}
          className="p-1 hover:bg-gray-200 rounded"
        >
          ◀
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <WorkspaceSelector />
        <SessionList workspacePath={currentWorkspacePath} />
      </div>
      
      <div className="p-4 border-t">
        <button
          onClick={onOpenSettings}
          className="w-full px-4 py-2 text-sm bg-gray-200 rounded-lg hover:bg-gray-300"
        >
          Settings
        </button>
      </div>
    </div>
  );
};