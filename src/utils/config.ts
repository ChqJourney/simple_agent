import {
  AppearanceConfig,
  ContextProviderConfig,
  ExecutionRole,
  InputType,
  ModelProfile,
  ProviderCatalogModel,
  ProviderConfig,
  ProviderMemoryEntry,
  ProviderType,
  ReferenceLibraryConfig,
  ReferenceLibraryKind,
  RuntimeConfig,
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
};

export const DEFAULT_RUNTIME_POLICY: Required<RuntimePolicy> = {
  context_length: 64000,
  max_output_tokens: 4000,
  max_tool_rounds: 20,
  max_retries: 3,
  timeout_seconds: 120,
};

export const DEFAULT_RUNTIME_CONFIG: Required<Pick<RuntimeConfig, 'shared'>> = {
  shared: DEFAULT_RUNTIME_POLICY,
};

export const MIN_BASE_FONT_SIZE = 12;
export const MAX_BASE_FONT_SIZE = 20;

export const DEFAULT_APPEARANCE_CONFIG: Required<AppearanceConfig> = {
  base_font_size: 16,
};

const SUPPORTED_PROVIDERS: ProviderType[] = ['openai', 'deepseek', 'kimi', 'glm', 'minimax', 'qwen'];

export function isProviderType(value: unknown): value is ProviderType {
  return typeof value === 'string' && SUPPORTED_PROVIDERS.includes(value as ProviderType);
}

function normalizeProviderType(value: unknown, fallback: ProviderType = 'openai'): ProviderType {
  return isProviderType(value) ? value : fallback;
}

function getDefaultBaseUrl(provider: ProviderType): string {
  return DEFAULT_BASE_URLS[provider];
}

export function normalizeBaseUrl(provider: ProviderType, baseUrl?: string): string {
  const trimmed = baseUrl?.trim();
  return trimmed || getDefaultBaseUrl(provider);
}

export function normalizeContextProviders(contextProviders?: ContextProviderConfig): ContextProviderConfig {
  const normalizeDisabledList = (values?: string[]): string[] => Array.from(
    new Set(
      (values || [])
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));

  return {
    skills: {
      local: {
        enabled: contextProviders?.skills?.local?.enabled ?? true,
      },
      system: {
        disabled: normalizeDisabledList(contextProviders?.skills?.system?.disabled),
      },
    },
    tools: {
      disabled: normalizeDisabledList(contextProviders?.tools?.disabled),
    },
  };
}

export function normalizeSystemPrompt(systemPrompt?: string): string {
  return systemPrompt?.trim() || '';
}

const REFERENCE_LIBRARY_KINDS: ReferenceLibraryKind[] = ['standard', 'checklist', 'guidance'];

function normalizeReferenceLibraryKinds(kinds?: ReferenceLibraryKind[]): ReferenceLibraryKind[] | undefined {
  if (!Array.isArray(kinds)) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      kinds
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value): value is ReferenceLibraryKind => REFERENCE_LIBRARY_KINDS.includes(value as ReferenceLibraryKind))
    )
  );

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeReferenceLibraryConfig(
  referenceLibrary?: ReferenceLibraryConfig
): ReferenceLibraryConfig {
  const roots = Array.isArray(referenceLibrary?.roots) ? referenceLibrary?.roots : [];

  const normalizedRoots = roots
    .map((root) => {
      if (!root || typeof root !== 'object') {
        return null;
      }
      const rawPath = typeof root.path === 'string' ? root.path.trim() : '';
      if (!rawPath) {
        return null;
      }
      const rawId = typeof root.id === 'string' ? root.id.trim() : '';
      const rawLabel = typeof root.label === 'string' ? root.label.trim() : '';
      const label = rawLabel || rawPath.split(/[\\/]/).filter(Boolean).pop() || rawPath;
      const kinds = normalizeReferenceLibraryKinds(root.kinds);

      return {
        id: rawId || rawPath,
        label,
        path: rawPath,
        enabled: root.enabled !== false,
        ...(kinds ? { kinds } : {}),
      };
    })
    .filter((root): root is ReferenceLibraryConfig['roots'][number] => root !== null);

  return {
    roots: normalizedRoots,
  };
}

function normalizeProviderMemoryEntry(entry?: ProviderMemoryEntry): ProviderMemoryEntry {
  return {
    model: entry?.model?.trim() || '',
    api_key: entry?.api_key?.trim() || '',
    base_url: entry?.base_url?.trim() || '',
  };
}

function normalizeProviderCatalogEntry(entry: ProviderCatalogModel): ProviderCatalogModel | null {
  const id = entry?.id?.trim();
  if (!id) {
    return null;
  }

  return {
    id,
    context_length: typeof entry.context_length === 'number' && Number.isFinite(entry.context_length) && entry.context_length > 0
      ? Math.round(entry.context_length)
      : undefined,
    supports_image_in: typeof entry.supports_image_in === 'boolean' ? entry.supports_image_in : undefined,
  };
}

export function normalizeProviderCatalog(
  providerCatalog?: Partial<Record<ProviderType, ProviderCatalogModel[]>>
): Partial<Record<ProviderType, ProviderCatalogModel[]>> {
  if (!providerCatalog) {
    return {};
  }

  const normalized = {} as Partial<Record<ProviderType, ProviderCatalogModel[]>>;
  Object.keys(providerCatalog).forEach((provider) => {
    if (!isProviderType(provider)) {
      return;
    }

    const entries = Array.isArray(providerCatalog[provider])
      ? providerCatalog[provider]
        ?.map((entry) => normalizeProviderCatalogEntry(entry))
        .filter((entry): entry is ProviderCatalogModel => entry !== null)
      : [];

    if (entries.length > 0) {
      normalized[provider] = entries;
    }
  });

  return normalized;
}

export function normalizeProviderMemory(
  providerMemory?: Partial<Record<ProviderType, ProviderMemoryEntry>>
): Partial<Record<ProviderType, ProviderMemoryEntry>> {
  if (!providerMemory) {
    return {};
  }

  const normalized = {} as Partial<Record<ProviderType, ProviderMemoryEntry>>;
  Object.keys(providerMemory).forEach((provider) => {
    if (!isProviderType(provider)) {
      return;
    }
    normalized[provider] = normalizeProviderMemoryEntry(providerMemory[provider]);
  });
  return normalized;
}

function normalizeProfileConfig(profile: ModelProfile, profileName: string): ModelProfile {
  const provider = normalizeProviderType(profile.provider);
  const inputType = profile.input_type || 'text';
  const supportedInputTypes = getSupportedInputTypes(provider, profile.model);

  return {
    ...profile,
    provider,
    base_url: normalizeBaseUrl(provider, profile.base_url),
    enable_reasoning: Boolean(profile.enable_reasoning) && supportsReasoning(provider, profile.model),
    input_type: supportedInputTypes.includes(inputType) ? inputType : 'text',
    profile_name: profile.profile_name || profileName,
  };
}

export function hasConfiguredModelProfile(
  profile?: Partial<ModelProfile> | null
): profile is ModelProfile {
  return Boolean(
    profile
    && isProviderType(profile.provider)
    && typeof profile.model === 'string'
    && profile.model.trim()
  );
}

export function hasRunnableConversationProfile(config?: ProviderConfig | null): boolean {
  if (!config) {
    return false;
  }

  const primaryProfile = resolveProfileForRole(config, 'conversation');
  if (!hasConfiguredModelProfile(primaryProfile)) {
    return false;
  }

  return Boolean(primaryProfile.api_key?.trim());
}

export function resolveProfileForRole(
  config: ProviderConfig | null | undefined,
  role: ExecutionRole
): Partial<ModelProfile> | undefined {
  if (!config) {
    return undefined;
  }

  const primaryProfile = config.profiles?.primary || config;
  if (role === 'conversation') {
    return primaryProfile;
  }

  return config.profiles?.background || primaryProfile;
}

export function resolveCapabilitySummaryForRole(
  config: ProviderConfig | null | undefined,
  role: ExecutionRole
): { supportedInputTypes: InputType[]; reasoningSupported: boolean } {
  const profile = resolveProfileForRole(config, role);
  if (!hasConfiguredModelProfile(profile)) {
    return {
      supportedInputTypes: ['text'],
      reasoningSupported: false,
    };
  }

  const dynamicCatalogEntry = config?.provider_catalog?.[profile.provider]?.find((entry) => entry.id === profile.model);
  const supportedInputTypes: InputType[] = typeof dynamicCatalogEntry?.supports_image_in === 'boolean'
    ? (dynamicCatalogEntry.supports_image_in ? ['text', 'image'] : ['text'])
    : getSupportedInputTypes(profile.provider, profile.model);

  return {
    supportedInputTypes,
    reasoningSupported: supportsReasoning(profile.provider, profile.model),
  };
}

export function supportsImageAttachmentsForRole(
  config: ProviderConfig | null | undefined,
  role: ExecutionRole
): boolean {
  return resolveCapabilitySummaryForRole(config, role).supportedInputTypes.includes('image');
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
    timeout_seconds: normalizePositiveInt(runtime?.timeout_seconds, DEFAULT_RUNTIME_POLICY.timeout_seconds),
  };
}

function normalizeRuntimePolicyOverrides(runtime?: RuntimePolicy): RuntimePolicy | undefined {
  const normalized: RuntimePolicy = {};
  const contextLength = normalizePositiveInt(runtime?.context_length, 0);
  const maxOutputTokens = normalizePositiveInt(runtime?.max_output_tokens, 0);
  const maxToolRounds = normalizePositiveInt(runtime?.max_tool_rounds, 0);
  const maxRetries = normalizePositiveInt(runtime?.max_retries, 0);
  const timeoutSeconds = normalizePositiveInt(runtime?.timeout_seconds, 0);

  if (contextLength > 0) {
    normalized.context_length = contextLength;
  }
  if (maxOutputTokens > 0) {
    normalized.max_output_tokens = maxOutputTokens;
  }
  if (maxToolRounds > 0) {
    normalized.max_tool_rounds = maxToolRounds;
  }
  if (maxRetries > 0) {
    normalized.max_retries = maxRetries;
  }
  if (timeoutSeconds > 0) {
    normalized.timeout_seconds = timeoutSeconds;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeRuntimeConfig(runtime?: RuntimeConfig): RuntimeConfig & { shared: Required<RuntimePolicy> } {
  return {
    shared: normalizeRuntimePolicy(runtime?.shared),
    ...(normalizeRuntimePolicyOverrides(runtime?.conversation)
      ? { conversation: normalizeRuntimePolicyOverrides(runtime?.conversation) }
      : {}),
    ...(normalizeRuntimePolicyOverrides(runtime?.background)
      ? { background: normalizeRuntimePolicyOverrides(runtime?.background) }
      : {}),
    ...(normalizeRuntimePolicyOverrides(runtime?.compaction)
      ? { compaction: normalizeRuntimePolicyOverrides(runtime?.compaction) }
      : {}),
    ...(normalizeRuntimePolicyOverrides(runtime?.delegated_task)
      ? { delegated_task: normalizeRuntimePolicyOverrides(runtime?.delegated_task) }
      : {}),
  };
}

export function resolveRuntimePolicy(
  runtime: RuntimeConfig | undefined,
  role: ExecutionRole
): Required<RuntimePolicy> {
  const normalizedRuntime = normalizeRuntimeConfig(runtime);
  return {
    ...normalizedRuntime.shared,
    ...(normalizedRuntime[role] || {}),
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
  const backgroundProfile = config.profiles?.background
    ? normalizeProfileConfig(config.profiles.background, 'background')
    : undefined;

  return {
    ...primaryProfile,
    profiles: {
      primary: primaryProfile,
      ...(backgroundProfile ? { background: backgroundProfile } : {}),
    },
    system_prompt: normalizeSystemPrompt(config.system_prompt),
    provider_memory: normalizeProviderMemory(config.provider_memory),
    provider_catalog: normalizeProviderCatalog(config.provider_catalog),
    runtime: normalizeRuntimeConfig(config.runtime),
    appearance: normalizeAppearanceConfig(config.appearance),
    context_providers: normalizeContextProviders(config.context_providers),
    reference_library: normalizeReferenceLibraryConfig(config.reference_library),
  };
}
