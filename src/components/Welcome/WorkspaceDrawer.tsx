import React from 'react';
import { useWorkspaceStore } from '../../stores';
import { WorkspaceList } from './WorkspaceList';

interface WorkspaceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}

export const WorkspaceDrawer: React.FC<WorkspaceDrawerProps> = ({
  isOpen,
  onClose,
  onSelect,
}) => {
  const { workspaces, removeWorkspace } = useWorkspaceStore();

  const handleDelete = (id: string) => {
    removeWorkspace(id);
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      <div className="fixed left-0 top-0 bottom-0 w-80 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 z-50 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white">
            Workspaces
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {workspaces.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              No workspaces yet.
              <br />
              Create your first workspace to get started.
            </div>
          ) : (
            <WorkspaceList
              workspaces={workspaces}
              onSelect={(id) => {
                onSelect(id);
                onClose();
              }}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>
    </>
  );
};