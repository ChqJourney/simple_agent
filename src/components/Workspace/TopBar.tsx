import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useUIStore, useWorkspaceStore } from '../../stores';
import { WSStatusIndicator, ModelDisplay } from '../common';

export const TopBar: React.FC = () => {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspaceStore();
  const { leftPanelCollapsed, rightPanelCollapsed, toggleLeftPanel, toggleRightPanel } = useUIStore();

  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <div className="flex items-center gap-2">
        <button
          onClick={toggleLeftPanel}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
          title={leftPanelCollapsed ? 'Show left panel' : 'Hide left panel'}
        >
          <svg className={`w-5 h-5 text-gray-600 dark:text-gray-300 transition-transform ${leftPanelCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
        <button
          onClick={() => navigate('/')}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
          title="Back to home"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </button>
        {currentWorkspace && (
          <span className="font-medium text-gray-900 dark:text-white ml-2">
            {currentWorkspace.name}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <WSStatusIndicator />
        <ModelDisplay />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleRightPanel}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
          title={rightPanelCollapsed ? 'Show right panel' : 'Hide right panel'}
        >
          <svg className={`w-5 h-5 text-gray-600 dark:text-gray-300 transition-transform ${rightPanelCollapsed ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </header>
  );
};