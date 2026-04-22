import React, { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { useChatStore } from '../../stores/chatStore';
import type { Message } from '../../types';
import { buildChecklistResultViewModel } from '../../utils/checklistResults';
import { useSessionStore, useTaskStore, useUIStore, type RightPanelTab } from '../../stores';
import { ChecklistResultPanel } from '../Checklist';
import { StandardQaReportPanel } from '../Report';
import { FileTree } from './FileTree';
import { TaskList } from './TaskList';

const EMPTY_MESSAGES: Message[] = [];

export const RightPanel: React.FC = () => {
  const { t } = useI18n();
  const autoFocusedReportSessionsRef = useRef<Set<string>>(new Set());
  const rightPanelTab = useUIStore((state) => state.rightPanelTab);
  const setRightPanelTab = useUIStore((state) => state.setRightPanelTab);
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const activeSessionMeta = useSessionStore((state) => (
    currentSessionId
      ? state.sessions.find((session) => session.session_id === currentSessionId)
      : undefined
  ));
  const sessionMessages = useChatStore((state) => (
    currentSessionId
      ? state.sessions[currentSessionId]?.messages
      : undefined
  ));
  const messages = sessionMessages ?? EMPTY_MESSAGES;
  const showTaskTab = useTaskStore((state) =>
    currentSessionId ? state.isTaskTabVisible(currentSessionId) : false
  );
  const checklistResult = buildChecklistResultViewModel({
    scenarioId: activeSessionMeta?.scenario_id,
    messages,
  });
  const showChecklistTab = Boolean(checklistResult);
  const showReportTab = activeSessionMeta?.scenario_id === 'standard_qa';
  const tabs: Array<{ value: RightPanelTab; label: string }> = [
    ...(showReportTab ? [{ value: 'report' as const, label: t('report.standardQa.tab') }] : []),
    { value: 'filetree', label: t('workspace.rightPanel.fileTree') },
    ...(showChecklistTab ? [{ value: 'checklist' as const, label: t('checklist.panel.tab') }] : []),
    ...(showTaskTab ? [{ value: 'tasklist' as const, label: t('workspace.rightPanel.tasks') }] : []),
  ];
  const hasActiveTab = (
    (rightPanelTab === 'report' && showReportTab)
    || rightPanelTab === 'filetree'
    || (rightPanelTab === 'checklist' && showChecklistTab)
    || (rightPanelTab === 'tasklist' && showTaskTab)
  );
  const activeTab: RightPanelTab = hasActiveTab ? rightPanelTab : showReportTab ? 'report' : 'filetree';

  useEffect(() => {
    if (!hasActiveTab) {
      setRightPanelTab(showReportTab ? 'report' : 'filetree');
    }
  }, [hasActiveTab, setRightPanelTab, showReportTab]);

  useEffect(() => {
    if (!currentSessionId || !showReportTab) {
      return;
    }
    if (autoFocusedReportSessionsRef.current.has(currentSessionId)) {
      return;
    }
    autoFocusedReportSessionsRef.current.add(currentSessionId);
    setRightPanelTab('report');
  }, [currentSessionId, setRightPanelTab, showReportTab]);

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
        {activeTab === 'filetree' && <FileTree />}
        {activeTab === 'checklist' && checklistResult && (
          <ChecklistResultPanel result={checklistResult} sessionId={currentSessionId} />
        )}
        {activeTab === 'report' && showReportTab && (
          <StandardQaReportPanel session={activeSessionMeta} messages={messages} />
        )}
        {activeTab === 'tasklist' && <TaskList />}
      </div>
    </div>
  );
};
