import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import type { Workspace } from '../../types';

interface WorkspaceItemProps {
  workspace: Workspace;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export const WorkspaceItem: React.FC<WorkspaceItemProps> = ({
  workspace,
  onSelect,
  onDelete,
}) => {
  const { t } = useI18n();
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors group"
      onClick={() => onSelect(workspace.id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-center gap-3 overflow-hidden">
        <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <div className="overflow-hidden">
          <div className="font-medium text-gray-900 dark:text-white truncate">
            {workspace.name}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {workspace.path}
          </div>
        </div>
      </div>
      {isHovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(workspace.id);
          }}
          className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
          aria-label={t('welcome.removeWorkspace')}
          title={t('welcome.removeWorkspace')}
        >
          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};
