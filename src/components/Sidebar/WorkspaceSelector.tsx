import React, { useCallback } from 'react';
import { useConfig } from '../../hooks/useConfig';
import { useSessionStore } from '../../stores/sessionStore';

export const WorkspaceSelector: React.FC = () => {
  const { workspaces, currentWorkspaceId, addWorkspace, setCurrentWorkspace } = useConfig();
  const { setWorkspace } = useSessionStore();

  const handleSelectFolder = useCallback(() => {
    const path = prompt('Enter workspace path:');
    if (path) {
      const name = path.split(/[/\\]/).pop() || 'Workspace';
      const workspace = addWorkspace(name, path);
      setCurrentWorkspace(workspace.id);
      setWorkspace(path);
    }
  }, [addWorkspace, setCurrentWorkspace, setWorkspace]);

  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId);

return (
    <div>
      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Workspace</h3>
      
      {currentWorkspace ? (
        <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg mb-2">
          <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{currentWorkspace.name}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{currentWorkspace.path}</div>
        </div>
      ) : (
        <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">No workspace selected</div>
      )}
      
      <button
        onClick={handleSelectFolder}
        className="w-full px-3 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
      >
        Select Folder
      </button>
      
      {workspaces.length > 0 && (
        <ul className="mt-2 space-y-1">
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              <button
                onClick={() => {
                  setCurrentWorkspace(workspace.id);
                  setWorkspace(workspace.path);
                }}
                className={`w-full text-left p-2 rounded-lg text-sm transition-colors ${
                  currentWorkspaceId === workspace.id
                    ? 'bg-blue-50 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
              >
                <div className="font-medium">{workspace.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{workspace.path}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};