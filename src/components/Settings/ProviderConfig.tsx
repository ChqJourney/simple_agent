import React from 'react';
import { ProviderType, ProviderConfig } from '../../types';

interface ProviderConfigProps {
  config: Partial<ProviderConfig>;
  onChange: (config: Partial<ProviderConfig>) => void;
}

const PROVIDERS: { value: ProviderType; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'qwen', label: 'Qwen (通义千问)' },
  { value: 'ollama', label: 'Ollama (本地)' },
];

const MODELS: Record<ProviderType, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview', 'o1-mini'],
  qwen: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
  ollama: ['llama3.1', 'llama3.2', 'qwen2.5', 'mistral', 'codellama'],
};

export const ProviderConfigForm: React.FC<ProviderConfigProps> = ({ config, onChange }) => {
  const handleChange = (key: keyof ProviderConfig, value: string | boolean) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className="provider-config space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Provider
        </label>
        <select
          value={config.provider || ''}
          onChange={(e) => handleChange('provider', e.target.value as ProviderType)}
          className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Model
            </label>
            <select
              value={config.model || ''}
              onChange={(e) => handleChange('model', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API Key
              </label>
              <input
                type="password"
                value={config.api_key || ''}
                onChange={(e) => handleChange('api_key', e.target.value)}
                placeholder="Enter your API key"
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Base URL (optional)
            </label>
            <input
              type="text"
              value={config.base_url || ''}
              onChange={(e) => handleChange('base_url', e.target.value)}
              placeholder="Custom API endpoint"
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enable_reasoning"
              checked={config.enable_reasoning || false}
              onChange={(e) => handleChange('enable_reasoning', e.target.checked)}
              className="rounded"
            />
            <label htmlFor="enable_reasoning" className="text-sm text-gray-700">
              Enable reasoning (for o1 models)
            </label>
          </div>
        </>
      )}
    </div>
  );
};