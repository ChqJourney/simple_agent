import React from 'react';
import { useI18n } from '../../i18n';
import { useTaskStore, useSessionStore } from '../../stores';

export const TaskList: React.FC = () => {
  const { t } = useI18n();
  const { currentSessionId } = useSessionStore();
  const { getTasksBySession } = useTaskStore();

  const tasks = currentSessionId ? getTasksBySession(currentSessionId) : [];

  const statusIcons: Record<string, React.ReactNode> = {
    pending: (
      <span className="w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-600" />
    ),
    in_progress: (
      <div className="w-4 h-4 relative">
        <span className="absolute inset-0 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      </div>
    ),
    completed: (
      <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    failed: (
      <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  const statusColors: Record<string, string> = {
    pending: 'text-gray-500 dark:text-gray-400',
    in_progress: 'text-blue-600 dark:text-blue-400',
    completed: 'text-green-600 dark:text-green-400',
    failed: 'text-red-600 dark:text-red-400',
  };

  if (tasks.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        {t('workspace.tasksEmpty')}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="py-2 space-y-1">
        {tasks.map((task) => (
          <div key={task.id} className="px-4 py-2">
            <div className="flex items-start gap-2">
              {statusIcons[task.status]}
              <span className={`text-sm ${statusColors[task.status]}`}>
                {task.content}
              </span>
            </div>
            {task.subTasks && task.subTasks.length > 0 && (
              <div className="ml-6 mt-1 space-y-1">
                {task.subTasks.map((subTask) => (
                  <div key={subTask.id} className="flex items-center gap-2">
                    {statusIcons[subTask.status]}
                    <span className={`text-xs ${statusColors[subTask.status]}`}>
                      {subTask.content}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
