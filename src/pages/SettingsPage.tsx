import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProviderConfigForm } from '../components/Settings/ProviderConfig';
import { useConfigStore } from '../stores/configStore';
import { useUIStore } from '../stores';
import { ModelProfile, ProviderConfig, ProviderType } from '../types';
import { useWebSocket } from '../contexts/WebSocketContext';
import {
  DEFAULT_RUNTIME_POLICY,
  normalizeBaseFontSize,
  normalizeBaseUrl,
  normalizeContextProviders,
  normalizeProviderMemory,
  normalizeProviderConfig,
} from '../utils/config';
import { buildBackendAuthHeaders, getBackendAuthToken } from '../utils/backendAuth';
import { backendTestConfigUrl } from '../utils/backendEndpoint';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
type ProfileName = 'primary' | 'secondary';

interface ConnectionTestState {
  status: TestStatus;
  error: string | null;
}

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { config, setConfig } = useConfigStore();
  const { theme, setTheme, baseFontSize, setBaseFontSize } = useUIStore();
  const { sendConfig } = useWebSocket();
  const [draftConfig, setDraftConfig] = useState<Partial<ProviderConfig>>(config || {});
  const [draftBaseFontSize, setDraftBaseFontSize] = useState<number>(
    normalizeBaseFontSize(config?.appearance?.base_font_size ?? baseFontSize)
  );
  const [connectionTests, setConnectionTests] = useState<Record<ProfileName, ConnectionTestState>>({
    primary: { status: 'idle', error: null },
    secondary: { status: 'idle', error: null },
  });
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDraftConfig(config || {});
    setDraftBaseFontSize(normalizeBaseFontSize(config?.appearance?.base_font_size ?? baseFontSize));
  }, [baseFontSize, config]);

  const primaryProfile: Partial<ModelProfile> = draftConfig.profiles?.primary || draftConfig;
  const secondaryProfile: Partial<ModelProfile> = draftConfig.profiles?.secondary || {};
  const providerMemory = normalizeProviderMemory(draftConfig.provider_memory);
  const contextProviders = normalizeContextProviders(draftConfig.context_providers);
  const configuredProviders = Object.entries(providerMemory).reduce((acc, [provider, entry]) => ({
    ...acc,
    [provider]: Boolean(entry?.api_key || entry?.base_url),
  }), {} as Partial<Record<ProviderType, boolean>>);
  if (primaryProfile.provider) {
    configuredProviders[primaryProfile.provider] = Boolean(primaryProfile.api_key || primaryProfile.base_url);
  }
  if (secondaryProfile.provider) {
    configuredProviders[secondaryProfile.provider] = Boolean(secondaryProfile.api_key || secondaryProfile.base_url);
  }
  const resolvedRuntime = {
    context_length: draftConfig.runtime?.context_length ?? DEFAULT_RUNTIME_POLICY.context_length,
    max_output_tokens: draftConfig.runtime?.max_output_tokens ?? DEFAULT_RUNTIME_POLICY.max_output_tokens,
    max_tool_rounds: draftConfig.runtime?.max_tool_rounds ?? DEFAULT_RUNTIME_POLICY.max_tool_rounds,
    max_retries: draftConfig.runtime?.max_retries ?? DEFAULT_RUNTIME_POLICY.max_retries,
  };

  const setConnectionTestState = (profileName: ProfileName, status: TestStatus, error: string | null = null) => {
    setConnectionTests((prev) => ({
      ...prev,
      [profileName]: { status, error },
    }));
  };

  const getProfileForTest = (profileName: ProfileName): Partial<ModelProfile> => (
    profileName === 'primary' ? primaryProfile : secondaryProfile
  );

  const isProfileTestable = (profile: Partial<ModelProfile>): boolean => {
    if (!profile.provider || !profile.model) {
      return false;
    }
    return profile.provider === 'ollama' || Boolean(profile.api_key);
  };

  const updateProfile = (profileName: 'primary' | 'secondary', updates: Partial<ModelProfile>) => {
    const currentProfile = profileName === 'primary'
      ? (draftConfig.profiles?.primary || draftConfig)
      : (draftConfig.profiles?.secondary || {});
    const currentProvider = currentProfile.provider;
    const nextProvider = updates.provider || currentProvider;
    const providerChanged = Boolean(updates.provider && updates.provider !== currentProvider);
    const nextProviderMemory = {
      ...providerMemory,
    };

    if (currentProvider) {
      nextProviderMemory[currentProvider] = {
        model: currentProfile.model || '',
        api_key: currentProfile.api_key || '',
        base_url: currentProfile.base_url || '',
      };
    }

    const rememberedProviderSettings = nextProvider ? nextProviderMemory[nextProvider] : undefined;
    const normalizedUpdates = providerChanged
      ? {
          ...updates,
          model: rememberedProviderSettings?.model || '',
          api_key: rememberedProviderSettings?.api_key || '',
          base_url: rememberedProviderSettings?.base_url || '',
        }
      : updates;
    const nextCurrentProfile = {
      ...currentProfile,
      ...normalizedUpdates,
    };
    if (nextProvider) {
      nextProviderMemory[nextProvider] = {
        model: nextCurrentProfile.model || '',
        api_key: nextCurrentProfile.api_key || '',
        base_url: nextCurrentProfile.base_url || '',
      };
    }

    const nextProfiles = {
      primary: profileName === 'primary'
        ? nextCurrentProfile
        : { ...(draftConfig.profiles?.primary || draftConfig) },
      ...(profileName === 'secondary'
        ? { secondary: nextCurrentProfile }
        : draftConfig.profiles?.secondary
          ? { secondary: { ...draftConfig.profiles.secondary } }
          : {}),
    };

    const nextPrimary = nextProfiles.primary;
    setDraftConfig({
      ...draftConfig,
      ...nextPrimary,
      profiles: nextProfiles as ProviderConfig['profiles'],
      provider_memory: nextProviderMemory,
    });
  };

  const handleTest = async (profileName: ProfileName) => {
    const profile = getProfileForTest(profileName);
    if (!profile.provider || !profile.model) {
      setConnectionTestState(profileName, 'error', 'Provider and model are required');
      return;
    }

    if (profile.provider !== 'ollama' && !profile.api_key) {
      setConnectionTestState(profileName, 'error', 'API key is required for this provider');
      return;
    }

    setConnectionTestState(profileName, 'testing', null);

    try {
      const authToken = await getBackendAuthToken({ isTestMode: import.meta.env.MODE === 'test' });
      if (!authToken) {
        setConnectionTestState(profileName, 'error', 'Backend auth handshake failed');
        return;
      }

      const baseUrl = normalizeBaseUrl(profile.provider, profile.base_url);
      const response = await fetch(backendTestConfigUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildBackendAuthHeaders(authToken),
        },
        body: JSON.stringify({
          provider: profile.provider,
          model: profile.model,
          api_key: profile.api_key,
          base_url: baseUrl,
          enable_reasoning: profile.enable_reasoning ?? false,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (response.status === 404) {
        setConnectionTestState(profileName, 'error', 'Backend endpoint /test-config not found. Please update backend build.');
        return;
      }

      if (response.ok && payload.ok) {
        setConnectionTestState(profileName, 'success', null);
        return;
      }
      setConnectionTestState(profileName, 'error', payload.error || 'Connection test failed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      if (message.toLowerCase().includes('failed to fetch')) {
        setConnectionTestState(
          profileName,
          'error',
          `Cannot reach backend endpoint: ${backendTestConfigUrl}`
        );
        return;
      }
      setConnectionTestState(profileName, 'error', message);
    }
  };

  const handleSave = () => {
    setSaveError(null);

    if (!primaryProfile.provider || !primaryProfile.model) {
      setSaveError('Provider and model are required');
      return;
    }

    if (secondaryProfile.provider && !secondaryProfile.model) {
      setSaveError('Secondary model is required when a secondary provider is selected');
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
      provider_memory: {
        ...providerMemory,
        [primaryProfile.provider]: {
          model: primaryProfile.model || '',
          api_key: primaryProfile.api_key || '',
          base_url: primaryProfile.base_url || '',
        },
        ...(secondaryProfile.provider
          ? {
              [secondaryProfile.provider]: {
                model: secondaryProfile.model || '',
                api_key: secondaryProfile.api_key || '',
                base_url: secondaryProfile.base_url || '',
              },
            }
          : {}),
      },
      runtime: {
        context_length: resolvedRuntime.context_length,
        max_output_tokens: resolvedRuntime.max_output_tokens,
        max_tool_rounds: resolvedRuntime.max_tool_rounds,
        max_retries: resolvedRuntime.max_retries,
      },
      appearance: {
        base_font_size: normalizeBaseFontSize(draftBaseFontSize),
      },
      context_providers: contextProviders,
    });

    setBaseFontSize(normalizeBaseFontSize(draftBaseFontSize));
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
              configuredProviders={configuredProviders}
              onChange={(nextConfig) => updateProfile('primary', nextConfig)}
            />
            <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
              <ProviderConfigForm
                title="Secondary Model"
                config={secondaryProfile}
                configuredProviders={configuredProviders}
                onChange={(nextConfig) => updateProfile('secondary', nextConfig)}
              />
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Used for background helper tasks such as title generation. Falls back to the primary model when unset.
              </p>
            </div>
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleTest('primary')}
                  disabled={connectionTests.primary.status === 'testing' || !isProfileTestable(primaryProfile)}
                  className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  {connectionTests.primary.status === 'testing' ? 'Testing Primary...' : 'Test Primary Connection'}
                </button>
                {connectionTests.primary.status === 'success' && (
                  <span className="text-green-500 text-sm">Primary connected</span>
                )}
                {connectionTests.primary.status === 'error' && (
                  <span className="text-red-500 text-sm">
                    Primary failed{connectionTests.primary.error ? `: ${connectionTests.primary.error}` : ''}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleTest('secondary')}
                  disabled={connectionTests.secondary.status === 'testing' || !isProfileTestable(secondaryProfile)}
                  className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  {connectionTests.secondary.status === 'testing' ? 'Testing Secondary...' : 'Test Secondary Connection'}
                </button>
                {connectionTests.secondary.status === 'success' && (
                  <span className="text-green-500 text-sm">Secondary connected</span>
                )}
                {connectionTests.secondary.status === 'error' && (
                  <span className="text-red-500 text-sm">
                    Secondary failed{connectionTests.secondary.error ? `: ${connectionTests.secondary.error}` : ''}
                  </span>
                )}
              </div>
            </div>
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
                value={resolvedRuntime.context_length}
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
                value={resolvedRuntime.max_output_tokens}
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
                value={resolvedRuntime.max_tool_rounds}
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
                value={resolvedRuntime.max_retries}
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
                  Scan local skill metadata into the system prompt and allow the agent to load full instructions with `skill_loader`.
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
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Local skills contribute YAML frontmatter to the system prompt; full skill instructions are loaded on demand.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Appearance
          </h2>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-gray-700 dark:text-gray-300" htmlFor="theme">
                Theme
              </label>
              <select
                id="theme"
                value={theme}
                onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
                className="px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white"
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-4">
              <label htmlFor="base-font-size" className="text-sm text-gray-700 dark:text-gray-300">
                Base Font Size
              </label>
              <input
                id="base-font-size"
                type="number"
                min={12}
                max={20}
                value={draftBaseFontSize}
                onChange={(e) => {
                  const nextValue = e.target.value ? Number(e.target.value) : baseFontSize;
                  const normalizedSize = normalizeBaseFontSize(nextValue);
                  setDraftBaseFontSize(normalizedSize);
                  setBaseFontSize(normalizedSize);
                }}
                className="w-24 px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white"
              />
            </div>
          </div>
        </section>

        <div className="space-y-2">
          {saveError && (
            <p className="text-sm text-red-500">{saveError}</p>
          )}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};
