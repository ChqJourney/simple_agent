import { ProviderType } from '../types';

export type InputType = 'text' | 'image';
export type ImageSupportStatus = 'supported' | 'unsupported' | 'unknown';

const OPENAI_REASONING_PREFIXES = ['o1', 'o3', 'o4', 'gpt-5'];
const KIMI_REASONING_PREFIXES = ['kimi-k2.5'];
const GLM_REASONING_PREFIXES = ['glm-5', 'glm-4.7', 'glm-4.6'];
const DEEPSEEK_REASONING_PREFIXES = ['deepseek-reasoner'];
const MINIMAX_REASONING_PREFIXES: string[] = [];
const QWEN_REASONING_PREFIXES = ['qwen3', 'qwq'];
const OLLAMA_REASONING_PREFIXES = ['qwen3', 'deepseek-r1', 'magistral', 'phi4-reasoning'];

const OPENAI_IMAGE_SUPPORTED_PREFIXES = ['gpt-4o', 'gpt-4.1', 'gpt-5'];
const OPENAI_IMAGE_UNSUPPORTED_PREFIXES = ['o1', 'o3', 'o4'];
const KIMI_IMAGE_SUPPORTED_PREFIXES = ['kimi-k2.5'];
const KIMI_IMAGE_UNSUPPORTED_PREFIXES: string[] = [];
const GLM_IMAGE_SUPPORTED_PREFIXES = ['glm-4.6v'];
const GLM_IMAGE_UNSUPPORTED_PREFIXES = ['glm-5', 'glm-4.7', 'glm-4.6'];
const DEEPSEEK_IMAGE_UNSUPPORTED_PREFIXES = ['deepseek-chat', 'deepseek-reasoner'];
const MINIMAX_IMAGE_SUPPORTED_PREFIXES: string[] = [];
const MINIMAX_IMAGE_UNSUPPORTED_PREFIXES = ['minimax-m2'];
const QWEN_IMAGE_SUPPORTED_PREFIXES = ['qvq'];
const QWEN_IMAGE_UNSUPPORTED_PREFIXES = ['qwen3', 'qwq'];
const OLLAMA_IMAGE_SUPPORTED_PREFIXES: string[] = [];
const OLLAMA_IMAGE_UNSUPPORTED_PREFIXES: string[] = [];

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
    case 'ollama':
      return matchesPrefix(normalizedModel, OLLAMA_REASONING_PREFIXES);
    default:
      return false;
  }
}

export function getImageSupportStatus(provider: ProviderType, model: string): ImageSupportStatus {
  const normalizedModel = normalizeModel(model);
  if (!normalizedModel) {
    return 'unknown';
  }

  switch (provider) {
    case 'openai':
      if (matchesPrefix(normalizedModel, OPENAI_IMAGE_SUPPORTED_PREFIXES)) {
        return 'supported';
      }
      if (matchesPrefix(normalizedModel, OPENAI_IMAGE_UNSUPPORTED_PREFIXES)) {
        return 'unsupported';
      }
      return 'unknown';
    case 'kimi':
      if (matchesPrefix(normalizedModel, KIMI_IMAGE_SUPPORTED_PREFIXES)) {
        return 'supported';
      }
      if (matchesPrefix(normalizedModel, KIMI_IMAGE_UNSUPPORTED_PREFIXES)) {
        return 'unsupported';
      }
      return 'unknown';
    case 'glm':
      if (matchesPrefix(normalizedModel, GLM_IMAGE_SUPPORTED_PREFIXES)) {
        return 'supported';
      }
      if (matchesPrefix(normalizedModel, GLM_IMAGE_UNSUPPORTED_PREFIXES)) {
        return 'unsupported';
      }
      return 'unknown';
    case 'deepseek':
      return matchesPrefix(normalizedModel, DEEPSEEK_IMAGE_UNSUPPORTED_PREFIXES)
        ? 'unsupported'
        : 'unknown';
    case 'minimax':
      if (matchesPrefix(normalizedModel, MINIMAX_IMAGE_SUPPORTED_PREFIXES)) {
        return 'supported';
      }
      if (matchesPrefix(normalizedModel, MINIMAX_IMAGE_UNSUPPORTED_PREFIXES)) {
        return 'unsupported';
      }
      return 'unknown';
    case 'qwen':
      if (matchesPrefix(normalizedModel, QWEN_IMAGE_SUPPORTED_PREFIXES)) {
        return 'supported';
      }
      if (matchesPrefix(normalizedModel, QWEN_IMAGE_UNSUPPORTED_PREFIXES)) {
        return 'unsupported';
      }
      return 'unknown';
    case 'ollama':
      if (matchesPrefix(normalizedModel, OLLAMA_IMAGE_SUPPORTED_PREFIXES)) {
        return 'supported';
      }
      if (matchesPrefix(normalizedModel, OLLAMA_IMAGE_UNSUPPORTED_PREFIXES)) {
        return 'unsupported';
      }
      return 'unknown';
    default:
      return 'unknown';
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
