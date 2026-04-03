import React from 'react';
import { useI18n } from '../../i18n';
import type { Workspace } from '../../types';
import { WorkspaceItem } from './WorkspaceItem';

interface WorkspaceListProps {
  workspaces: Workspace[];
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
}

export const WorkspaceList: React.FC<WorkspaceListProps> = ({
  workspaces,
  onSelect,
  onDelete,
}) => {
  const { t } = useI18n();
  const handleDelete = (id: string) => {
    if (onDelete) {
      onDelete(id);
    }
  };

  if (workspaces.length === 0) {
    return (
      <div className="text-center text-gray-500 dark:text-gray-400 py-4">
        {t('welcome.noWorkspacesYet')}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {workspaces.map((workspace) => (
        <WorkspaceItem
          key={workspace.id}
          workspace={workspace}
          onSelect={onSelect}
          onDelete={handleDelete}
        />
      ))}
    </div>
  );
};
