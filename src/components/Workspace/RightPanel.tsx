import React, { useEffect } from 'react';
import { useSessionStore, useTaskStore, useUIStore, type RightPanelTab } from '../../stores';
import { FileTree } from './FileTree';
import { TaskList } from './TaskList';

export const RightPanel: React.FC = () => {
  const { rightPanelTab, setRightPanelTab } = useUIStore();
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const showTaskTab = useTaskStore((state) =>
    currentSessionId ? state.isTaskTabVisible(currentSessionId) : false
  );
  const activeTab: RightPanelTab = rightPanelTab === 'tasklist' && !showTaskTab
    ? 'filetree'
    : rightPanelTab;
  const tabs: Array<{ value: RightPanelTab; label: string }> = showTaskTab
    ? [
        { value: 'filetree', label: 'File Tree' },
        { value: 'tasklist', label: 'Tasks' },
      ]
    : [{ value: 'filetree', label: 'File Tree' }];

  useEffect(() => {
    if (rightPanelTab === 'tasklist' && !showTaskTab) {
      setRightPanelTab('filetree');
    }
  }, [rightPanelTab, setRightPanelTab, showTaskTab]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3">
        <div className="flex rounded-2xl bg-gray-100 p-1 dark:bg-gray-800">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setRightPanelTab(tab.value)}
              className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.value
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-3 pb-3">
        {activeTab === 'filetree' ? <FileTree /> : <TaskList />}
      </div>
    </div>
  );
};
