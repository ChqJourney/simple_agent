import {
  AppearanceConfig,
  ContextProviderConfig,
  ModelProfile,
  ProviderConfig,
  ProviderMemoryEntry,
  ProviderType,
  RuntimePolicy,
} from '../types';
import { getSupportedInputTypes, supportsReasoning } from './modelCapabilities';

export const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  kimi: 'https://api.moonshot.cn/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  minimax: 'https://api.minimaxi.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ollama: 'http://127.0.0.1:11434',
};

export const DEFAULT_RUNTIME_POLICY: Required<RuntimePolicy> = {
  context_length: 64000,
  max_output_tokens: 4000,
  max_tool_rounds: 20,
  max_retries: 3,
};

export const MIN_BASE_FONT_SIZE = 12;
export const MAX_BASE_FONT_SIZE = 20;

export const DEFAULT_APPEARANCE_CONFIG: Required<AppearanceConfig> = {
  base_font_size: 16,
};

export function getDefaultBaseUrl(provider: ProviderType): string {
  return DEFAULT_BASE_URLS[provider];
}

export function normalizeBaseUrl(provider: ProviderType, baseUrl?: string): string {
  const trimmed = baseUrl?.trim();
  return trimmed || getDefaultBaseUrl(provider);
}

export function normalizeContextProviders(contextProviders?: ContextProviderConfig): ContextProviderConfig {
  return {
    skills: {
      local: {
        enabled: contextProviders?.skills?.local?.enabled ?? true,
      },
    },
  };
}

export function normalizeSystemPrompt(systemPrompt?: string): string {
  return systemPrompt?.trim() || '';
}

function normalizeProviderMemoryEntry(entry?: ProviderMemoryEntry): ProviderMemoryEntry {
  return {
    model: entry?.model?.trim() || '',
    api_key: entry?.api_key?.trim() || '',
    base_url: entry?.base_url?.trim() || '',
  };
}

export function normalizeProviderMemory(
  providerMemory?: Partial<Record<ProviderType, ProviderMemoryEntry>>
): Partial<Record<ProviderType, ProviderMemoryEntry>> {
  if (!providerMemory) {
    return {};
  }

  const normalized = {} as Partial<Record<ProviderType, ProviderMemoryEntry>>;
  (Object.keys(providerMemory) as ProviderType[]).forEach((provider) => {
    normalized[provider] = normalizeProviderMemoryEntry(providerMemory[provider]);
  });
  return normalized;
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

export function hasConfiguredModelProfile(
  profile?: Partial<ModelProfile> | null
): profile is ModelProfile {
  return Boolean(
    profile
    && typeof profile.provider === 'string'
    && profile.provider.trim()
    && typeof profile.model === 'string'
    && profile.model.trim()
  );
}

export function hasRunnableConversationProfile(config?: ProviderConfig | null): boolean {
  if (!config) {
    return false;
  }

  const primaryProfile = config.profiles?.primary || config;
  if (!hasConfiguredModelProfile(primaryProfile)) {
    return false;
  }

  return primaryProfile.provider === 'ollama' || Boolean(primaryProfile.api_key?.trim());
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.round(parsed);
}

export function normalizeRuntimePolicy(runtime?: RuntimePolicy): Required<RuntimePolicy> {
  return {
    context_length: normalizePositiveInt(runtime?.context_length, DEFAULT_RUNTIME_POLICY.context_length),
    max_output_tokens: normalizePositiveInt(runtime?.max_output_tokens, DEFAULT_RUNTIME_POLICY.max_output_tokens),
    max_tool_rounds: normalizePositiveInt(runtime?.max_tool_rounds, DEFAULT_RUNTIME_POLICY.max_tool_rounds),
    max_retries: normalizePositiveInt(runtime?.max_retries, DEFAULT_RUNTIME_POLICY.max_retries),
  };
}

export function normalizeBaseFontSize(value?: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_APPEARANCE_CONFIG.base_font_size;
  }

  return Math.min(MAX_BASE_FONT_SIZE, Math.max(MIN_BASE_FONT_SIZE, Math.round(parsed)));
}

export function normalizeAppearanceConfig(appearance?: AppearanceConfig): Required<AppearanceConfig> {
  return {
    base_font_size: normalizeBaseFontSize(appearance?.base_font_size),
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
    system_prompt: normalizeSystemPrompt(config.system_prompt),
    provider_memory: normalizeProviderMemory(config.provider_memory),
    runtime: normalizeRuntimePolicy(config.runtime),
    appearance: normalizeAppearanceConfig(config.appearance),
    context_providers: normalizeContextProviders(config.context_providers),
  };
}
