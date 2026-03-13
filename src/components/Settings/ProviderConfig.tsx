import React from 'react';
import { ProviderType, ProviderConfig } from '../../types';
import { supportsReasoning } from '../../utils/modelCapabilities';

interface ProviderConfigProps {
  config: Partial<ProviderConfig>;
  onChange: (config: Partial<ProviderConfig>) => void;
  title?: string;
}

const PROVIDERS: { value: ProviderType; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'qwen', label: 'Qwen (Tongyi Qianwen)' },
  { value: 'ollama', label: 'Ollama (Local)' },
];

const MODELS: Record<ProviderType, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview', 'o1-mini'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  qwen: ['qwen3-max-2026-01-23', 'qwen3.5-plus', 'qwen3-coder-next'],
  ollama: ['llama3.1', 'llama3.2', 'qwen3:8b', 'mistral', 'codellama'],
};

export const ProviderConfigForm: React.FC<ProviderConfigProps> = ({ config, onChange, title }) => {
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
    const provider = config.provider;
    const reasoningEnabled = provider ? supportsReasoning(provider, model) : false;
    onChange({
      ...config,
      model,
      enable_reasoning: reasoningEnabled,
    });
  };

  const showReasoningToggle = Boolean(config.provider && config.model && supportsReasoning(config.provider, config.model));

  return (
    <div className="space-y-4">
      {title && (
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {title}
        </h3>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Provider
        </label>
        <select
          aria-label={`${title || 'Model'} Provider`}
          value={config.provider || ''}
          onChange={(e) => handleProviderChange(e.target.value as ProviderType)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
          <option value="">Select a provider</option>
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {config.provider && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Model
            </label>
            <select
              aria-label={`${title || 'Model'} Model`}
              value={config.model || ''}
              onChange={(e) => handleModelChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            >
              <option value="">Select a model</option>
              {MODELS[config.provider].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {config.provider !== 'ollama' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                API Key
              </label>
              <input
                type="password"
                value={config.api_key || ''}
                onChange={(e) => handleChange('api_key', e.target.value)}
                placeholder="Enter your API key"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Base URL (optional)
            </label>
            <input
              type="text"
              value={config.base_url || ''}
              onChange={(e) => handleChange('base_url', e.target.value)}
              placeholder="Custom API endpoint"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            />
          </div>

          {showReasoningToggle && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enable_reasoning"
                checked={config.enable_reasoning ?? true}
                onChange={(e) => handleChange('enable_reasoning', e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              <label htmlFor="enable_reasoning" className="text-sm text-gray-700 dark:text-gray-300">
                Enable reasoning
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
};
