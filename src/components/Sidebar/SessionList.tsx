import React, { useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { formatTimestamp, truncateText } from '../../utils/storage';
import { useSession } from '../../hooks/useSession';

interface SessionListProps {
  workspacePath: string | null;
}

export const SessionList: React.FC<SessionListProps> = ({ workspacePath }) => {
  const { sessions, currentSessionId, removeSession } = useSessionStore();
  const { createSession, switchSession } = useSession();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const filteredSessions = workspacePath
    ? sessions.filter(s => s.workspace_path === workspacePath)
    : sessions;

  const handleNewSession = () => {
    createSession();
  };

  const handleSessionClick = (sessionId: string) => {
    switchSession(sessionId);
  };

  const handleDeleteClick = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setDeleteConfirm(sessionId);
  };

  const handleConfirmDelete = () => {
    if (deleteConfirm && workspacePath) {
      removeSession(deleteConfirm, workspacePath);
    }
    setDeleteConfirm(null);
  };

  const handleCancelDelete = () => {
    setDeleteConfirm(null);
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
            <li key={session.session_id} className="group relative">
              <button
                onClick={() => handleSessionClick(session.session_id)}
                className={`w-full text-left p-2 pr-8 rounded-lg text-sm transition-colors ${
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
              <button
                onClick={(e) => handleDeleteClick(e, session.session_id)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900 text-red-500 dark:text-red-400 transition-opacity"
                title="Delete session"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 max-w-sm mx-4 shadow-xl">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Delete Session</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Are you sure you want to delete this session? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelDelete}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 text-sm bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};