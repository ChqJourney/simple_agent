import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ProviderConfig } from '../types';
import { configPersistStorage } from '../utils/configStorage';
import { normalizeProviderConfig } from '../utils/config';

interface ConfigState {
  config: ProviderConfig | null;
  setConfig: (config: ProviderConfig) => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      config: null,
      setConfig: (config) => set({ config }),
    }),
    {
      name: 'config-storage',
      storage: configPersistStorage,
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<ConfigState> | undefined;
        return {
          ...currentState,
          ...persisted,
          config: persisted?.config ? normalizeProviderConfig(persisted.config as ProviderConfig) : null,
        };
      },
    }
  )
);
