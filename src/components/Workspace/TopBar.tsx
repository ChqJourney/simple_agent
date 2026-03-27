import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore, useSessionStore, useUIStore, useWorkspaceStore } from '../../stores';
import { WSStatusIndicator, ModelDisplay, TokenUsageWidget } from '../common';

interface TopBarProps {
  onOpenTimeline?: () => void;
  onBackHome?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onOpenTimeline, onBackHome }) => {
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
          onClick={() => {
            if (onBackHome) {
              onBackHome();
              return;
            }
            navigate('/');
          }}
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
        <button
          type="button"
          onClick={onOpenTimeline}
          className="rounded-xl p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
          title="Open run timeline"
          aria-label="Open run timeline"
        >
          <svg className="h-5 w-5 text-gray-600 dark:text-gray-300" viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true">
            <path d="M426.666667 170.666667h512q42.666667 0 42.666666 42.666666t-42.666666 42.666667h-512q-42.666667 0-42.666667-42.666667t42.666667-42.666666z" />
            <path d="M426.666667 469.333333h512q42.666667 0 42.666666 42.666667t-42.666666 42.666667h-512q-42.666667 0-42.666667-42.666667t42.666667-42.666667z" />
            <path d="M426.666667 768h512q42.666667 0 42.666666 42.666667t-42.666666 42.666666h-512q-42.666667 0-42.666667-42.666666t42.666667-42.666667z" />
            <path d="M239.835143 127.973411a21.333333 21.333333 0 0 1 15.084945 6.248278l60.339779 60.339779a21.333333 21.333333 0 0 1 0 30.169889l-60.339779 60.339779a21.333333 21.333333 0 0 1-30.169889 0l-60.339779-60.339779a21.333333 21.333333 0 0 1 0-30.169889l60.339779-60.339779a21.333333 21.333333 0 0 1 15.084944-6.248278z" />
            <path d="M239.831988 426.647696a21.333333 21.333333 0 0 1 15.084944 6.248279l60.339779 60.339778a21.333333 21.333333 0 0 1 0 30.16989l-60.339779 60.339778a21.333333 21.333333 0 0 1-30.169889 0l-60.339779-60.339778a21.333333 21.333333 0 0 1 0-30.16989l60.339779-60.339778a21.333333 21.333333 0 0 1 15.084945-6.248279z" />
            <path d="M239.828832 725.321982a21.333333 21.333333 0 0 1 15.084944 6.248278l60.339779 60.339779a21.333333 21.333333 0 0 1 0 30.169889l-60.339779 60.339779a21.333333 21.333333 0 0 1-30.169889 0l-60.339779-60.339779a21.333333 21.333333 0 0 1 0-30.169889l60.339779-60.339779a21.333333 21.333333 0 0 1 15.084945-6.248278z" />
            <path d="M213.333333 853.333333H85.333333a42.666667 42.666667 0 0 1-42.666666-42.666666V213.333333a42.666667 42.666667 0 0 1 42.666666-42.666666h128v85.333333H138.666667a10.709333 10.709333 0 0 0-10.666667 10.666667v192a10.709333 10.709333 0 0 0 10.666667 10.666666H213.333333v85.333334H138.666667a10.709333 10.709333 0 0 0-10.666667 10.666666v192a10.709333 10.709333 0 0 0 10.666667 10.666667H213.333333v85.333333z" />
          </svg>
        </button>
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
