import { useCallback } from 'react';
import { useConfigStore } from '../stores/configStore';
import { ProviderConfig, ProviderType } from '../types';
import { getDefaultBaseUrl } from '../utils/config';

interface UseConfigReturn {
  config: ProviderConfig | null;
  setConfig: (config: ProviderConfig) => void;
  validateConfig: (config: Partial<ProviderConfig>) => boolean;
  getDefaultBaseUrl: (provider: ProviderType) => string;
}

export function useConfig(): UseConfigReturn {
  const { config, setConfig: setStoreConfig } = useConfigStore();

  const setConfig = useCallback((newConfig: ProviderConfig) => {
    setStoreConfig(newConfig);
  }, [setStoreConfig]);

  const validateConfig = useCallback((partialConfig: Partial<ProviderConfig>): boolean => {
    if (!partialConfig.provider || !partialConfig.model) {
      return false;
    }

    if (partialConfig.provider !== 'ollama' && !partialConfig.api_key) {
      return false;
    }

    return true;
  }, []);

  const getProviderDefaultBaseUrl = useCallback((provider: ProviderType): string => {
    return getDefaultBaseUrl(provider);
  }, []);

  return {
    config,
    setConfig,
    validateConfig,
    getDefaultBaseUrl: getProviderDefaultBaseUrl,
  };
}
