import { ContextProviderConfig, ModelProfile, ProviderConfig, ProviderType } from '../types';
import { getSupportedInputTypes, supportsReasoning } from './modelCapabilities';

export const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
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

function normalizeExtensions(extensions?: string[]): string[] {
  if (!Array.isArray(extensions) || extensions.length === 0) {
    return ['.md', '.txt', '.json'];
  }

  const normalized = extensions
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean)
    .map((extension) => (extension.startsWith('.') ? extension : `.${extension}`));

  return normalized.length > 0 ? normalized : ['.md', '.txt', '.json'];
}

export function normalizeContextProviders(contextProviders?: ContextProviderConfig): ContextProviderConfig {
  return {
    skills: {
      local: {
        enabled: contextProviders?.skills?.local?.enabled ?? true,
      },
    },
    retrieval: {
      workspace: {
        enabled: contextProviders?.retrieval?.workspace?.enabled ?? true,
        max_hits: contextProviders?.retrieval?.workspace?.max_hits ?? 3,
        extensions: normalizeExtensions(contextProviders?.retrieval?.workspace?.extensions),
      },
    },
  };
}

function normalizeProfileConfig(profile: ModelProfile, profileName: string): ModelProfile {
  const inputType = profile.input_type || 'text';
  const supportedInputTypes = getSupportedInputTypes(profile.provider, profile.model);

  return {
    ...profile,
    base_url: normalizeBaseUrl(profile.provider, profile.base_url),
    enable_reasoning: Boolean(profile.enable_reasoning) && supportsReasoning(profile.provider, profile.model),
    input_type: supportedInputTypes.includes(inputType) ? inputType : 'text',
    profile_name: profile.profile_name || profileName,
  };
}

export function normalizeProviderConfig(config: ProviderConfig): ProviderConfig {
  const primaryProfile = normalizeProfileConfig(config.profiles?.primary || config, 'primary');
  const secondaryProfile = config.profiles?.secondary
    ? normalizeProfileConfig(config.profiles.secondary, 'secondary')
    : undefined;

  return {
    ...config,
    ...primaryProfile,
    profiles: {
      primary: primaryProfile,
      ...(secondaryProfile ? { secondary: secondaryProfile } : {}),
    },
    runtime: config.runtime ? { ...config.runtime } : undefined,
    context_providers: normalizeContextProviders(config.context_providers),
  };
}
