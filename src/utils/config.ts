import { ProviderConfig, ProviderType } from '../types';
import { getSupportedInputTypes, supportsReasoning } from './modelCapabilities';

export const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ollama: 'http://127.0.0.1:11434',
};

export function getDefaultBaseUrl(provider: ProviderType): string {
  return DEFAULT_BASE_URLS[provider];
}

export function normalizeBaseUrl(provider: ProviderType, baseUrl?: string): string {
  const trimmed = baseUrl?.trim();
  return trimmed || getDefaultBaseUrl(provider);
}

export function normalizeProviderConfig(config: ProviderConfig): ProviderConfig {
  const inputType = config.input_type || 'text';
  const supportedInputTypes = getSupportedInputTypes(config.provider, config.model);

  return {
    ...config,
    base_url: normalizeBaseUrl(config.provider, config.base_url),
    enable_reasoning: Boolean(config.enable_reasoning) && supportsReasoning(config.provider, config.model),
    input_type: supportedInputTypes.includes(inputType) ? inputType : 'text',
  };
}
