import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppLocale, resolveAppLocale } from '../i18n/locale';
import { normalizeBaseFontSize } from '../utils/config';

export type RightPanelTab = 'filetree' | 'tasklist';

export const DEFAULT_LEFT_PANEL_WIDTH = 256;
export const DEFAULT_RIGHT_PANEL_WIDTH = 288;
export const MIN_PANEL_WIDTH = 200;
export const MAX_PANEL_WIDTH = 480;

function normalizePanelWidth(value: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(parsed)));
}

interface UIState {
  leftPanelCollapsed: boolean;
  leftPanelWidth: number;
  rightPanelCollapsed: boolean;
  rightPanelWidth: number;
  rightPanelTab: RightPanelTab;
  theme: 'light' | 'dark' | 'system';
  locale: AppLocale;
  baseFontSize: number;
  isPageLoading: boolean;

  toggleLeftPanel: () => void;
  setLeftPanelWidth: (width: number) => void;
  resetLeftPanelWidth: () => void;
  toggleRightPanel: () => void;
  setRightPanelWidth: (width: number) => void;
  resetRightPanelWidth: () => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setLocale: (locale: AppLocale) => void;
  setBaseFontSize: (size: number) => void;
  setPageLoading: (loading: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      leftPanelCollapsed: false,
      leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
      rightPanelCollapsed: false,
      rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH,
      rightPanelTab: 'filetree',
      theme: 'system',
      locale: resolveAppLocale(typeof navigator !== 'undefined' ? navigator.language : undefined),
      baseFontSize: 16,
      isPageLoading: false,

      toggleLeftPanel: () =>
        set((state) => ({ leftPanelCollapsed: !state.leftPanelCollapsed })),
      setLeftPanelWidth: (width) =>
        set({ leftPanelWidth: normalizePanelWidth(width, DEFAULT_LEFT_PANEL_WIDTH) }),
      resetLeftPanelWidth: () => set({ leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH }),

      toggleRightPanel: () =>
        set((state) => ({ rightPanelCollapsed: !state.rightPanelCollapsed })),
      setRightPanelWidth: (width) =>
        set({ rightPanelWidth: normalizePanelWidth(width, DEFAULT_RIGHT_PANEL_WIDTH) }),
      resetRightPanelWidth: () => set({ rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH }),

      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setBaseFontSize: (size) => set({ baseFontSize: normalizeBaseFontSize(size) }),
      setPageLoading: (loading) => set({ isPageLoading: loading }),
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        leftPanelCollapsed: state.leftPanelCollapsed,
        leftPanelWidth: state.leftPanelWidth,
        rightPanelCollapsed: state.rightPanelCollapsed,
        rightPanelWidth: state.rightPanelWidth,
        rightPanelTab: state.rightPanelTab,
        theme: state.theme,
        locale: state.locale,
        baseFontSize: state.baseFontSize,
      }),
    }
  )
);
