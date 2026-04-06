import React from 'react';
import { useI18n } from '../../i18n';
import { ProviderType, ProviderConfig } from '../../types';
import { getImageSupportStatus, ImageSupportStatus, supportsReasoning } from '../../utils/modelCapabilities';
import { CustomSelect } from '../common';

interface ProviderConfigProps {
  config: Partial<ProviderConfig>;
  onChange: (config: Partial<ProviderConfig>) => void;
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
}

const PROVIDERS: { value: ProviderType; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'kimi', label: 'Kimi (Moonshot)' },
  { value: 'glm', label: 'GLM (Zhipu)' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'qwen', label: 'Qwen (Tongyi Qianwen)' },
];

const MODELS: Record<ProviderType, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview', 'o1-mini'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  kimi: ['kimi-k2.5','kimi-k2-thinking'],
  glm: ['glm-5', 'glm-4.7', 'glm-4.6', 'glm-4.6v'],
  minimax: ['MiniMax-M2.5', 'MiniMax-M2.7'],
  qwen: ['qwen3-max-2026-01-23', 'qwen3.5-plus-2026-02-15','qwen3.5-plus', 'qwen3-coder-next'],
};

function getImageSupportBadge(status: ImageSupportStatus): string {
  switch (status) {
    case 'supported':
      return 'supported';
    case 'unsupported':
      return 'unsupported';
    default:
      return 'unknown';
  }
}

function getImageSupportDescription(status: ImageSupportStatus, t: ReturnType<typeof useI18n>['t']): string {
  switch (status) {
    case 'supported':
      return t('settings.provider.imageSupportedDesc');
    case 'unsupported':
      return t('settings.provider.imageUnsupportedDesc');
    default:
      return t('settings.provider.imageUnknownDesc');
  }
}

function fieldIdPrefix(title?: string): string {
  return (title || 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export const ProviderConfigForm: React.FC<ProviderConfigProps> = ({
  config,
  onChange,
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
}) => {
  const { t } = useI18n();
  const idPrefix = fieldIdPrefix(title);
  const provider = config.provider;
  const hasSavedProviderConfig = provider ? Boolean(configuredProviders[provider]) : false;

  const handleChange = (key: keyof ProviderConfig, value: string | boolean) => {
    onChange({ ...config, [key]: value });
  };

  const handleProviderChange = (provider: ProviderType) => {
    onChange({
      ...config,
      provider,
      model: '',
      enable_reasoning: false,
    });
  };

  const handleModelChange = (model: string) => {
    const reasoningEnabled = provider ? supportsReasoning(provider, model) : false;
    onChange({
      ...config,
      model,
      enable_reasoning: reasoningEnabled,
    });
  };

  const showReasoningToggle = Boolean(provider && config.model && supportsReasoning(provider, config.model));
  const selectedImageSupport = provider && config.model
    ? getImageSupportStatus(provider, config.model)
    : 'unknown';
  const testButtonClassName = testButtonVariant === "secondary"
    ? "rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800"
    : "rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white";

  return (
    <div className="space-y-4">
      {title && (
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
              options={MODELS[provider].map((modelName) => ({
                value: modelName,
                label: modelName,
                hint: t(`settings.provider.image${getImageSupportBadge(getImageSupportStatus(provider, modelName)).charAt(0).toUpperCase()}${getImageSupportBadge(getImageSupportStatus(provider, modelName)).slice(1)}`),
              }))}
            />
            {config.model && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {getImageSupportDescription(selectedImageSupport, t)}
              </p>
            )}
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

          {showReasoningToggle && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`${idPrefix}-enable-reasoning`}
                checked={config.enable_reasoning ?? true}
                onChange={(e) => handleChange('enable_reasoning', e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              <label htmlFor={`${idPrefix}-enable-reasoning`} className="text-sm text-gray-700 dark:text-gray-300">
                {t('settings.provider.enableReasoning')}
              </label>
            </div>
          )}

          {onTestConnection && (
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
