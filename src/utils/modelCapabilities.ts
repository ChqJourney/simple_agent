import type { InputType, ProviderType } from '../types';
export type ImageSupportStatus = 'supported' | 'unsupported';

const OPENAI_REASONING_PREFIXES = ['o1', 'o3', 'o4', 'gpt-5'];
const KIMI_REASONING_PREFIXES = ['kimi-k2.5', 'kimi-k2-thinking'];
const GLM_REASONING_PREFIXES = ['glm-5', 'glm-4.7', 'glm-4.6'];
const DEEPSEEK_REASONING_PREFIXES = ['deepseek-reasoner'];
const MINIMAX_REASONING_PREFIXES: string[] = [];
const QWEN_REASONING_PREFIXES = ['qwen3', 'qwq'];

const OPENAI_IMAGE_SUPPORTED_PREFIXES = ['gpt-4o', 'gpt-4.1', 'gpt-5'];
const OPENAI_IMAGE_UNSUPPORTED_PREFIXES = ['o1', 'o3', 'o4'];
const KIMI_IMAGE_SUPPORTED_PREFIXES = ['kimi-k2.5', 'kimi-k2-thinking'];
const KIMI_IMAGE_UNSUPPORTED_PREFIXES: string[] = [];
const GLM_IMAGE_SUPPORTED_PREFIXES = ['glm-4.6v'];
const GLM_IMAGE_UNSUPPORTED_PREFIXES = ['glm-5', 'glm-4.7', 'glm-4.6'];
const DEEPSEEK_IMAGE_UNSUPPORTED_PREFIXES = ['deepseek-chat', 'deepseek-reasoner'];
const MINIMAX_IMAGE_SUPPORTED_PREFIXES: string[] = [];
const MINIMAX_IMAGE_UNSUPPORTED_PREFIXES = ['minimax-m2'];
const QWEN_IMAGE_SUPPORTED_PREFIXES = ['qvq','qwen3.5','qwen3.5-plus', 'qwen3.5-plus-2026-02-15'];
const QWEN_IMAGE_UNSUPPORTED_PREFIXES = ['qwq','qwen3-max-2026-01-23', 'qwen3-coder-next'];
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

export function getImageSupportStatus(provider: ProviderType, model: string): ImageSupportStatus {
  const normalizedModel = normalizeModel(model);
  if (!normalizedModel) {
    return 'unsupported';
  }

  switch (provider) {
    case 'openai':
      if (matchesPrefix(normalizedModel, OPENAI_IMAGE_SUPPORTED_PREFIXES)) {
        return 'supported';
      }
      if (matchesPrefix(normalizedModel, OPENAI_IMAGE_UNSUPPORTED_PREFIXES)) {
        return 'unsupported';
      }
      return 'unsupported';
    case 'kimi':
      if (matchesPrefix(normalizedModel, KIMI_IMAGE_SUPPORTED_PREFIXES)) {
        return 'supported';
      }
      if (matchesPrefix(normalizedModel, KIMI_IMAGE_UNSUPPORTED_PREFIXES)) {
        return 'unsupported';
      }
      return 'unsupported';
    case 'glm':
      if (matchesPrefix(normalizedModel, GLM_IMAGE_SUPPORTED_PREFIXES)) {
        return 'supported';
      }
      if (matchesPrefix(normalizedModel, GLM_IMAGE_UNSUPPORTED_PREFIXES)) {
        return 'unsupported';
      }
      return 'unsupported';
    case 'deepseek':
      return matchesPrefix(normalizedModel, DEEPSEEK_IMAGE_UNSUPPORTED_PREFIXES)
        ? 'unsupported'
        : 'unsupported';
    case 'minimax':
      if (matchesPrefix(normalizedModel, MINIMAX_IMAGE_SUPPORTED_PREFIXES)) {
        return 'supported';
      }
      if (matchesPrefix(normalizedModel, MINIMAX_IMAGE_UNSUPPORTED_PREFIXES)) {
        return 'unsupported';
      }
      return 'unsupported';
    case 'qwen':
      if (matchesPrefix(normalizedModel, QWEN_IMAGE_SUPPORTED_PREFIXES)) {
        return 'supported';
      }
      if (matchesPrefix(normalizedModel, QWEN_IMAGE_UNSUPPORTED_PREFIXES)) {
        return 'unsupported';
      }
      return 'unsupported';
    default:
      return 'unsupported';
  }
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
