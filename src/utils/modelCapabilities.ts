import type { ImageSupportStatus, InputType, ProviderCatalogModel, ProviderType } from '../types';

const OPENAI_REASONING_PREFIXES = ['o1', 'o3', 'o4', 'gpt-5'];
const KIMI_REASONING_PREFIXES = ['kimi-k2.5', 'kimi-k2-thinking'];
const GLM_REASONING_PREFIXES = ['glm-5', 'glm-4.7', 'glm-4.6'];
const DEEPSEEK_REASONING_PREFIXES = ['deepseek-reasoner', 'deepseek-v4-'];
const MINIMAX_REASONING_PREFIXES: string[] = [];
const QWEN_REASONING_PREFIXES = ['qwen3', 'qwq'];

const DEFAULT_CONTEXT_LENGTH_PREFIXES: Partial<Record<ProviderType, Record<string, number>>> = {
  openai: {
    'gpt-4o': 128000,
    'gpt-4-turbo': 128000,
    o1: 128000,
    o3: 128000,
    o4: 128000,
    'gpt-5': 128000,
  },
  deepseek: {
    'deepseek-chat': 128000,
    'deepseek-reasoner': 128000,
  },
  kimi: {
    'kimi-k2.5': 256000,
    'kimi-k2-thinking': 256000,
  },
  glm: {
    'glm-5': 128000,
    'glm-4.7': 128000,
    'glm-4.6': 128000,
  },
  minimax: {
    'minimax-m2': 200000,
    'minimax-m2.7': 200000,
    'minimax-m2.5': 200000,
  },
  qwen: {
    'qwen3': 256000,
    'qwen3.5': 256000,
    'qwen3.5-plus': 256000,
    'qwen3.5-plus-2026-02-15': 256000,
    'qwen3-max-2026-01-23': 256000,
    'qwen3-coder-next': 128000,
  }
};

function normalizeModel(model: string): string {
  return model.trim().toLowerCase();
}

function matchesPrefix(model: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => model.startsWith(prefix));
}

export function supportsReasoning(provider: ProviderType, model: string): boolean {
  const normalizedModel = normalizeModel(model);
  if (!normalizedModel) return false;

  switch (provider) {
    case 'openai':
      return matchesPrefix(normalizedModel, OPENAI_REASONING_PREFIXES);
    case 'kimi':
      return matchesPrefix(normalizedModel, KIMI_REASONING_PREFIXES);
    case 'glm':
      return matchesPrefix(normalizedModel, GLM_REASONING_PREFIXES);
    case 'deepseek':
      return matchesPrefix(normalizedModel, DEEPSEEK_REASONING_PREFIXES);
    case 'minimax':
      return matchesPrefix(normalizedModel, MINIMAX_REASONING_PREFIXES);
    case 'qwen':
      return matchesPrefix(normalizedModel, QWEN_REASONING_PREFIXES);
    default:
      return false;
  }
}

export function resolveReasoningSupport(
  provider: ProviderType,
  model: string,
  metadata?: ProviderCatalogModel,
): boolean {
  if (metadata?.reasoning_support === 'supported') {
    return true;
  }
  if (metadata?.reasoning_support === 'unsupported') {
    return false;
  }

  return supportsReasoning(provider, model);
}

export function getImageSupportStatus(provider: ProviderType, model: string): ImageSupportStatus {
  void provider;
  return model.trim() ? 'unknown' : 'unsupported';
}

export function supportsImageInput(provider: ProviderType, model: string): boolean {
  return getImageSupportStatus(provider, model) === 'supported';
}

export function getSupportedInputTypes(provider: ProviderType, model: string): InputType[] {
  return supportsImageInput(provider, model) ? ['text', 'image'] : ['text'];
}

export function getDefaultReasoningEnabled(provider: ProviderType, model: string): boolean {
  return supportsReasoning(provider, model);
}

export function getDefaultContextLength(provider: ProviderType, model: string): number | undefined {
  const normalizedModel = normalizeModel(model);
  if (!normalizedModel) {
    return undefined;
  }

  const providerDefaults = DEFAULT_CONTEXT_LENGTH_PREFIXES[provider];
  if (!providerDefaults) {
    return undefined;
  }

  return Object.entries(providerDefaults).find(([prefix]) => normalizedModel.startsWith(prefix))?.[1];
}
