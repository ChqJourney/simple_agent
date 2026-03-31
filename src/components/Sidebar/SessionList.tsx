import React, { useEffect, useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { formatTimestamp } from '../../utils/storage';
import { useSession } from '../../hooks/useSession';

interface SessionListProps {
  workspacePath: string | null;
}

export const SessionList: React.FC<SessionListProps> = ({ workspacePath }) => {
  const { sessions, currentSessionId } = useSessionStore();
  const { createSession, switchSession, deleteSession } = useSession();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const filteredSessions = workspacePath
    ? sessions.filter(s => s.workspace_path === workspacePath)
    : sessions;
  const sortedSessions = [...filteredSessions].sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
  );
  const visibleSessions = showAll ? sortedSessions : sortedSessions.slice(0, 5);

  useEffect(() => {
    setShowAll(false);
  }, [workspacePath]);

  const handleNewSession = () => {
    createSession();
  };

  const handleSessionClick = (sessionId: string) => {
    void switchSession(sessionId);
  };

  const handleDeleteClick = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setDeleteConfirm(sessionId);
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteSession(deleteConfirm);
      setDeleteConfirm(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    if (isDeleting) {
      return;
    }
    setDeleteConfirm(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400">Sessions</h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {sortedSessions.length}
          </span>
        </div>
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

      <div data-testid="session-list-scroll" className="min-h-0 flex-1 overflow-y-auto pr-1 pt-2">
        {sortedSessions.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">No sessions yet</p>
        ) : (
          <div className="space-y-2">
            <ul className="space-y-1">
              {visibleSessions.map((session) => (
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
                      {session.title?.trim() || 'new session'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {formatTimestamp(session.updated_at)}
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

            {sortedSessions.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className="px-2 text-sm text-gray-500 transition-colors hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-300"
              >
                {showAll ? "Show less" : `Show more (${sortedSessions.length - 5} more)`}
              </button>
            )}
          </div>
        )}
      </div>

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
                disabled={isDeleting}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleConfirmDelete()}
                disabled={isDeleting}
                className="px-3 py-1.5 text-sm bg-red-500 hover:bg-red-600 text-white rounded transition-colors disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
