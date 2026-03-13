import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProviderConfigForm } from '../components/Settings/ProviderConfig';
import { useConfigStore } from '../stores/configStore';
import { useUIStore } from '../stores';
import { ModelProfile, ProviderConfig } from '../types';
import { useWebSocket } from '../contexts/WebSocketContext';
import { normalizeBaseUrl, normalizeContextProviders, normalizeProviderConfig } from '../utils/config';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

function parseExtensionsInput(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item.startsWith('.') ? item : `.${item}`));
}

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

  const primaryProfile: Partial<ModelProfile> = draftConfig.profiles?.primary || draftConfig;
  const secondaryProfile: Partial<ModelProfile> = draftConfig.profiles?.secondary || {};
  const contextProviders = normalizeContextProviders(draftConfig.context_providers);

  const updateProfile = (profileName: 'primary' | 'secondary', updates: Partial<ModelProfile>) => {
    const nextProfiles = {
      primary: profileName === 'primary'
        ? { ...(draftConfig.profiles?.primary || draftConfig), ...updates }
        : { ...(draftConfig.profiles?.primary || draftConfig) },
      ...(profileName === 'secondary'
        ? { secondary: { ...(draftConfig.profiles?.secondary || {}), ...updates } }
        : draftConfig.profiles?.secondary
          ? { secondary: { ...draftConfig.profiles.secondary } }
          : {}),
    };

    const nextPrimary = nextProfiles.primary;
    setDraftConfig({
      ...draftConfig,
      ...nextPrimary,
      profiles: nextProfiles as ProviderConfig['profiles'],
    });
  };

  const handleTest = async () => {
    if (!primaryProfile.provider || !primaryProfile.model) return;

    setTestStatus('testing');
    setTestError(null);

    try {
      const baseUrl = normalizeBaseUrl(primaryProfile.provider, primaryProfile.base_url);
      const response = await fetch('http://127.0.0.1:8765/test-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: primaryProfile.provider,
          model: primaryProfile.model,
          api_key: primaryProfile.api_key,
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
    if (!primaryProfile.provider || !primaryProfile.model) {
      setTestStatus('error');
      setTestError('Provider and model are required');
      return;
    }

    if (primaryProfile.provider !== 'ollama' && !primaryProfile.api_key) {
      setTestStatus('error');
      setTestError('API key is required for this provider');
      return;
    }

    if (secondaryProfile.provider && !secondaryProfile.model) {
      setTestStatus('error');
      setTestError('Secondary model is required when a secondary provider is selected');
      return;
    }

    if (secondaryProfile.provider && secondaryProfile.provider !== 'ollama' && !secondaryProfile.api_key) {
      setTestStatus('error');
      setTestError('API key is required for the secondary provider');
      return;
    }

    const normalizedConfig = normalizeProviderConfig({
      provider: primaryProfile.provider,
      model: primaryProfile.model,
      api_key: primaryProfile.api_key || '',
      base_url: primaryProfile.base_url || '',
      enable_reasoning: primaryProfile.enable_reasoning ?? false,
      input_type: primaryProfile.input_type || 'text',
      profiles: {
        primary: {
          provider: primaryProfile.provider,
          model: primaryProfile.model,
          api_key: primaryProfile.api_key || '',
          base_url: primaryProfile.base_url || '',
          enable_reasoning: primaryProfile.enable_reasoning ?? false,
          input_type: primaryProfile.input_type || 'text',
          profile_name: 'primary',
        },
        ...(secondaryProfile.provider && secondaryProfile.model
          ? {
              secondary: {
                provider: secondaryProfile.provider,
                model: secondaryProfile.model,
                api_key: secondaryProfile.api_key || '',
                base_url: secondaryProfile.base_url || '',
                enable_reasoning: secondaryProfile.enable_reasoning ?? false,
                input_type: secondaryProfile.input_type || 'text',
                profile_name: 'secondary',
              },
            }
          : {}),
      },
      runtime: {
        context_length: draftConfig.runtime?.context_length,
        max_output_tokens: draftConfig.runtime?.max_output_tokens,
        max_tool_rounds: draftConfig.runtime?.max_tool_rounds,
        max_retries: draftConfig.runtime?.max_retries,
      },
      context_providers: contextProviders,
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
              title="Primary Model"
              config={primaryProfile}
              onChange={(nextConfig) => updateProfile('primary', nextConfig)}
            />
            <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
              <ProviderConfigForm
                title="Secondary Model"
                config={secondaryProfile}
                onChange={(nextConfig) => updateProfile('secondary', nextConfig)}
              />
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Used for background helper tasks such as title generation. Falls back to the primary model when unset.
              </p>
            </div>
            {primaryProfile.provider && primaryProfile.provider !== 'ollama' && (
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
            Runtime Limits
          </h2>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-4">
            <div>
              <label htmlFor="context-length" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Context Length
              </label>
              <input
                id="context-length"
                type="number"
                min={0}
                value={draftConfig.runtime?.context_length ?? ''}
                onChange={(e) =>
                  setDraftConfig({
                    ...draftConfig,
                    runtime: {
                      ...draftConfig.runtime,
                      context_length: e.target.value ? Number(e.target.value) : undefined,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              />
            </div>

            <div>
              <label htmlFor="max-output-tokens" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Max Output Tokens
              </label>
              <input
                id="max-output-tokens"
                type="number"
                min={1}
                value={draftConfig.runtime?.max_output_tokens ?? ''}
                onChange={(e) =>
                  setDraftConfig({
                    ...draftConfig,
                    runtime: {
                      ...draftConfig.runtime,
                      max_output_tokens: e.target.value ? Number(e.target.value) : undefined,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              />
            </div>

            <div>
              <label htmlFor="max-tool-rounds" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Max Tool Rounds
              </label>
              <input
                id="max-tool-rounds"
                type="number"
                min={1}
                value={draftConfig.runtime?.max_tool_rounds ?? ''}
                onChange={(e) =>
                  setDraftConfig({
                    ...draftConfig,
                    runtime: {
                      ...draftConfig.runtime,
                      max_tool_rounds: e.target.value ? Number(e.target.value) : undefined,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              />
            </div>

            <div>
              <label htmlFor="max-retries" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Max Retries
              </label>
              <input
                id="max-retries"
                type="number"
                min={1}
                value={draftConfig.runtime?.max_retries ?? ''}
                onChange={(e) =>
                  setDraftConfig({
                    ...draftConfig,
                    runtime: {
                      ...draftConfig.runtime,
                      max_retries: e.target.value ? Number(e.target.value) : undefined,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Context Providers
          </h2>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label htmlFor="enable-local-skills" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Enable Local Skills
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Load matching local `SKILL.md` instructions into the agent context.
                </p>
              </div>
              <input
                id="enable-local-skills"
                type="checkbox"
                checked={contextProviders.skills?.local?.enabled ?? true}
                onChange={(e) =>
                  setDraftConfig({
                    ...draftConfig,
                    context_providers: {
                      ...contextProviders,
                      skills: {
                        ...contextProviders.skills,
                        local: {
                          enabled: e.target.checked,
                        },
                      },
                    },
                  })
                }
                className="rounded border-gray-300 dark:border-gray-600"
              />
            </div>

            <div className="border-t border-gray-200 pt-4 dark:border-gray-700 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label htmlFor="enable-workspace-retrieval" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Enable Workspace Retrieval
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Search workspace files for lightweight supporting context before each run.
                  </p>
                </div>
                <input
                  id="enable-workspace-retrieval"
                  type="checkbox"
                  checked={contextProviders.retrieval?.workspace?.enabled ?? true}
                  onChange={(e) =>
                    setDraftConfig({
                      ...draftConfig,
                      context_providers: {
                        ...contextProviders,
                        retrieval: {
                          ...contextProviders.retrieval,
                          workspace: {
                            ...contextProviders.retrieval?.workspace,
                            enabled: e.target.checked,
                          },
                        },
                      },
                    })
                  }
                  className="rounded border-gray-300 dark:border-gray-600"
                />
              </div>

              <div>
                <label htmlFor="retrieval-max-hits" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Retrieval Max Hits
                </label>
                <input
                  id="retrieval-max-hits"
                  type="number"
                  min={1}
                  value={contextProviders.retrieval?.workspace?.max_hits ?? 3}
                  onChange={(e) =>
                    setDraftConfig({
                      ...draftConfig,
                      context_providers: {
                        ...contextProviders,
                        retrieval: {
                          ...contextProviders.retrieval,
                          workspace: {
                            enabled: contextProviders.retrieval?.workspace?.enabled ?? true,
                            extensions: contextProviders.retrieval?.workspace?.extensions,
                            max_hits: e.target.value ? Number(e.target.value) : 3,
                          },
                        },
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                />
              </div>

              <div>
                <label htmlFor="retrieval-file-types" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Retrieval File Types
                </label>
                <input
                  id="retrieval-file-types"
                  type="text"
                  value={(contextProviders.retrieval?.workspace?.extensions || []).join(', ')}
                  onChange={(e) =>
                    setDraftConfig({
                      ...draftConfig,
                      context_providers: {
                        ...contextProviders,
                        retrieval: {
                          ...contextProviders.retrieval,
                          workspace: {
                            enabled: contextProviders.retrieval?.workspace?.enabled ?? true,
                            max_hits: contextProviders.retrieval?.workspace?.max_hits ?? 3,
                            extensions: parseExtensionsInput(e.target.value),
                          },
                        },
                      },
                    })
                  }
                  placeholder=".md, .txt, .json"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                />
              </div>
            </div>
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
