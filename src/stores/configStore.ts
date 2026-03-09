import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ProviderConfig, Workspace } from '../types';

interface ConfigState {
  config: ProviderConfig | null;
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  
  setConfig: (config: ProviderConfig) => void;
  addWorkspace: (workspace: Workspace) => void;
  removeWorkspace: (id: string) => void;
  setCurrentWorkspace: (id: string | null) => void;
  updateWorkspace: (id: string, updates: Partial<Workspace>) => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      config: null,
      workspaces: [],
      currentWorkspaceId: null,

      setConfig: (config) => set({ config }),

      addWorkspace: (workspace) => set((state) => {
        if (state.workspaces.some(w => w.id === workspace.id)) {
          return state;
        }
        return {
          workspaces: [...state.workspaces, workspace],
        };
      }),

      removeWorkspace: (id) => set((state) => ({
        workspaces: state.workspaces.filter(w => w.id !== id),
        currentWorkspaceId: state.currentWorkspaceId === id ? null : state.currentWorkspaceId,
      })),

      setCurrentWorkspace: (id) => set({ 
        currentWorkspaceId: id,
      }),

      updateWorkspace: (id, updates) => set((state) => ({
        workspaces: state.workspaces.map(w =>
          w.id === id ? { ...w, ...updates } : w
        ),
      })),
    }),
    {
      name: 'config-storage',
    }
  )
);

export const getWorkspaceById = (id: string | null): Workspace | undefined => {
  if (!id) return undefined;
  return useConfigStore.getState().workspaces.find(w => w.id === id);
};

export const getCurrentWorkspace = (): Workspace | undefined => {
  const state = useConfigStore.getState();
  return state.workspaces.find(w => w.id === state.currentWorkspaceId);
};