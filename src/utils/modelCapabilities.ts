import { ProviderType } from '../types';

export type InputType = 'text' | 'image';

const OPENAI_REASONING_PREFIXES = ['o1', 'o3', 'o4', 'gpt-5'];
const DEEPSEEK_REASONING_PREFIXES = ['deepseek-reasoner'];
const QWEN_REASONING_PREFIXES = ['qwen3', 'qwq'];
const OLLAMA_REASONING_PREFIXES = ['qwen3', 'deepseek-r1', 'magistral', 'phi4-reasoning'];

const OPENAI_VISION_PREFIXES = ['gpt-4o', 'gpt-4.1', 'gpt-5'];
const QWEN_VISION_PREFIXES = ['qvq'];
const OLLAMA_VISION_PREFIXES: string[] = [];

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
    case 'deepseek':
      return matchesPrefix(normalizedModel, DEEPSEEK_REASONING_PREFIXES);
    case 'qwen':
      return matchesPrefix(normalizedModel, QWEN_REASONING_PREFIXES);
    case 'ollama':
      return matchesPrefix(normalizedModel, OLLAMA_REASONING_PREFIXES);
    default:
      return false;
  }
}

export function getSupportedInputTypes(provider: ProviderType, model: string): InputType[] {
  const normalizedModel = normalizeModel(model);
  if (!normalizedModel) {
    return ['text'];
  }

  switch (provider) {
    case 'openai':
      return matchesPrefix(normalizedModel, OPENAI_VISION_PREFIXES) ? ['text', 'image'] : ['text'];
    case 'deepseek':
      return ['text'];
    case 'qwen':
      return matchesPrefix(normalizedModel, QWEN_VISION_PREFIXES) ? ['text', 'image'] : ['text'];
    case 'ollama':
      return matchesPrefix(normalizedModel, OLLAMA_VISION_PREFIXES) ? ['text', 'image'] : ['text'];
    default:
      return ['text'];
  }
}

export function getDefaultReasoningEnabled(provider: ProviderType, model: string): boolean {
  return supportsReasoning(provider, model);
}
