import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProviderConfigForm } from '../components/Settings/ProviderConfig';
import { useConfigStore } from '../stores/configStore';
import { useUIStore } from '../stores';
import { ProviderConfig } from '../types';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { config, setConfig } = useConfigStore();
  const { theme, setTheme } = useUIStore();
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  const handleTest = async () => {
    if (!config) return;

    setTestStatus('testing');
    setTestError(null);

    try {
      const baseUrl = config.base_url || getDefaultBaseUrl(config.provider);
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${config.api_key}`,
        },
      });

      if (response.ok) {
        setTestStatus('success');
      } else {
        const error = await response.text();
        setTestStatus('error');
        setTestError(error);
      }
    } catch (error) {
      setTestStatus('error');
      setTestError(error instanceof Error ? error.message : 'Connection failed');
    }
  };

  const getDefaultBaseUrl = (provider: string): string => {
    switch (provider) {
      case 'openai': return 'https://api.openai.com/v1';
      case 'qwen': return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
      case 'ollama': return 'http://localhost:11434/v1';
      default: return '';
    }
  };

  const handleSave = () => {
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
              config={config || {}}
              onChange={(partialConfig) => setConfig(partialConfig as ProviderConfig)}
            />
            {config?.provider && config.provider !== 'ollama' && (
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
                  <span className="text-red-500 text-sm" title={testError || ''}>
                    Failed
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