import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore, useSessionStore, useUIStore, useWorkspaceStore } from '../../stores';
import { WSStatusIndicator, ModelDisplay, TokenUsageWidget } from '../common';

export const TopBar: React.FC = () => {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspaceStore();
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const { leftPanelCollapsed, rightPanelCollapsed, toggleLeftPanel, toggleRightPanel } = useUIStore();
  const latestUsage = useChatStore((state) =>
    currentSessionId ? state.sessions[currentSessionId]?.latestUsage : undefined
  );

  return (
    <header className="h-12 flex items-center justify-between px-4 bg-white/85 backdrop-blur dark:bg-gray-900/85">
      <div className="flex items-center gap-2">
        <button
          onClick={toggleLeftPanel}
          className="rounded-xl p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
          title={leftPanelCollapsed ? 'Show left panel' : 'Hide left panel'}
        >
          <svg className="h-5 w-5 text-gray-600 dark:text-gray-300" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="4" width="14" height="12" rx="2" />
            <path d="M7 4v12" className={leftPanelCollapsed ? 'opacity-25' : 'opacity-100'} />
          </svg>
        </button>
        <button
          onClick={() => navigate('/')}
          className="rounded-xl p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
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
        <TokenUsageWidget usage={latestUsage} />
        <WSStatusIndicator />
        <ModelDisplay />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleRightPanel}
          className="rounded-xl p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
          title={rightPanelCollapsed ? 'Show right panel' : 'Hide right panel'}
        >
          <svg className="h-5 w-5 text-gray-600 dark:text-gray-300" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="4" width="14" height="12" rx="2" />
            <path d="M13 4v12" className={rightPanelCollapsed ? 'opacity-25' : 'opacity-100'} />
          </svg>
        </button>
      </div>
    </header>
  );
};
