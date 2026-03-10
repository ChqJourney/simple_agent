import React from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { formatTimestamp, truncateText } from '../../utils/storage';
import { useSession } from '../../hooks/useSession';

interface SessionListProps {
  workspacePath: string | null;
}

export const SessionList: React.FC<SessionListProps> = ({ workspacePath }) => {
  const { sessions, currentSessionId } = useSessionStore();
  const { createSession, switchSession } = useSession();

  const filteredSessions = workspacePath
    ? sessions.filter(s => s.workspace_path === workspacePath)
    : sessions;

  const handleNewSession = () => {
    createSession();
  };

  const handleSessionClick = (sessionId: string) => {
    switchSession(sessionId);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400">Sessions</h3>
        <button
          onClick={handleNewSession}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors"
          title="New Session"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
      
      {filteredSessions.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">No sessions yet</p>
      ) : (
        <ul className="space-y-1">
          {filteredSessions.map((session) => (
            <li key={session.session_id}>
              <button
                onClick={() => handleSessionClick(session.session_id)}
                className={`w-full text-left p-2 rounded-lg text-sm transition-colors ${
                  currentSessionId === session.session_id
                    ? 'bg-blue-50 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
              >
                <div className="font-medium truncate">
                  {truncateText(session.session_id, 20)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {formatTimestamp(session.created_at)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};