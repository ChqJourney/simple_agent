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
  
  loadWorkspaces: () => void;
  addWorkspace: (path: string) => Promise<Workspace>;
  removeWorkspace: (id: string) => void;
  setCurrentWorkspace: (workspace: Workspace | null) => void;
  updateLastOpened: (id: string) => void;
}

const generateId = () => Math.random().toString(36).substring(2, 15);

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      currentWorkspace: null,

      loadWorkspaces: () => {
        // Workspaces are loaded from persist
      },

      addWorkspace: async (path: string) => {
        const name = path.split(/[/\\]/).pop() || path;
        const newWorkspace: Workspace = {
          id: generateId(),
          name,
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