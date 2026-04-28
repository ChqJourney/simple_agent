import { backendProviderModelsUrl } from './backendEndpoint';
import { InputType, ProviderCatalogModel, ProviderType } from '../types';
import { fetchWithBackendAuth } from './backendRequest';

interface ProviderModelsResponse {
  ok?: boolean;
  error?: string;
  models?: unknown[];
}

const PROVIDER_MODELS_TIMEOUT_MS = 10000;

function deriveSupportsImageInput(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

function normalizeImageSupport(value: unknown): ProviderCatalogModel['image_support'] | undefined {
  if (value === 'supported' || value === 'unsupported' || value === 'unknown') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 'supported' : 'unsupported';
  }
  return undefined;
}

function deriveSupportsImageInputFromList(value: unknown): boolean | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalizedTypes = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (normalizedTypes.length === 0) {
    return undefined;
  }

  return normalizedTypes.includes('image');
}

function normalizeInputTypes(value: unknown): InputType[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry): entry is InputType => entry === 'text' || entry === 'image')
  ));

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeContextLength(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

function normalizeReasoningSupport(value: unknown): ProviderCatalogModel['reasoning_support'] | undefined {
  if (value === 'supported' || value === 'unsupported' || value === 'unknown') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 'supported' : 'unsupported';
  }
  return undefined;
}

function normalizeReasoningToggle(value: unknown): ProviderCatalogModel['reasoning_toggle'] | undefined {
  if (value === 'can_toggle' || value === 'fixed_on' || value === 'fixed_off' || value === 'unknown') {
    return value;
  }
  return undefined;
}

function normalizeProviderCatalogModel(_provider: ProviderType, model: unknown): ProviderCatalogModel | null {
  if (typeof model === 'string') {
    const id = model.trim();
    return id ? { id } : null;
  }

  if (!model || typeof model !== 'object') {
    return null;
  }

  const candidate = model as Record<string, unknown>;
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  if (!id) {
    return null;
  }

  const inputTypes = normalizeInputTypes(
    candidate.input_types
      ?? candidate.input_modalities
      ?? candidate.modalities
      ?? candidate.supported_inputs
  );

  const supportsImageInput = deriveSupportsImageInput(candidate.supports_image_in)
    ?? deriveSupportsImageInputFromList(inputTypes)
    ?? deriveSupportsImageInputFromList(
      candidate.input_modalities
      ?? candidate.modalities
      ?? candidate.supported_inputs
    );
  const imageSupport = normalizeImageSupport(
    candidate.image_support
    ?? candidate.input_support
    ?? candidate.supports_image_in
  ) ?? (
    typeof supportsImageInput === 'boolean'
      ? (supportsImageInput ? 'supported' : 'unsupported')
      : undefined
  );
  const contextLength = normalizeContextLength(
    candidate.context_length
    ?? candidate.context_window
    ?? candidate.max_context_length
    ?? candidate.input_token_limit
  );
  const reasoningSupport = normalizeReasoningSupport(
    candidate.reasoning_support
    ?? candidate.reasoning_supported
    ?? candidate.supports_reasoning
    ?? candidate.supportsReasoning
    ?? (typeof candidate.capabilities === 'object' && candidate.capabilities !== null
      ? (candidate.capabilities as Record<string, unknown>).reasoning
      : undefined)
  );
  const reasoningToggle = normalizeReasoningToggle(
    candidate.reasoning_toggle
    ?? candidate.reasoning_mode
    ?? candidate.reasoning_control
    ?? (typeof candidate.capabilities === 'object' && candidate.capabilities !== null
      ? (candidate.capabilities as Record<string, unknown>).reasoning_toggle
      : undefined)
  );

  return {
    id,
    ...(typeof contextLength === 'number' ? { context_length: contextLength } : {}),
    ...(typeof supportsImageInput === 'boolean' ? { supports_image_in: supportsImageInput } : {}),
    ...(imageSupport ? { image_support: imageSupport } : {}),
    ...(reasoningSupport ? { reasoning_support: reasoningSupport } : {}),
    ...(reasoningToggle ? { reasoning_toggle: reasoningToggle } : {}),
  };
}

export async function listProviderModels(
  provider: ProviderType,
  baseUrl: string,
  apiKey: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ProviderCatalogModel[]> {
  const requestController = new AbortController();
  const timeoutMs = options.timeoutMs ?? PROVIDER_MODELS_TIMEOUT_MS;
  const timeoutId = timeoutMs > 0
    ? setTimeout(() => {
      requestController.abort(new DOMException('Timed out while loading provider models', 'AbortError'));
    }, timeoutMs)
    : null;
  const handleExternalAbort = () => {
    requestController.abort(options.signal?.reason);
  };

  if (options.signal) {
    if (options.signal.aborted) {
      handleExternalAbort();
    } else {
      options.signal.addEventListener('abort', handleExternalAbort, { once: true });
    }
  }

  try {
    const response = await fetchWithBackendAuth(backendProviderModelsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider,
        base_url: baseUrl,
        api_key: apiKey,
      }),
      signal: requestController.signal,
    }, {
      isTestMode: import.meta.env.MODE === 'test',
    });

    if (response.status === 404) {
      throw new Error('Backend endpoint /provider-models not found. Please update backend build.');
    }

    const payload = await response.json().catch(() => ({})) as ProviderModelsResponse;

    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `Failed to load provider models (HTTP ${response.status})`);
    }

    const models = Array.isArray(payload.models) ? payload.models : [];
    return models
      .map((model) => normalizeProviderCatalogModel(provider, model))
      .filter((model): model is ProviderCatalogModel => model !== null);
  } catch (error) {
    if (requestController.signal.aborted && !options.signal?.aborted) {
      throw new Error('Timed out while loading the live model catalog');
    }
    throw error;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    options.signal?.removeEventListener('abort', handleExternalAbort);
  }
}
