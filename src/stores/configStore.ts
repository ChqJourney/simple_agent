import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ProviderConfig } from '../types';
import { configPersistStorage } from '../utils/configStorage';

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
    }
  )
);
