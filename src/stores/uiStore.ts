import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type RightPanelTab = 'filetree' | 'tasklist';

interface UIState {
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  rightPanelTab: RightPanelTab;
  theme: 'light' | 'dark' | 'system';
  isPageLoading: boolean;
  
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setPageLoading: (loading: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      leftPanelCollapsed: false,
      rightPanelCollapsed: false,
      rightPanelTab: 'filetree',
      theme: 'system',

      toggleLeftPanel: () =>
        set((state) => ({ leftPanelCollapsed: !state.leftPanelCollapsed })),

      toggleRightPanel: () =>
        set((state) => ({ rightPanelCollapsed: !state.rightPanelCollapsed })),

      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

      setTheme: (theme) => set({ theme }),

      isPageLoading: false,
      setPageLoading: (loading) => set({ isPageLoading: loading }),
    }),
    {
      name: 'ui-storage',
    }
  )
);