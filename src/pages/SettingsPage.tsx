import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProviderConfigForm } from '../components/Settings/ProviderConfig';
import { useConfigStore } from '../stores/configStore';
import { useUIStore } from '../stores';
import { ProviderConfig } from '../types';
import { useWebSocket } from '../contexts/WebSocketContext';
import { normalizeBaseUrl, normalizeProviderConfig } from '../utils/config';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { config, setConfig } = useConfigStore();
  const { theme, setTheme } = useUIStore();
  const { sendConfig } = useWebSocket();
  const [draftConfig, setDraftConfig] = useState<Partial<ProviderConfig>>(config || {});
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    setDraftConfig(config || {});
  }, [config]);

  const handleTest = async () => {
    if (!draftConfig.provider || !draftConfig.model) return;

    setTestStatus('testing');
    setTestError(null);

    try {
      const baseUrl = normalizeBaseUrl(draftConfig.provider, draftConfig.base_url);
      const response = await fetch('http://127.0.0.1:8765/test-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: draftConfig.provider,
          model: draftConfig.model,
          api_key: draftConfig.api_key,
          base_url: baseUrl,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (response.ok && payload.ok) {
        setTestStatus('success');
      } else {
        setTestStatus('error');
        setTestError(payload.error || 'Connection test failed');
      }
    } catch (error) {
      setTestStatus('error');
      setTestError(error instanceof Error ? error.message : 'Connection failed');
    }
  };

  const handleSave = () => {
    if (!draftConfig.provider || !draftConfig.model) {
      setTestStatus('error');
      setTestError('Provider and model are required');
      return;
    }

    if (draftConfig.provider !== 'ollama' && !draftConfig.api_key) {
      setTestStatus('error');
      setTestError('API key is required for this provider');
      return;
    }

    const normalizedConfig = normalizeProviderConfig({
      provider: draftConfig.provider,
      model: draftConfig.model,
      api_key: draftConfig.api_key || '',
      base_url: draftConfig.base_url || '',
      enable_reasoning: draftConfig.enable_reasoning || false,
    });

    setConfig(normalizedConfig);
    sendConfig(normalizedConfig);
    navigate(-1);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <header className="h-14 flex items-center px-4 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="ml-4 text-lg font-semibold text-gray-900 dark:text-white">
          Settings
        </h1>
      </header>

      <main className="max-w-2xl mx-auto p-6 space-y-8">
        <section>
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Provider Configuration
          </h2>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-4">
            <ProviderConfigForm
              config={draftConfig}
              onChange={setDraftConfig}
            />
            {draftConfig.provider && draftConfig.provider !== 'ollama' && (
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleTest}
                  disabled={testStatus === 'testing'}
                  className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                </button>
                {testStatus === 'success' && (
                  <span className="text-green-500 text-sm">Connected</span>
                )}
                {testStatus === 'error' && (
                  <span className="text-red-500 text-sm">
                    Failed{testError ? `: ${testError}` : ''}
                  </span>
                )}
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Appearance
          </h2>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-700 dark:text-gray-300">
                Theme
              </label>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
                className="px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white"
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
          </div>
        </section>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </main>
    </div>
  );
};
