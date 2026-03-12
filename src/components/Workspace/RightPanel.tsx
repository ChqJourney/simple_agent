import React from 'react';
import { useUIStore } from '../../stores';
import { FileTree } from './FileTree';
import { TaskList } from './TaskList';

export const RightPanel: React.FC = () => {
  const { rightPanelTab, setRightPanelTab } = useUIStore();

  return (
    <div className="flex flex-col h-full">
      <div className="p-3">
        <div className="flex rounded-2xl bg-gray-100 p-1 dark:bg-gray-800">
        <button
          onClick={() => setRightPanelTab('filetree')}
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            rightPanelTab === 'filetree'
              ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          File Tree
        </button>
        <button
          onClick={() => setRightPanelTab('tasklist')}
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            rightPanelTab === 'tasklist'
              ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          Tasks
        </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-3 pb-3">
        {rightPanelTab === 'filetree' ? <FileTree /> : <TaskList />}
      </div>
    </div>
  );
};
