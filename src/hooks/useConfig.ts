import { useCallback } from 'react';
import { useConfigStore } from '../stores/configStore';
import { ProviderConfig, ProviderType, Workspace } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface UseConfigReturn {
  config: ProviderConfig | null;
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  setConfig: (config: ProviderConfig) => void;
  addWorkspace: (name: string, path: string) => Workspace;
  removeWorkspace: (id: string) => void;
  setCurrentWorkspace: (id: string | null) => void;
  validateConfig: (config: Partial<ProviderConfig>) => boolean;
  getDefaultBaseUrl: (provider: ProviderType) => string;
}

const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ollama: 'http://127.0.0.1:11434/v1',
};

export function useConfig(): UseConfigReturn {
  const {
    config,
    workspaces,
    currentWorkspaceId,
    setConfig: setStoreConfig,
    addWorkspace: addStoreWorkspace,
    removeWorkspace: removeStoreWorkspace,
    setCurrentWorkspace: setStoreCurrentWorkspace,
  } = useConfigStore();

  const setConfig = useCallback((newConfig: ProviderConfig) => {
    setStoreConfig(newConfig);
  }, [setStoreConfig]);

  const addWorkspace = useCallback((name: string, path: string): Workspace => {
    const workspace: Workspace = {
      id: uuidv4(),
      name,
      path,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    addStoreWorkspace(workspace);
    return workspace;
  }, [addStoreWorkspace]);

  const removeWorkspace = useCallback((id: string) => {
    removeStoreWorkspace(id);
  }, [removeStoreWorkspace]);

  const setCurrentWorkspace = useCallback((id: string | null) => {
    setStoreCurrentWorkspace(id);
  }, [setStoreCurrentWorkspace]);

  const validateConfig = useCallback((partialConfig: Partial<ProviderConfig>): boolean => {
    if (!partialConfig.provider || !partialConfig.model) {
      return false;
    }

    if (partialConfig.provider !== 'ollama' && !partialConfig.api_key) {
      return false;
    }

    return true;
  }, []);

  const getDefaultBaseUrl = useCallback((provider: ProviderType): string => {
    return DEFAULT_BASE_URLS[provider];
  }, []);

  return {
    config,
    workspaces,
    currentWorkspaceId,
    setConfig,
    addWorkspace,
    removeWorkspace,
    setCurrentWorkspace,
    validateConfig,
    getDefaultBaseUrl,
  };
}