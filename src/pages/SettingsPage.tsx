import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProviderConfigForm } from '../components/Settings/ProviderConfig';
import { CustomSelect } from '../components/common';
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
import { listSystemSkills, SkillEntry } from '../utils/systemSkills';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
type ProfileName = 'primary' | 'secondary';
type SettingsTab = 'model' | 'runtime' | 'skills' | 'ui';

interface ConnectionTestState {
  status: TestStatus;
  error: string | null;
}

const SETTINGS_TABS: Array<{ value: SettingsTab; label: string; description: string }> = [
  { value: 'model', label: 'Model', description: 'Primary and secondary model profiles' },
  { value: 'runtime', label: 'Runtime', description: 'Context, output, retries, and tool limits' },
  { value: 'skills', label: 'Skill', description: 'System-level skills and local skill scanning' },
  { value: 'ui', label: 'UI', description: 'Theme, typography, and display preferences' },
];

const THEME_OPTIONS = [
  { value: 'system', label: 'System', hint: 'Follow the operating system preference' },
  { value: 'light', label: 'Light', hint: 'Bright interface for daytime use' },
  { value: 'dark', label: 'Dark', hint: 'Low-glare interface for darker environments' },
];

const APP_FONT_LABEL = 'Inter';
const APP_FONT_STACK = "'Inter', system-ui, Avenir, Helvetica, Arial, sans-serif";

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { config, setConfig } = useConfigStore();
  const { theme, setTheme, baseFontSize, setBaseFontSize } = useUIStore();
  const { sendConfig } = useWebSocket();
  const [activeTab, setActiveTab] = useState<SettingsTab>('model');
  const [draftConfig, setDraftConfig] = useState<Partial<ProviderConfig>>(config || {});
  const [draftBaseFontSize, setDraftBaseFontSize] = useState<number>(
    normalizeBaseFontSize(config?.appearance?.base_font_size ?? baseFontSize)
  );
  const [connectionTests, setConnectionTests] = useState<Record<ProfileName, ConnectionTestState>>({
    primary: { status: 'idle', error: null },
    secondary: { status: 'idle', error: null },
  });
  const [systemSkills, setSystemSkills] = useState<SkillEntry[]>([]);
  const [skillsRootPaths, setSkillsRootPaths] = useState<string[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDraftConfig(config || {});
    setDraftBaseFontSize(normalizeBaseFontSize(config?.appearance?.base_font_size ?? baseFontSize));
  }, [config]);

  useEffect(() => {
    let cancelled = false;

    const loadSkills = async () => {
      setSkillsLoading(true);
      setSkillsError(null);
      try {
        const catalog = await listSystemSkills();
        if (!cancelled) {
          setSystemSkills(catalog.skills);
          setSkillsRootPaths(catalog.rootPaths);
        }
      } catch (error) {
        if (!cancelled) {
          setSkillsError(error instanceof Error ? error.message : 'Failed to scan system skills.');
          setSystemSkills([]);
          setSkillsRootPaths([]);
        }
      } finally {
        if (!cancelled) {
          setSkillsLoading(false);
        }
      }
    };

    void loadSkills();
    return () => {
      cancelled = true;
    };
  }, []);

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
      system_prompt: draftConfig.system_prompt || '',
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

  const renderTabContent = () => {
    if (activeTab === 'model') {
      return (
        <div className="space-y-6">
          <section className="rounded-[1.75rem] border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Model Configuration</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Configure the main conversation model and the background helper model.
              </p>
            </div>

            <div className="space-y-5">
              <ProviderConfigForm
                title="Primary Model"
                config={primaryProfile}
                configuredProviders={configuredProviders}
                onChange={(nextConfig) => updateProfile('primary', nextConfig)}
              />

              <div className="rounded-2xl border border-dashed border-gray-200 p-4 dark:border-gray-700">
                <ProviderConfigForm
                  title="Secondary Model"
                  config={secondaryProfile}
                  configuredProviders={configuredProviders}
                  onChange={(nextConfig) => updateProfile('secondary', nextConfig)}
                />
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  Used for background helper tasks such as title generation. Falls back to the primary model when unset.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Connection Tests</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Verify that the configured providers can be reached before saving.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => handleTest('primary')}
                  disabled={connectionTests.primary.status === 'testing' || !isProfileTestable(primaryProfile)}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                >
                  {connectionTests.primary.status === 'testing' ? 'Testing Primary...' : 'Test Primary Connection'}
                </button>
                {connectionTests.primary.status === 'success' && (
                  <span className="text-sm text-emerald-600 dark:text-emerald-400">Primary connected</span>
                )}
                {connectionTests.primary.status === 'error' && (
                  <span className="text-sm text-red-500">
                    Primary failed{connectionTests.primary.error ? `: ${connectionTests.primary.error}` : ''}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => handleTest('secondary')}
                  disabled={connectionTests.secondary.status === 'testing' || !isProfileTestable(secondaryProfile)}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800"
                >
                  {connectionTests.secondary.status === 'testing' ? 'Testing Secondary...' : 'Test Secondary Connection'}
                </button>
                {connectionTests.secondary.status === 'success' && (
                  <span className="text-sm text-emerald-600 dark:text-emerald-400">Secondary connected</span>
                )}
                {connectionTests.secondary.status === 'error' && (
                  <span className="text-sm text-red-500">
                    Secondary failed{connectionTests.secondary.error ? `: ${connectionTests.secondary.error}` : ''}
                  </span>
                )}
              </div>
            </div>
          </section>
        </div>
      );
    }

    if (activeTab === 'runtime') {
      return (
        <div className="space-y-6">
          <section className="rounded-[1.75rem] border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Runtime Limits</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Tune conversation context, output size, tool rounds, and retry behavior.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="context-length" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-gray-900 outline-none transition-colors focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              <div>
                <label htmlFor="max-output-tokens" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-gray-900 outline-none transition-colors focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              <div>
                <label htmlFor="max-tool-rounds" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-gray-900 outline-none transition-colors focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              <div>
                <label htmlFor="max-retries" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-gray-900 outline-none transition-colors focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Custom System Prompt</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                This text is appended after the built-in system instructions. Leave blank to use the default prompt only.
              </p>
            </div>

            <div>
              <label htmlFor="custom-system-prompt" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Additional Instructions
              </label>
              <textarea
                id="custom-system-prompt"
                rows={8}
                value={draftConfig.system_prompt || ''}
                onChange={(e) =>
                  setDraftConfig({
                    ...draftConfig,
                    system_prompt: e.target.value,
                  })
                }
                placeholder="Example: Prefer concise answers. Mention risks before implementation details."
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 font-mono text-sm text-gray-900 outline-none transition-colors focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </section>
        </div>
      );
    }

    if (activeTab === 'skills') {
      return (
        <div className="space-y-6">
          <section className="rounded-[1.75rem] border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Skill Runtime</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Control whether local skills participate in the system prompt and inspect the app-level skill catalog.
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/60">
              <div>
                <label htmlFor="enable-local-skills" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Enable Local Skills
                </label>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
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
                className="h-5 w-5 rounded border-gray-300 dark:border-gray-600"
              />
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">System Skills</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  App-level skills discovered outside the current workspace, including the deployed app directory and app data directory.
                </p>
              </div>
              {skillsRootPaths.length > 0 && (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {systemSkills.length} loaded
                </span>
              )}
            </div>

            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/60">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                Skill Roots
              </div>
              {skillsRootPaths.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {skillsRootPaths.map((rootPath) => (
                    <div key={rootPath} className="break-all font-mono text-sm text-gray-900 dark:text-gray-100">
                      {rootPath}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 break-all font-mono text-sm text-gray-900 dark:text-gray-100">
                  Unavailable
                </div>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {skillsLoading && (
                <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  Scanning system skills...
                </div>
              )}

              {!skillsLoading && skillsError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                  {skillsError}
                </div>
              )}

              {!skillsLoading && !skillsError && systemSkills.length === 0 && (
                <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  No system-level skills were found in the configured app skill directories.
                </div>
              )}

              {!skillsLoading && !skillsError && systemSkills.map((skill) => (
                <div
                  key={skill.path}
                  className="rounded-2xl border border-gray-200 px-4 py-4 dark:border-gray-800"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{skill.name}</div>
                    <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-200">
                      system
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                    {skill.description || 'No description found in frontmatter.'}
                  </p>
                  <div className="mt-3 break-all font-mono text-xs text-gray-500 dark:text-gray-400">
                    {skill.path}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <section className="rounded-[1.75rem] border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Display Mode</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Switch between system, light, and dark themes using the custom UI selector.
            </p>
          </div>

          <div className="max-w-md space-y-2">
            <label id="theme-label" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Theme
            </label>
            <CustomSelect
              id="theme"
              ariaLabel="Theme"
              ariaLabelledBy="theme-label"
              value={theme}
              onChange={(nextTheme) => setTheme(nextTheme as 'light' | 'dark' | 'system')}
              options={THEME_OPTIONS}
            />
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Typography</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Review the current app font and adjust the base font size.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr),220px]">
            <div className="rounded-2xl bg-[linear-gradient(135deg,rgba(14,165,233,0.08),rgba(99,102,241,0.08))] p-5 dark:bg-[linear-gradient(135deg,rgba(14,165,233,0.14),rgba(99,102,241,0.14))]">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                Current Font
              </div>
              <div className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white" style={{ fontFamily: APP_FONT_STACK }}>
                {APP_FONT_LABEL}
              </div>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300" style={{ fontFamily: APP_FONT_STACK }}>
                The quick brown fox jumps over the lazy dog.
              </div>
              <div className="mt-3 break-all font-mono text-xs text-gray-500 dark:text-gray-400">
                {APP_FONT_STACK}
              </div>
            </div>

            <div>
              <label htmlFor="base-font-size" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-gray-900 outline-none transition-colors focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Applies immediately so you can preview the result before saving.
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,rgba(241,245,249,0.9),rgba(255,255,255,1))] dark:bg-[linear-gradient(180deg,rgba(2,6,23,0.98),rgba(15,23,42,1))]">
      <header className="flex h-16 items-center justify-between border-b border-gray-200/70 px-4 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="rounded-xl p-2 text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            aria-label="Go back"
            title="Go back"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Settings</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Tabs on the left, detailed controls on the right.</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate('/about')}
          className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          About
        </button>
      </header>

      <main className="mx-auto max-w-6xl p-6">
        <div className="flex items-start gap-6">
          <aside className="w-60 shrink-0 rounded-[1.75rem] border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="space-y-1.5">
              {SETTINGS_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  className={`w-full rounded-2xl px-4 py-3 text-left transition-colors ${
                    activeTab === tab.value
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="text-sm font-semibold">{tab.label}</div>
                  <div className={`mt-1 text-xs ${activeTab === tab.value ? 'text-white/80 dark:text-slate-700' : 'text-gray-500 dark:text-gray-400'}`}>
                    {tab.description}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <section className="min-w-0 flex-1 space-y-5">
            {renderTabContent()}

            <div className="rounded-[1.75rem] border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              {saveError && (
                <p className="mb-4 text-sm text-red-500">{saveError}</p>
              )}
              <div className="flex justify-end">
                <button
                  onClick={handleSave}
                  className="rounded-xl bg-blue-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-blue-700"
                >
                  Save
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};
