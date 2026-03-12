import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Workspace {
  id: string;
  name: string;
  path: string;
  lastOpened: string;
  createdAt: string;
}

interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  addWorkspace: (path: string) => Promise<Workspace>;
  syncWorkspacePath: (id: string, path: string) => Workspace | null;
  removeWorkspace: (id: string) => void;
  setCurrentWorkspace: (workspace: Workspace | null) => void;
  updateLastOpened: (id: string) => void;
}

const generateId = () => Math.random().toString(36).substring(2, 15);
const getWorkspaceName = (path: string) => path.split(/[/\\]/).filter(Boolean).pop() || path;

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      currentWorkspace: null,

      addWorkspace: async (path: string) => {
        const newWorkspace: Workspace = {
          id: generateId(),
          name: getWorkspaceName(path),
          path,
          lastOpened: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          workspaces: [...state.workspaces, newWorkspace],
          currentWorkspace: newWorkspace,
        }));
        return newWorkspace;
      },

      syncWorkspacePath: (id, path) => {
        const nextName = getWorkspaceName(path);
        let updatedWorkspace: Workspace | null = null;

        set((state) => {
          const workspaces = state.workspaces.map((workspace) => {
            if (workspace.id !== id) {
              return workspace;
            }

            updatedWorkspace =
              workspace.path === path && workspace.name === nextName
                ? workspace
                : {
                    ...workspace,
                    name: nextName,
                    path,
                  };

            return updatedWorkspace;
          });

          return {
            workspaces,
            currentWorkspace:
              state.currentWorkspace?.id === id
                ? updatedWorkspace ?? state.currentWorkspace
                : state.currentWorkspace,
          };
        });

        return updatedWorkspace;
      },

      removeWorkspace: (id: string) => {
        set((state) => ({
          workspaces: state.workspaces.filter((w) => w.id !== id),
          currentWorkspace: state.currentWorkspace?.id === id ? null : state.currentWorkspace,
        }));
      },

      setCurrentWorkspace: (workspace: Workspace | null) => {
        set({ currentWorkspace: workspace });
        if (workspace) {
          get().updateLastOpened(workspace.id);
        }
      },

      updateLastOpened: (id: string) => {
        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === id ? { ...w, lastOpened: new Date().toISOString() } : w
          ),
        }));
      },
    }),
    {
      name: 'workspace-storage',
    }
  )
);
