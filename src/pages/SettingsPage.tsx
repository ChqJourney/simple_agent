import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProviderConfigForm } from '../components/Settings/ProviderConfig';
import { CustomSelect } from '../components/common';
import { useConfigStore } from '../stores/configStore';
import { useUIStore } from '../stores';
import { ExecutionRole, ModelProfile, ProviderConfig, ProviderType, RuntimePolicy } from '../types';
import { useWebSocket } from '../contexts/WebSocketContext';
import {
  normalizeBaseFontSize,
  normalizeBaseUrl,
  normalizeContextProviders,
  normalizeOcrConfig,
  normalizeProviderMemory,
  normalizeProviderConfig,
  normalizeRuntimeConfig,
  resolveProfileForRole,
  resolveRuntimePolicy,
} from '../utils/config';
import { buildBackendAuthHeaders, getBackendAuthToken } from '../utils/backendAuth';
import { backendTestConfigUrl } from '../utils/backendEndpoint';
import { getDefaultContextLength } from '../utils/modelCapabilities';
import { inspectOcrSidecarInstallation, installOcrSidecar, OcrSidecarInstallInfo } from '../utils/ocr';
import { listSystemSkills, SkillEntry } from '../utils/systemSkills';
import { listTools, ToolCatalogEntry } from '../utils/toolCatalog';
import { AppLocale, useI18n } from '../i18n';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
type ProfileName = 'primary' | 'background';
type SettingsTab = 'model' | 'runtime' | 'tools' | 'skills' | 'ocr' | 'ui';
type RuntimeSectionKey = 'shared' | 'conversation' | 'background' | 'compaction' | 'delegated_task';

interface ConnectionTestState {
  status: TestStatus;
  error: string | null;
}

interface OcrInstallState {
  loading: boolean;
  installing: boolean;
  error: string | null;
  info: OcrSidecarInstallInfo | null;
}

const APP_FONT_LABEL = 'Inter';
const APP_FONT_STACK = "'Inter', system-ui, Avenir, Helvetica, Arial, sans-serif";
const CONNECTION_TEST_TIMEOUT_MS = 15000;
const SETTINGS_PAGE_CLASS =
  'min-h-screen bg-[linear-gradient(180deg,rgba(241,245,249,0.9),rgba(255,255,255,1))] dark:bg-[radial-gradient(circle_at_top,rgba(142,160,182,0.14),transparent_34%),linear-gradient(180deg,rgba(23,26,31,0.98),rgba(18,21,26,1)_52%,rgba(13,16,20,1)_100%)]';
const SETTINGS_CARD_CLASS =
  'rounded-[1.75rem] border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700/80 dark:bg-gray-900/72 dark:shadow-black/10';
const SETTINGS_PANEL_CLASS =
  'rounded-2xl border border-slate-200/70 bg-slate-50/85 p-4 dark:border-slate-700/70 dark:bg-slate-900/35';
const SETTINGS_ROW_CLASS =
  'rounded-2xl border border-gray-200 px-4 py-4 dark:border-gray-700/80 dark:bg-gray-950/18';

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { config, setConfig } = useConfigStore();
  const { t } = useI18n();
  const { theme, setTheme, locale: currentLocale, setLocale, baseFontSize, setBaseFontSize } = useUIStore();
  const { sendConfig } = useWebSocket();
  const [activeTab, setActiveTab] = useState<SettingsTab>('model');
  const [draftConfig, setDraftConfig] = useState<Partial<ProviderConfig>>(config || {});
  const [draftBaseFontSize, setDraftBaseFontSize] = useState<number>(
    normalizeBaseFontSize(config?.appearance?.base_font_size ?? baseFontSize)
  );
  const [connectionTests, setConnectionTests] = useState<Record<ProfileName, ConnectionTestState>>({
    primary: { status: 'idle', error: null },
    background: { status: 'idle', error: null },
  });
  const [systemSkills, setSystemSkills] = useState<SkillEntry[]>([]);
  const [skillsRootPaths, setSkillsRootPaths] = useState<string[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolCatalogEntry[]>([]);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [ocrInstallState, setOcrInstallState] = useState<OcrInstallState>({
    loading: true,
    installing: false,
    error: null,
    info: null,
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const settingsTabs: Array<{ value: SettingsTab; label: string; description: string }> = [
    { value: 'model', label: t('settings.tab.model'), description: t('settings.tab.modelDescription') },
    { value: 'runtime', label: t('settings.tab.runtime'), description: t('settings.tab.runtimeDescription') },
    { value: 'tools', label: t('settings.tab.tools'), description: t('settings.tab.toolsDescription') },
    { value: 'skills', label: t('settings.tab.skills'), description: t('settings.tab.skillsDescription') },
    { value: 'ocr', label: t('settings.tab.ocr'), description: t('settings.tab.ocrDescription') },
    { value: 'ui', label: t('settings.tab.ui'), description: t('settings.tab.uiDescription') },
  ];
  const themeOptions = [
    { value: 'system', label: t('settings.ui.theme.system'), hint: t('settings.ui.theme.systemHint') },
    { value: 'light', label: t('settings.ui.theme.light'), hint: t('settings.ui.theme.lightHint') },
    { value: 'dark', label: t('settings.ui.theme.dark'), hint: t('settings.ui.theme.darkHint') },
  ];
  const localeOptions = [
    { value: 'en-US', label: t('settings.ui.locale.en-US') },
    { value: 'zh-CN', label: t('settings.ui.locale.zh-CN') },
  ];
  const runtimeFieldConfig: Array<{ key: keyof RuntimePolicy; label: string; min: number }> = [
    { key: 'context_length', label: t('settings.runtime.contextLength'), min: 0 },
    { key: 'max_output_tokens', label: t('settings.runtime.maxOutputTokens'), min: 1 },
    { key: 'max_tool_rounds', label: t('settings.runtime.maxToolRounds'), min: 1 },
    { key: 'max_retries', label: t('settings.runtime.maxRetries'), min: 1 },
  ];
  const delegatedTaskRuntimeFieldConfig: Array<{ key: keyof RuntimePolicy; label: string; min: number }> = [
    { key: 'timeout_seconds', label: t('settings.runtime.timeoutSeconds'), min: 1 },
  ];
  const roleRuntimeSections: Array<{
    key: Exclude<RuntimeSectionKey, 'shared'>;
    title: string;
    description: string;
    role: ExecutionRole;
    fields?: Array<{ key: keyof RuntimePolicy; label: string; min: number }>;
  }> = [
    {
      key: 'conversation',
      title: t('settings.runtime.conversationTitle'),
      description: t('settings.runtime.conversationDescription'),
      role: 'conversation',
    },
    {
      key: 'background',
      title: t('settings.runtime.backgroundTitle'),
      description: t('settings.runtime.backgroundDescription'),
      role: 'background',
    },
    {
      key: 'compaction',
      title: t('settings.runtime.compactionTitle'),
      description: t('settings.runtime.compactionDescription'),
      role: 'compaction',
    },
    {
      key: 'delegated_task',
      title: t('settings.runtime.delegatedTitle'),
      description: t('settings.runtime.delegatedDescription'),
      role: 'delegated_task',
      fields: delegatedTaskRuntimeFieldConfig,
    },
  ];

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
          setSkillsError(error instanceof Error ? error.message : t('settings.error.scanSkills'));
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

  useEffect(() => {
    let cancelled = false;

    const loadTools = async () => {
      setToolsLoading(true);
      setToolsError(null);
      try {
        const toolCatalog = await listTools();
        if (!cancelled) {
          setTools(toolCatalog);
        }
      } catch (error) {
        if (!cancelled) {
          setToolsError(error instanceof Error ? error.message : t('settings.error.loadTools'));
          setTools([]);
        }
      } finally {
        if (!cancelled) {
          setToolsLoading(false);
        }
      }
    };

    void loadTools();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadOcrInstallInfo = async () => {
      setOcrInstallState((current) => ({
        ...current,
        loading: true,
        error: null,
      }));

      try {
        const info = await inspectOcrSidecarInstallation();
        if (!cancelled) {
          setOcrInstallState({
            loading: false,
            installing: false,
            error: null,
            info,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setOcrInstallState({
            loading: false,
            installing: false,
            error: error instanceof Error ? error.message : t('settings.error.inspectOcr'),
            info: null,
          });
        }
      }
    };

    void loadOcrInstallInfo();
    return () => {
      cancelled = true;
    };
  }, []);

  const primaryProfile: Partial<ModelProfile> = draftConfig.profiles?.primary || draftConfig;
  const backgroundProfile: Partial<ModelProfile> = draftConfig.profiles?.background || {};
  const providerMemory = normalizeProviderMemory(draftConfig.provider_memory);
  const contextProviders = normalizeContextProviders(draftConfig.context_providers);
  const ocrConfig = normalizeOcrConfig(draftConfig.ocr);
  const disabledToolNames = new Set(contextProviders.tools?.disabled ?? []);
  const disabledSystemSkillNames = new Set(contextProviders.skills?.system?.disabled ?? []);
  const configuredProviders = Object.entries(providerMemory).reduce((acc, [provider, entry]) => ({
    ...acc,
    [provider]: Boolean(entry?.api_key || entry?.base_url),
  }), {} as Partial<Record<ProviderType, boolean>>);

  if (primaryProfile.provider) {
    configuredProviders[primaryProfile.provider] = Boolean(primaryProfile.api_key || primaryProfile.base_url);
  }
  if (backgroundProfile.provider) {
    configuredProviders[backgroundProfile.provider] = Boolean(backgroundProfile.api_key || backgroundProfile.base_url);
  }

  const normalizedRuntime = normalizeRuntimeConfig(draftConfig.runtime);
  const sharedRuntime = normalizedRuntime.shared;
  const conversationRuntime = resolveRuntimePolicy(draftConfig.runtime, 'conversation');
  const backgroundRuntime = resolveRuntimePolicy(draftConfig.runtime, 'background');
  const compactionRuntime = resolveRuntimePolicy(draftConfig.runtime, 'compaction');
  const delegatedTaskRuntime = resolveRuntimePolicy(draftConfig.runtime, 'delegated_task');

  const getRuntimeSectionDraft = (sectionKey: RuntimeSectionKey): RuntimePolicy | undefined => {
    if (sectionKey === 'shared') {
      return draftConfig.runtime?.shared;
    }
    return draftConfig.runtime?.[sectionKey];
  };

  const getEffectiveRuntimeSection = (sectionKey: RuntimeSectionKey): Required<RuntimePolicy> => {
    if (sectionKey === 'shared') {
      return sharedRuntime;
    }
    if (sectionKey === 'conversation') {
      return conversationRuntime;
    }
    if (sectionKey === 'background') {
      return backgroundRuntime;
    }
    if (sectionKey === 'delegated_task') {
      return delegatedTaskRuntime;
    }
    return compactionRuntime;
  };

  const getRuntimeWarnings = (sectionKey: RuntimeSectionKey): string[] => {
    if (sectionKey === 'delegated_task') {
      return [];
    }

    const effectiveRuntime = getEffectiveRuntimeSection(sectionKey);
    const warnings: string[] = [];

    if (effectiveRuntime.max_output_tokens > effectiveRuntime.context_length) {
      warnings.push(
        t('settings.runtime.outputExceedsContext', {
          output: effectiveRuntime.max_output_tokens,
          context: effectiveRuntime.context_length,
        })
      );
    }

    if (sectionKey === 'shared') {
      return warnings;
    }

    const role = roleRuntimeSections.find((section) => section.key === sectionKey)?.role;
    const profile = role ? resolveProfileForRole(draftConfig as ProviderConfig, role) : undefined;
    if (!profile?.provider || !profile.model) {
      return warnings;
    }

    const knownContextLength = getDefaultContextLength(profile.provider, profile.model);
    if (knownContextLength && effectiveRuntime.context_length > knownContextLength) {
      warnings.push(
        t('settings.runtime.contextExceedsModel', {
          context: effectiveRuntime.context_length,
          provider: profile.provider,
          model: profile.model,
          knownContext: knownContextLength,
        })
      );
    }

    return warnings;
  };

  const updateRuntimeSectionValue = (
    sectionKey: RuntimeSectionKey,
    field: keyof RuntimePolicy,
    rawValue: string
  ) => {
    const parsedValue = rawValue ? Number(rawValue) : undefined;
    const nextRuntime = {
      ...(draftConfig.runtime || {}),
    };
    const nextSection = {
      ...(getRuntimeSectionDraft(sectionKey) || {}),
    };

    if (parsedValue === undefined) {
      delete nextSection[field];
    } else {
      nextSection[field] = parsedValue;
    }

    if (Object.keys(nextSection).length === 0) {
      delete nextRuntime[sectionKey];
    } else {
      nextRuntime[sectionKey] = nextSection;
    }

    setDraftConfig({
      ...draftConfig,
      runtime: Object.keys(nextRuntime).length > 0 ? nextRuntime : undefined,
    });
  };

  const toggleDisabledTool = (toolName: string, disabled: boolean) => {
    const nextDisabledTools = disabled
      ? Array.from(new Set([...(contextProviders.tools?.disabled ?? []), toolName])).sort((left, right) => left.localeCompare(right))
      : (contextProviders.tools?.disabled ?? []).filter((name) => name !== toolName);

    setDraftConfig({
      ...draftConfig,
      context_providers: {
        ...contextProviders,
        tools: {
          disabled: nextDisabledTools,
        },
      },
    });
  };

  const toggleDisabledSystemSkill = (skillName: string, disabled: boolean) => {
    const nextDisabledSystemSkills = disabled
      ? Array.from(new Set([...(contextProviders.skills?.system?.disabled ?? []), skillName])).sort((left, right) => left.localeCompare(right))
      : (contextProviders.skills?.system?.disabled ?? []).filter((name) => name !== skillName);

    setDraftConfig({
      ...draftConfig,
      context_providers: {
        ...contextProviders,
        skills: {
          ...contextProviders.skills,
          system: {
            disabled: nextDisabledSystemSkills,
          },
        },
      },
    });
  };

  const setConnectionTestState = (profileName: ProfileName, status: TestStatus, error: string | null = null) => {
    setConnectionTests((prev) => ({
      ...prev,
      [profileName]: { status, error },
    }));
  };

  const getProfileForTest = (profileName: ProfileName): Partial<ModelProfile> => (
    profileName === 'primary' ? primaryProfile : backgroundProfile
  );

  const isProfileTestable = (profile: Partial<ModelProfile>): boolean => {
    if (!profile.provider || !profile.model) {
      return false;
    }
    return profile.provider === 'ollama' || Boolean(profile.api_key);
  };

  const updateProfile = (profileName: 'primary' | 'background', updates: Partial<ModelProfile>) => {
    const currentProfile = profileName === 'primary'
      ? (draftConfig.profiles?.primary || draftConfig)
      : (draftConfig.profiles?.background || {});
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
      ...(profileName === 'background'
        ? { background: nextCurrentProfile }
        : draftConfig.profiles?.background
          ? { background: { ...draftConfig.profiles.background } }
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
      setConnectionTestState(profileName, 'error', t('settings.validation.providerModelRequired'));
      return;
    }

    if (profile.provider !== 'ollama' && !profile.api_key) {
      setConnectionTestState(profileName, 'error', t('settings.validation.apiKeyRequired'));
      return;
    }

    setConnectionTestState(profileName, 'testing', null);
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      abortController.abort();
    }, CONNECTION_TEST_TIMEOUT_MS);

    try {
      const authToken = await getBackendAuthToken({ isTestMode: import.meta.env.MODE === 'test' });
      if (!authToken) {
        setConnectionTestState(profileName, 'error', t('settings.validation.backendAuthFailed'));
        return;
      }

      const baseUrl = normalizeBaseUrl(profile.provider, profile.base_url);
      const response = await fetch(backendTestConfigUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildBackendAuthHeaders(authToken),
        },
        signal: abortController.signal,
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
        setConnectionTestState(profileName, 'error', t('settings.validation.testEndpointMissing'));
        return;
      }

      if (response.ok && payload.ok) {
        setConnectionTestState(profileName, 'success', null);
        return;
      }
      setConnectionTestState(profileName, 'error', payload.error || t('settings.validation.connectionTestFailed'));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setConnectionTestState(
          profileName,
          'error',
          t('settings.validation.connectionTimedOut', {
            seconds: Math.round(CONNECTION_TEST_TIMEOUT_MS / 1000),
          })
        );
        return;
      }

      const message = error instanceof Error ? error.message : t('settings.validation.connectionFailed');
      if (message.toLowerCase().includes('failed to fetch')) {
        setConnectionTestState(
          profileName,
          'error',
          t('settings.validation.cannotReachBackend', { url: backendTestConfigUrl })
        );
        return;
      }
      setConnectionTestState(profileName, 'error', message);
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const handleSave = () => {
    setSaveError(null);

    if (!primaryProfile.provider || !primaryProfile.model) {
      setSaveError(t('settings.validation.providerModelRequired'));
      return;
    }

    if (backgroundProfile.provider && !backgroundProfile.model) {
      setSaveError(t('settings.validation.backgroundModelRequired'));
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
        ...(backgroundProfile.provider && backgroundProfile.model
          ? {
              background: {
                provider: backgroundProfile.provider,
                model: backgroundProfile.model,
                api_key: backgroundProfile.api_key || '',
                base_url: backgroundProfile.base_url || '',
                enable_reasoning: backgroundProfile.enable_reasoning ?? false,
                input_type: backgroundProfile.input_type || 'text',
                profile_name: 'background',
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
        ...(backgroundProfile.provider
          ? {
              [backgroundProfile.provider]: {
                model: backgroundProfile.model || '',
                api_key: backgroundProfile.api_key || '',
                base_url: backgroundProfile.base_url || '',
              },
            }
          : {}),
      },
      runtime: draftConfig.runtime,
      system_prompt: draftConfig.system_prompt || '',
      appearance: {
        base_font_size: normalizeBaseFontSize(draftBaseFontSize),
      },
      context_providers: contextProviders,
      ocr: ocrConfig,
    });

    setBaseFontSize(normalizeBaseFontSize(draftBaseFontSize));
    setConfig(normalizedConfig);
    sendConfig(normalizedConfig);
    navigate(-1);
  };

  const handleInstallOcr = async () => {
    setOcrInstallState((current) => ({
      ...current,
      installing: true,
      error: null,
    }));

    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('settings.ocr.selectFolderTitle'),
      });

      if (!selected || Array.isArray(selected)) {
        setOcrInstallState((current) => ({
          ...current,
          installing: false,
        }));
        return;
      }

      const info = await installOcrSidecar(selected);
      setOcrInstallState({
        loading: false,
        installing: false,
        error: null,
        info,
      });

      if (config?.ocr?.enabled) {
        sendConfig(config);
      }
    } catch (error) {
      setOcrInstallState((current) => ({
        ...current,
        installing: false,
        error: error instanceof Error ? error.message : t('settings.error.installOcr'),
      }));
    }
  };

  const renderTabContent = () => {
    if (activeTab === 'model') {
      return (
        <div className="space-y-6">
          <section className={SETTINGS_CARD_CLASS}>
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('settings.model.title')}</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t('settings.model.description')}
              </p>
            </div>

            <div className="space-y-5">
              <ProviderConfigForm
                title={t('settings.model.primary')}
                config={primaryProfile}
                configuredProviders={configuredProviders}
                onChange={(nextConfig) => updateProfile('primary', nextConfig)}
                onTestConnection={() => void handleTest('primary')}
                canTestConnection={isProfileTestable(primaryProfile)}
                testConnectionStatus={connectionTests.primary.status}
                testConnectionError={connectionTests.primary.error}
                testConnectionLabel={t('settings.model.primaryTest')}
                testConnectionBusyLabel={t('settings.model.primaryTesting')}
                testConnectionSuccessLabel={t('settings.model.primaryConnected')}
                testConnectionFailureLabel={t('settings.model.primaryFailed')}
                testButtonVariant="primary"
              />

              <div className="rounded-2xl border border-dashed border-gray-200 p-4 dark:border-gray-700/80 dark:bg-gray-950/12">
                <ProviderConfigForm
                  title={t('settings.model.background')}
                  config={backgroundProfile}
                  configuredProviders={configuredProviders}
                  onChange={(nextConfig) => updateProfile('background', nextConfig)}
                  onTestConnection={() => void handleTest('background')}
                  canTestConnection={isProfileTestable(backgroundProfile)}
                  testConnectionStatus={connectionTests.background.status}
                  testConnectionError={connectionTests.background.error}
                  testConnectionLabel={t('settings.model.backgroundTest')}
                  testConnectionBusyLabel={t('settings.model.backgroundTesting')}
                  testConnectionSuccessLabel={t('settings.model.backgroundConnected')}
                  testConnectionFailureLabel={t('settings.model.backgroundFailed')}
                  testButtonVariant="secondary"
                />
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  {t('settings.model.backgroundHint')}
                </p>
              </div>
            </div>
          </section>
        </div>
      );
    }

    if (activeTab === 'runtime') {
      const renderRuntimeSection = (
        sectionKey: RuntimeSectionKey,
        title: string,
        description: string,
        fields: Array<{ key: keyof RuntimePolicy; label: string; min: number }> = runtimeFieldConfig,
      ) => {
        const sectionDraft = getRuntimeSectionDraft(sectionKey);
        const effectiveRuntime = getEffectiveRuntimeSection(sectionKey);
        const runtimeWarnings = getRuntimeWarnings(sectionKey);
        const sectionPrefix = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        return (
          <section
            key={sectionKey}
            className={SETTINGS_CARD_CLASS}
          >
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {fields.map((field) => {
                const explicitValue = sectionDraft?.[field.key];
                const effectiveValue = effectiveRuntime[field.key];
                const inputValue = sectionKey === 'shared'
                  ? effectiveValue
                  : explicitValue ?? '';

                return (
                  <div key={field.key}>
                    <label
                      htmlFor={`${sectionPrefix}-${field.key}`}
                      className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >
                      {field.label}
                    </label>
                    <input
                      id={`${sectionPrefix}-${field.key}`}
                      aria-label={`${title} ${field.label}`}
                      type="number"
                      min={field.min}
                      value={inputValue}
                      onChange={(e) => updateRuntimeSectionValue(sectionKey, field.key, e.target.value)}
                      placeholder={sectionKey === 'shared' ? undefined : String(sharedRuntime[field.key])}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-gray-900 outline-none transition-colors focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </div>
                );
              })}
            </div>

            {sectionKey !== 'shared' && (
              <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                {sectionKey === 'delegated_task'
                  ? t('settings.runtime.effectiveTimeout', { timeout: effectiveRuntime.timeout_seconds ?? 0 })
                  : t('settings.runtime.effectiveValues', {
                      context: effectiveRuntime.context_length ?? 0,
                      output: effectiveRuntime.max_output_tokens ?? 0,
                      toolRounds: effectiveRuntime.max_tool_rounds ?? 0,
                      retries: effectiveRuntime.max_retries ?? 0,
                    })}
              </p>
            )}

            {runtimeWarnings.length > 0 && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
                {runtimeWarnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}
          </section>
        );
      };

      return (
        <div className="space-y-6">
          {renderRuntimeSection(
            'shared',
            t('settings.runtime.sharedTitle'),
            t('settings.runtime.sharedDescription')
          )}
          {roleRuntimeSections.map((section) =>
            renderRuntimeSection(section.key, section.title, section.description, section.fields)
          )}

          <section className={SETTINGS_CARD_CLASS}>
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('settings.runtime.customPromptTitle')}</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t('settings.runtime.customPromptDescription')}
              </p>
            </div>

            <div>
              <label htmlFor="custom-system-prompt" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('settings.runtime.additionalInstructions')}
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
                placeholder={t('settings.runtime.customPromptPlaceholder')}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 font-mono text-sm text-gray-900 outline-none transition-colors focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </section>
        </div>
      );
    }

    if (activeTab === 'tools') {
      return (
        <div className="space-y-6">
          <section className={SETTINGS_CARD_CLASS}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('settings.tools.title')}</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {t('settings.tools.description')}
                </p>
              </div>
              {tools.length > 0 && (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {t('settings.tools.total', { count: tools.length })}
                </span>
              )}
            </div>

            <div className="space-y-3">
              {toolsLoading && (
                <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {t('settings.tools.loading')}
                </div>
              )}

              {!toolsLoading && toolsError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                  {toolsError}
                </div>
              )}

              {!toolsLoading && !toolsError && tools.length === 0 && (
                <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {t('settings.tools.empty')}
                </div>
              )}

              {!toolsLoading && !toolsError && tools.map((tool) => {
                const enabled = !disabledToolNames.has(tool.name);

                return (
                  <div
                    key={tool.name}
                  className={SETTINGS_ROW_CLASS}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">{tool.name}</div>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{tool.description}</p>
                    </div>
                    <label className="flex items-center gap-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                      <span>{enabled ? t('common.enabled') : t('common.disabled')}</span>
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => toggleDisabledTool(tool.name, !event.target.checked)}
                        className="h-5 w-5 rounded border-gray-300 dark:border-gray-600"
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      );
    }

    if (activeTab === 'skills') {
      return (
        <div className="space-y-6">
          <section className={SETTINGS_CARD_CLASS}>
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('settings.skills.title')}</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t('settings.skills.description')}
              </p>
            </div>

            <div className={SETTINGS_PANEL_CLASS}>
              <div>
                <label htmlFor="enable-local-skills" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('settings.skills.enableLocalSkills')}
                </label>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('settings.skills.enableLocalSkillsDescription')}
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

          <section className={SETTINGS_CARD_CLASS}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('settings.skills.systemSkillsTitle')}</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {t('settings.skills.systemSkillsDescription')}
                </p>
              </div>
              {skillsRootPaths.length > 0 && (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {t('settings.skills.loaded', { count: systemSkills.length })}
                </span>
              )}
            </div>

            <div className={SETTINGS_PANEL_CLASS}>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                {t('settings.skills.skillRoots')}
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
                  {t('common.unavailable')}
                </div>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {skillsLoading && (
                <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {t('settings.skills.scanning')}
                </div>
              )}

              {!skillsLoading && skillsError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                  {skillsError}
                </div>
              )}

              {!skillsLoading && !skillsError && systemSkills.length === 0 && (
                <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {t('settings.skills.empty')}
                </div>
              )}

              {!skillsLoading && !skillsError && systemSkills.map((skill) => (
                <div
                  key={skill.path}
                  className={SETTINGS_ROW_CLASS}
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">{skill.name}</div>
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                        {skill.description || t('common.noDescription')}
                      </p>
                    </div>
                    <label className="flex items-center gap-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                      <span>{disabledSystemSkillNames.has(skill.name) ? t('common.disabled') : t('common.enabled')}</span>
                      <input
                        type="checkbox"
                        checked={!disabledSystemSkillNames.has(skill.name)}
                        onChange={(event) => toggleDisabledSystemSkill(skill.name, !event.target.checked)}
                        className="h-5 w-5 rounded border-gray-300 dark:border-gray-600"
                      />
                    </label>
                  </div>
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

    if (activeTab === 'ocr') {
      return (
        <div className="space-y-6">
          <section className={SETTINGS_CARD_CLASS}>
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('settings.ocr.title')}</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t('settings.ocr.description')}
              </p>
            </div>

            <div className={SETTINGS_PANEL_CLASS}>
              <div>
                <label htmlFor="enable-ocr" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('settings.ocr.enableTooling')}
                </label>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('settings.ocr.enableToolingDescription')}
                </p>
              </div>
              <input
                id="enable-ocr"
                type="checkbox"
                checked={ocrConfig.enabled}
                onChange={(e) =>
                  setDraftConfig({
                    ...draftConfig,
                    ocr: {
                      enabled: e.target.checked,
                    },
                  })
                }
                className="h-5 w-5 rounded border-gray-300 dark:border-gray-600"
              />
            </div>
          </section>

          <section className={SETTINGS_CARD_CLASS}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('settings.ocr.installationTitle')}</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {t('settings.ocr.installationDescription')}
                </p>
              </div>
              <button
                type="button"
                onClick={handleInstallOcr}
                disabled={ocrInstallState.installing}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-100"
              >
                {ocrInstallState.installing ? t('settings.ocr.installing') : t('settings.ocr.installButton')}
              </button>
            </div>

            <div className={`${SETTINGS_PANEL_CLASS} space-y-3`}>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                  {t('settings.ocr.installStatus')}
                </div>
                <div className="mt-2 text-sm text-gray-900 dark:text-gray-100">
                  {ocrInstallState.loading
                    ? t('settings.ocr.checking')
                    : ocrInstallState.info?.installed
                      ? `${t('settings.ocr.installed')}${ocrInstallState.info.version ? ` (v${ocrInstallState.info.version})` : ''}`
                      : t('settings.ocr.notInstalled')}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                  {t('settings.ocr.targetDirectory')}
                </div>
                <div className="mt-2 break-all font-mono text-sm text-gray-900 dark:text-gray-100">
                  {ocrInstallState.info?.installDir || t('common.unavailable')}
                </div>
              </div>

              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t('settings.ocr.chooseFolder')}
              </div>
            </div>

            {ocrInstallState.error && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                {ocrInstallState.error}
              </div>
            )}
          </section>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <section className={SETTINGS_CARD_CLASS}>
          <div className="mb-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('settings.ui.languageTitle')}</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('settings.ui.languageDescription')}
            </p>
          </div>

          <div className="max-w-md space-y-2">
            <label id="language-label" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('settings.ui.languageLabel')}
            </label>
            <CustomSelect
              id="language"
              ariaLabel={t('settings.ui.languageLabel')}
              ariaLabelledBy="language-label"
              value={currentLocale}
              onChange={(nextLocale) => setLocale(nextLocale as AppLocale)}
              options={localeOptions}
              showSelectedHint={false}
            />
          </div>
        </section>

        <section className={SETTINGS_CARD_CLASS}>
          <div className="mb-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('settings.ui.displayModeTitle')}</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('settings.ui.displayModeDescription')}
            </p>
          </div>

          <div className="max-w-md space-y-2">
            <label id="theme-label" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('settings.ui.themeLabel')}
            </label>
            <CustomSelect
              id="theme"
              ariaLabel={t('settings.ui.themeLabel')}
              ariaLabelledBy="theme-label"
              value={theme}
              onChange={(nextTheme) => setTheme(nextTheme as 'light' | 'dark' | 'system')}
              options={themeOptions}
            />
          </div>
        </section>

        <section className={SETTINGS_CARD_CLASS}>
          <div className="mb-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('settings.ui.typographyTitle')}</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('settings.ui.typographyDescription')}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr),220px]">
            <div className="rounded-2xl border border-slate-200/70 bg-[linear-gradient(135deg,rgba(148,163,184,0.14),rgba(226,232,240,0.5))] p-5 dark:border-slate-700/70 dark:bg-[linear-gradient(135deg,rgba(61,74,90,0.42),rgba(28,36,45,0.72))]">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                {t('settings.ui.currentFont')}
              </div>
              <div className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white" style={{ fontFamily: APP_FONT_STACK }}>
                {APP_FONT_LABEL}
              </div>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300" style={{ fontFamily: APP_FONT_STACK }}>
                {t('settings.ui.fontSample')}
              </div>
              <div className="mt-3 break-all font-mono text-xs text-gray-500 dark:text-gray-400">
                {APP_FONT_STACK}
              </div>
            </div>

            <div>
              <label htmlFor="base-font-size" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('settings.ui.baseFontSize')}
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
                {t('settings.ui.baseFontSizeHint')}
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  };

  return (
    <div className={SETTINGS_PAGE_CLASS}>
      <header className="flex h-16 items-center justify-between border-b border-gray-200/70 px-4 dark:border-gray-700/80 dark:bg-gray-950/18">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="rounded-xl p-2 text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/80"
            aria-label={t('about.back')}
            title={t('about.back')}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">{t('settings.title')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings.subtitle')}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate('/about')}
          className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700/80 dark:text-gray-200 dark:hover:bg-gray-800/80"
        >
          {t('settings.about')}
        </button>
      </header>

      <main className="mx-auto max-w-6xl p-6">
        <div className="flex items-start gap-6">
          <aside className="w-60 shrink-0 rounded-[1.75rem] border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700/80 dark:bg-gray-900/72 dark:shadow-black/10">
            <div className="space-y-1.5">
              {settingsTabs.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  className={`w-full rounded-2xl px-4 py-3 text-left transition-colors ${
                    activeTab === tab.value
                      ? 'bg-slate-900 text-white dark:bg-slate-700 dark:text-gray-50'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800/80'
                  }`}
                >
                  <div className="text-sm font-semibold">{tab.label}</div>
                  <div className={`mt-1 text-xs ${activeTab === tab.value ? 'text-white/80 dark:text-slate-200/80' : 'text-gray-500 dark:text-gray-400'}`}>
                    {tab.description}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <section className="min-w-0 flex-1 space-y-5">
            {renderTabContent()}

            <div className={SETTINGS_CARD_CLASS}>
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
