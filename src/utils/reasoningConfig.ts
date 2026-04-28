import type {
  ProviderCatalogModel,
  ReasoningMode,
  ReasoningSupportStatus,
  ReasoningToggleStatus,
} from '../types';

const REASONING_MODE_VALUES: ReasoningMode[] = ['default', 'on', 'off'];

export function isReasoningMode(value: unknown): value is ReasoningMode {
  return typeof value === 'string' && REASONING_MODE_VALUES.includes(value as ReasoningMode);
}

export function normalizeReasoningMode(value: unknown, fallback: ReasoningMode = 'default'): ReasoningMode {
  return isReasoningMode(value) ? value : fallback;
}

export function resolveReasoningMode(
  profile: { reasoning_mode?: unknown; enable_reasoning?: unknown } | null | undefined
): ReasoningMode {
  if (isReasoningMode(profile?.reasoning_mode)) {
    return profile.reasoning_mode;
  }

  return profile?.enable_reasoning === true ? 'on' : 'default';
}

export function toLegacyEnableReasoning(mode: ReasoningMode): boolean {
  return mode === 'on';
}

export function resolveReasoningSupportStatus(metadata?: ProviderCatalogModel): ReasoningSupportStatus {
  if (metadata?.reasoning_support) {
    return metadata.reasoning_support;
  }
  if (metadata?.reasoning_toggle === 'can_toggle' || metadata?.reasoning_toggle === 'fixed_on') {
    return 'supported';
  }
  if (metadata?.reasoning_toggle === 'fixed_off') {
    return 'unsupported';
  }
  return 'unknown';
}

export function resolveReasoningToggleStatus(metadata?: ProviderCatalogModel): ReasoningToggleStatus {
  return metadata?.reasoning_toggle ?? 'unknown';
}

export function coerceReasoningModeForModel(
  mode: ReasoningMode,
  metadata?: ProviderCatalogModel
): ReasoningMode {
  const toggle = resolveReasoningToggleStatus(metadata);
  if (toggle === 'fixed_on') {
    return 'on';
  }
  if (toggle === 'fixed_off') {
    return 'off';
  }
  if (resolveReasoningSupportStatus(metadata) === 'unsupported') {
    return 'off';
  }
  return mode;
}

export function canChangeReasoningMode(metadata?: ProviderCatalogModel): boolean {
  const toggle = resolveReasoningToggleStatus(metadata);
  if (toggle === 'fixed_on' || toggle === 'fixed_off') {
    return false;
  }
  return resolveReasoningSupportStatus(metadata) !== 'unsupported';
}
