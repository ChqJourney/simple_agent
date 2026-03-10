import React from 'react';
import { useUIStore } from '../../stores';
import { FileTree } from './FileTree';
import { TaskList } from './TaskList';

export const RightPanel: React.FC = () => {
  const { rightPanelTab, setRightPanelTab } = useUIStore();

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setRightPanelTab('filetree')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            rightPanelTab === 'filetree'
              ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          File Tree
        </button>
        <button
          onClick={() => setRightPanelTab('tasklist')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            rightPanelTab === 'tasklist'
              ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          Tasks
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {rightPanelTab === 'filetree' ? <FileTree /> : <TaskList />}
      </div>
    </div>
  );
};