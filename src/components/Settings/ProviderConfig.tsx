import React, { useEffect, useMemo, useState } from 'react';
import { translate, useI18n } from '../../i18n';
import { InputType, ProviderCatalogModel, ProviderType, ProviderConfig, ReasoningMode } from '../../types';
import {
  getDefaultContextLength,
} from '../../utils/modelCapabilities';
import { normalizeBaseUrl } from '../../utils/config';
import { listProviderModels } from '../../utils/providerModels';
import {
  canChangeReasoningMode,
  coerceReasoningModeForModel,
  resolveReasoningMode,
  resolveReasoningSupportStatus,
  resolveReasoningToggleStatus,
  toLegacyEnableReasoning,
} from '../../utils/reasoningConfig';
import {
  coerceInputTypeForModel,
  resolveConfiguredInputType,
  resolveImageSupportStatus,
} from '../../utils/imageConfig';
import { CustomSelect } from '../common';

interface ProviderConfigProps {
  config: Partial<ProviderConfig>;
  onChange: (config: Partial<ProviderConfig>) => void;
  onCatalogLoaded?: (provider: ProviderType, models: ProviderCatalogModel[]) => void;
  configuredProviders?: Partial<Record<ProviderType, boolean>>;
  title?: string;
  onTestConnection?: () => void;
  canTestConnection?: boolean;
  testConnectionStatus?: "idle" | "testing" | "success" | "error";
  testConnectionError?: string | null;
  testConnectionLabel?: string;
  testConnectionBusyLabel?: string;
  testConnectionSuccessLabel?: string;
  testConnectionFailureLabel?: string;
  testButtonVariant?: "primary" | "secondary";
  enableDynamicModelCatalog?: boolean;
  showTitle?: boolean;
  showReasoningToggle?: boolean;
  showConnectionTest?: boolean;
}

const PROVIDERS: { value: ProviderType; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'kimi', label: 'Kimi (Moonshot)' },
  { value: 'glm', label: 'GLM (Zhipu)' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'qwen', label: 'Qwen (Tongyi Qianwen)' },
];

const BUILT_IN_MODELS: Record<ProviderType, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview', 'o1-mini'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  kimi: ['kimi-k2.5','kimi-k2-thinking'],
  glm: ['glm-5', 'glm-4.7', 'glm-4.6', 'glm-4.6v'],
  minimax: ['MiniMax-M2.5', 'MiniMax-M2.7'],
  qwen: ['qwen3-max-2026-01-23', 'qwen3.5-plus-2026-02-15','qwen3.5-plus', 'qwen3-coder-next'],
};

function getImageSupportBadge(status: ProviderCatalogModel['image_support']): string {
  switch (status) {
    case 'supported':
      return 'supported';
    case 'unknown':
      return 'unknown';
    default:
      return 'unsupported';
  }
}

function getImageSupportDescription(status: ProviderCatalogModel['image_support'], t: ReturnType<typeof useI18n>['t']): string {
  switch (status) {
    case 'supported':
      return t('settings.provider.imageSupportedDesc');
    case 'unknown':
      return t('settings.provider.imageUnknownDesc');
    default:
      return t('settings.provider.imageUnsupportedDesc');
  }
}

function getContextLengthDescription(
  contextLength: number | undefined,
  t: ReturnType<typeof useI18n>['t']
): string | null {
  if (!contextLength) {
    return null;
  }

  return t('settings.provider.contextLengthDesc', {
    context: formatContextLength(contextLength),
  });
}

function formatContextLength(contextLength: number): string {
  if (contextLength % 1000 === 0) {
    return `${Math.round(contextLength / 1000)}K`;
  }

  if (contextLength % 1024 === 0) {
    return `${Math.round(contextLength / 1024)}K`;
  }

  if (contextLength >= 1000) {
    return `${Math.round(contextLength / 1000)}K`;
  }

  return String(contextLength);
}

function buildModelHint(
  _provider: ProviderType,
  _modelName: string,
  t: ReturnType<typeof useI18n>['t'],
  metadata?: ProviderCatalogModel
): string {
  const imageSupportStatus = resolveImageSupportStatus(metadata);
  const parts = [
    t(
      `settings.provider.image${getImageSupportBadge(imageSupportStatus).charAt(0).toUpperCase()}${getImageSupportBadge(imageSupportStatus).slice(1)}`
    ),
  ];

  if (metadata?.context_length) {
    parts.push(
      t('settings.provider.contextLengthShort', {
        context: formatContextLength(metadata.context_length),
      })
    );
  }

  return parts.join(' · ');
}

function getReasoningSupportBadge(
  metadata: ProviderCatalogModel | undefined,
  t: ReturnType<typeof useI18n>['t']
): string {
  const support = resolveReasoningSupportStatus(metadata);
  if (support === 'supported') {
    return t('common.supported');
  }
  if (support === 'unsupported') {
    return t('common.unsupported');
  }
  return t('common.unknown');
}

function getReasoningHint(
  metadata: ProviderCatalogModel | undefined,
  t: ReturnType<typeof useI18n>['t']
): string {
  const support = resolveReasoningSupportStatus(metadata);
  const toggle = resolveReasoningToggleStatus(metadata);

  if (toggle === 'fixed_on') {
    return t('settings.provider.reasoningFixedOnHint');
  }
  if (toggle === 'fixed_off' || support === 'unsupported') {
    return t('settings.provider.reasoningUnsupportedHint');
  }
  if (toggle === 'can_toggle') {
    return t('settings.provider.reasoningToggleHint');
  }
  if (support === 'unknown') {
    return t('settings.provider.reasoningUnknownHint');
  }
  return t('settings.provider.reasoningToggleHint');
}

function getInputModeHint(
  inputType: InputType,
  metadata: ProviderCatalogModel | undefined,
  t: ReturnType<typeof useI18n>['t']
): string {
  const support = resolveImageSupportStatus(metadata);
  if (support === 'unsupported') {
    return t('settings.provider.imageUnsupportedHint');
  }
  if (support === 'unknown') {
    return inputType === 'image'
      ? t('settings.provider.imageManualEnabledHint')
      : t('settings.provider.imageUnknownHint');
  }
  return inputType === 'image'
    ? t('settings.provider.imageModeImageHint')
    : t('settings.provider.imageModeTextHint');
}

function fieldIdPrefix(title?: string): string {
  return (title || 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export const ProviderConfigForm: React.FC<ProviderConfigProps> = ({
  config,
  onChange,
  onCatalogLoaded,
  configuredProviders = {},
  title,
  onTestConnection,
  canTestConnection = false,
  testConnectionStatus = "idle",
  testConnectionError = null,
  testConnectionLabel = "Test Connection",
  testConnectionBusyLabel = "Testing...",
  testConnectionSuccessLabel = "Connected",
  testConnectionFailureLabel = "Failed",
  testButtonVariant = "primary",
  enableDynamicModelCatalog = import.meta.env.MODE !== 'test',
  showTitle = true,
  showReasoningToggle = true,
  showConnectionTest = true,
}) => {
  const { t, locale } = useI18n();
  const idPrefix = fieldIdPrefix(title);
  const provider = config.provider;
  const hasSavedProviderConfig = provider ? Boolean(configuredProviders[provider]) : false;
  const [dynamicModels, setDynamicModels] = useState<ProviderCatalogModel[]>([]);
  const [isLoadingDynamicModels, setIsLoadingDynamicModels] = useState(false);
  const [dynamicModelsError, setDynamicModelsError] = useState<string | null>(null);
  const [customModelInput, setCustomModelInput] = useState('');

  const handleChange = (key: keyof ProviderConfig, value: string | boolean) => {
    onChange({ ...config, [key]: value });
  };

  const handleProviderChange = (provider: ProviderType) => {
    onChange({
      ...config,
      provider,
      model: '',
      enable_reasoning: false,
      reasoning_mode: 'default',
      input_type: 'text',
    });
  };

  const handleModelChange = (model: string) => {
    const selectedMetadata = provider ? dynamicModels.find((entry) => entry.id === model) : undefined;
    const reasoningMode = coerceReasoningModeForModel(resolveReasoningMode(config), selectedMetadata);
    const inputType = resolveConfiguredInputType(config, selectedMetadata);
    onChange({
      ...config,
      model,
      enable_reasoning: toLegacyEnableReasoning(reasoningMode),
      reasoning_mode: reasoningMode,
      input_type: inputType,
    });
  };

  const handleReasoningModeChange = (value: string) => {
    const nextMode = coerceReasoningModeForModel(value as ReasoningMode, selectedModelMetadata);
    onChange({
      ...config,
      reasoning_mode: nextMode,
      enable_reasoning: toLegacyEnableReasoning(nextMode),
    });
  };
  const handleInputTypeChange = (value: string) => {
    const nextInputType = coerceInputTypeForModel(value as InputType, selectedModelMetadata);
    onChange({
      ...config,
      input_type: nextInputType,
    });
  };

  const canShowReasoningMode = Boolean(provider && config.model);
  const builtInModels = provider ? BUILT_IN_MODELS[provider] : [];
  const resolvedBaseUrl = provider
    ? normalizeBaseUrl(provider, config.base_url || '')
    : '';
  const hasModelCatalogCredentials = Boolean(provider && config.api_key?.trim());
  const testButtonClassName = testButtonVariant === "secondary"
    ? "rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800"
    : "rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white";

  useEffect(() => {
    if (!enableDynamicModelCatalog || !provider) {
      setDynamicModels([]);
      setDynamicModelsError(null);
      setIsLoadingDynamicModels(false);
      return;
    }

    if (!hasModelCatalogCredentials) {
      setDynamicModels([]);
      setDynamicModelsError(null);
      setIsLoadingDynamicModels(false);
      return;
    }

    const controller = new AbortController();
    setIsLoadingDynamicModels(true);
    setDynamicModelsError(null);

    void listProviderModels(
      provider,
      resolvedBaseUrl,
      config.api_key || '',
      { signal: controller.signal },
    )
      .then((models) => {
        setDynamicModels(models);
        setDynamicModelsError(null);
        if (provider && models.length > 0) {
          onCatalogLoaded?.(provider, models);
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setDynamicModels([]);
        setDynamicModelsError(
          error instanceof Error
            ? error.message
            : translate(locale, 'settings.provider.modelCatalogFallback')
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingDynamicModels(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [config.api_key, enableDynamicModelCatalog, hasModelCatalogCredentials, locale, onCatalogLoaded, provider, resolvedBaseUrl]);

  const dynamicModelMap = useMemo(() => new Map(dynamicModels.map((entry) => [entry.id, entry])), [dynamicModels]);

  const selectedModelMetadata = provider && config.model
    ? dynamicModelMap.get(config.model)
    : undefined;
  const reasoningMode = coerceReasoningModeForModel(resolveReasoningMode(config), selectedModelMetadata);
  const reasoningModeDisabled = !canChangeReasoningMode(selectedModelMetadata);
  const selectedImageSupport = resolveImageSupportStatus(selectedModelMetadata);
  const selectedInputType = resolveConfiguredInputType(config, selectedModelMetadata);
  const selectedContextLength = provider && config.model
    ? selectedModelMetadata?.context_length ?? getDefaultContextLength(provider, config.model)
    : undefined;
  const baseModelEntries = useMemo(() => (
    dynamicModels.length > 0
      ? dynamicModels
      : builtInModels.map((modelName) => ({ id: modelName }))
  ), [builtInModels, dynamicModels]);
  const baseModelIds = useMemo(() => new Set(baseModelEntries.map((entry) => entry.id)), [baseModelEntries]);
  const selectedModelIsListed = Boolean(config.model && baseModelIds.has(config.model));

  const modelOptions = useMemo(() => {
    if (!provider) {
      return [];
    }

    const mergedModels = config.model && !baseModelEntries.some((entry) => entry.id === config.model)
      ? [{ id: config.model }, ...baseModelEntries]
      : baseModelEntries;

    return mergedModels.map((entry) => ({
      value: entry.id,
      label: entry.id,
      hint: buildModelHint(provider, entry.id, t, entry),
    }));
  }, [baseModelEntries, config.model, provider, t]);

  useEffect(() => {
    if (!config.model || selectedModelIsListed) {
      setCustomModelInput('');
      return;
    }

    setCustomModelInput(config.model);
  }, [config.model, selectedModelIsListed]);

  const modelCatalogStatus = !provider
    ? null
    : !enableDynamicModelCatalog
      ? { tone: 'neutral', message: t('settings.provider.modelCatalogBuiltin') }
    : isLoadingDynamicModels
      ? { tone: 'neutral', message: t('settings.provider.modelCatalogLoading') }
      : dynamicModels.length > 0
        ? { tone: 'success', message: t('settings.provider.modelCatalogLive') }
        : dynamicModelsError
          ? { tone: 'warning', message: t('settings.provider.modelCatalogFallback') }
          : hasModelCatalogCredentials
            ? { tone: 'neutral', message: t('settings.provider.modelCatalogBuiltin') }
            : { tone: 'neutral', message: t('settings.provider.modelCatalogNeedsKey') };

  const modelCatalogClassName = modelCatalogStatus?.tone === 'success'
    ? 'text-emerald-600 dark:text-emerald-400'
    : modelCatalogStatus?.tone === 'warning'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-gray-500 dark:text-gray-400';
  const canApplyCustomModel = customModelInput.trim().length > 0 && customModelInput.trim() !== (config.model || '');
  const reasoningModeOptions = [
    {
      value: 'default',
      label: t('settings.provider.reasoningModeDefault'),
      hint: t('settings.provider.reasoningModeDefaultHint'),
    },
    {
      value: 'on',
      label: t('settings.provider.reasoningModeOn'),
      hint: t('settings.provider.reasoningModeOnHint'),
    },
    {
      value: 'off',
      label: t('settings.provider.reasoningModeOff'),
      hint: t('settings.provider.reasoningModeOffHint'),
    },
  ];
  const inputTypeOptions = [
    {
      value: 'text',
      label: t('settings.provider.inputModeText'),
      hint: t('settings.provider.inputModeTextHint'),
    },
    {
      value: 'image',
      label: t('settings.provider.inputModeImage'),
      hint: t('settings.provider.inputModeImageHint'),
    },
  ];

  return (
    <div className="space-y-4">
      {showTitle && title && (
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {title}
        </h3>
      )}
      <div>
        <label
          id={`${idPrefix}-provider-label`}
          className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t('settings.provider.provider')}
        </label>
        <CustomSelect
          ariaLabel={`${title || 'Model'} Provider`}
          ariaLabelledBy={`${idPrefix}-provider-label`}
          value={config.provider || ''}
          onChange={(nextValue) => handleProviderChange(nextValue as ProviderType)}
          placeholder={t('settings.provider.selectProvider')}
          options={PROVIDERS.map((item) => ({
            value: item.value,
            label: item.label,
            hint: configuredProviders[item.value] ? t('settings.provider.savedConfigHint') : undefined,
          }))}
        />
        {provider && hasSavedProviderConfig && (
          <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
            {t('settings.provider.savedConfigFound')}
          </p>
        )}
      </div>

      {provider && (
        <>
          <div>
            <label
              id={`${idPrefix}-model-label`}
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t('settings.provider.model')}
            </label>
            <CustomSelect
              ariaLabel={`${title || 'Model'} Model`}
              ariaLabelledBy={`${idPrefix}-model-label`}
              value={config.model || ''}
              onChange={handleModelChange}
              placeholder={t('settings.provider.selectModel')}
              options={modelOptions}
            />
            {modelCatalogStatus && (
              <p className={`mt-2 text-xs ${modelCatalogClassName}`}>
                {modelCatalogStatus.message}
              </p>
            )}
            {config.model && (
              <div className="mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                <p>{getImageSupportDescription(selectedImageSupport, t)}</p>
                {selectedContextLength && (
                  <p>{getContextLengthDescription(selectedContextLength, t)}</p>
                )}
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor={`${idPrefix}-custom-model`}
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t('settings.provider.customModel')}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id={`${idPrefix}-custom-model`}
                type="text"
                value={customModelInput}
                onChange={(event) => setCustomModelInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canApplyCustomModel) {
                    event.preventDefault();
                    handleModelChange(customModelInput.trim());
                  }
                }}
                placeholder={t('settings.provider.customModelPlaceholder')}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
              <button
                type="button"
                onClick={() => handleModelChange(customModelInput.trim())}
                disabled={!canApplyCustomModel}
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800"
              >
                {t('settings.provider.useCustomModel')}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {t('settings.provider.customModelHint')}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('settings.provider.apiKey')}
            </label>
            <input
              type="password"
              value={config.api_key || ''}
              onChange={(e) => handleChange('api_key', e.target.value)}
              placeholder={t('settings.provider.enterApiKey')}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('settings.provider.baseUrl')}
            </label>
            <input
              type="text"
              value={config.base_url || ''}
              onChange={(e) => handleChange('base_url', e.target.value)}
              placeholder={t('settings.provider.customApiEndpoint')}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            />
          </div>

          {showReasoningToggle && canShowReasoningMode && (
            <div className="space-y-2">
              <div>
                <label
                  id={`${idPrefix}-reasoning-mode-label`}
                  className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {t('settings.provider.reasoningMode')}
                </label>
                <CustomSelect
                  ariaLabel={`${title || 'Model'} Reasoning Mode`}
                  ariaLabelledBy={`${idPrefix}-reasoning-mode-label`}
                  value={reasoningMode}
                  onChange={handleReasoningModeChange}
                  options={reasoningModeOptions}
                  disabled={reasoningModeDisabled}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('settings.provider.reasoningSupportLabel', {
                  value: getReasoningSupportBadge(selectedModelMetadata, t),
                })}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {getReasoningHint(selectedModelMetadata, t)}
              </p>
            </div>
          )}

          {provider && config.model && (
            <div className="space-y-2">
              <div>
                <label
                  id={`${idPrefix}-input-mode-label`}
                  className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {t('settings.provider.inputMode')}
                </label>
                <CustomSelect
                  ariaLabel={`${title || 'Model'} Input Mode`}
                  ariaLabelledBy={`${idPrefix}-input-mode-label`}
                  value={selectedInputType}
                  onChange={handleInputTypeChange}
                  options={inputTypeOptions}
                  disabled={selectedImageSupport === 'unsupported'}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('settings.provider.imageSupportLabel', {
                  value: t(
                    `settings.provider.image${getImageSupportBadge(selectedImageSupport).charAt(0).toUpperCase()}${getImageSupportBadge(selectedImageSupport).slice(1)}`
                  ),
                })}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {getInputModeHint(selectedInputType, selectedModelMetadata, t)}
              </p>
            </div>
          )}

          {showConnectionTest && onTestConnection && (
            <div className="rounded-2xl border border-dashed border-gray-200 p-4 dark:border-gray-700">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onTestConnection}
                  disabled={testConnectionStatus === "testing" || !canTestConnection}
                  className={testButtonClassName}
                >
                  {testConnectionStatus === "testing" ? testConnectionBusyLabel : testConnectionLabel}
                </button>
                {testConnectionStatus === "success" && (
                  <span className="text-sm text-emerald-600 dark:text-emerald-400">{testConnectionSuccessLabel}</span>
                )}
                {testConnectionStatus === "error" && (
                  <span className="text-sm text-red-500">
                    {testConnectionFailureLabel}{testConnectionError ? `: ${testConnectionError}` : ""}
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
