import React, { useState, useCallback } from 'react';
import { useConfig } from '../../hooks/useConfig';
import { ProviderConfigForm } from './ProviderConfig';
import { ProviderConfig } from '../../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { config, setConfig, validateConfig, getDefaultBaseUrl } = useConfig();
  const [localConfig, setLocalConfig] = useState<Partial<ProviderConfig>>(config || {});
  const [error, setError] = useState<string | null>(null);

  const handleProviderChange = useCallback((newConfig: Partial<ProviderConfig>) => {
    if (newConfig.provider && !newConfig.base_url) {
      newConfig.base_url = getDefaultBaseUrl(newConfig.provider);
    }
    setLocalConfig(newConfig);
    setError(null);
  }, [getDefaultBaseUrl]);

  const handleSave = useCallback(() => {
    if (!validateConfig(localConfig)) {
      setError('Please fill in all required fields');
      return;
    }

    setConfig(localConfig as ProviderConfig);
    onClose();
  }, [localConfig, validateConfig, setConfig, onClose]);

  if (!isOpen) return null;

return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 rounded-lg">
            {error}
          </div>
        )}

        <ProviderConfigForm
          config={localConfig}
          onChange={handleProviderChange}
        />

        <div className="mt-6 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};