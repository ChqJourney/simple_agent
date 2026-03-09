import React from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { formatTimestamp, truncateText } from '../../utils/storage';

interface SessionListProps {
  workspacePath: string | null;
}

export const SessionList: React.FC<SessionListProps> = ({ workspacePath }) => {
  const { sessions, currentSessionId, setCurrentSession } = useSessionStore();

  const filteredSessions = workspacePath
    ? sessions.filter(s => s.workspace_path === workspacePath)
    : sessions;

  return (
    <div className="session-list">
      <h3 className="text-sm font-semibold text-gray-600 mb-2">Sessions</h3>
      
      {filteredSessions.length === 0 ? (
        <p className="text-xs text-gray-400">No sessions yet</p>
      ) : (
        <ul className="space-y-1">
          {filteredSessions.map((session) => (
            <li key={session.session_id}>
              <button
                onClick={() => setCurrentSession(session.session_id)}
                className={`w-full text-left p-2 rounded-lg text-sm ${
                  currentSessionId === session.session_id
                    ? 'bg-blue-100 text-blue-800'
                    : 'hover:bg-gray-100'
                }`}
              >
                <div className="font-medium truncate">
                  {truncateText(session.session_id, 20)}
                </div>
                <div className="text-xs text-gray-500">
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