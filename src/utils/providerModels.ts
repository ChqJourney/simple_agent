import { buildBackendAuthHeaders, getBackendAuthToken } from './backendAuth';
import { backendProviderModelsUrl } from './backendEndpoint';
import { InputType, ProviderCatalogModel, ProviderType } from '../types';

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

function normalizeProviderCatalogModel(model: unknown): ProviderCatalogModel | null {
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

  return {
    id,
    context_length: normalizeContextLength(
      candidate.context_length
      ?? candidate.context_window
      ?? candidate.max_context_length
      ?? candidate.input_token_limit
    ),
    supports_image_in: supportsImageInput,
  };
}

export async function listProviderModels(
  provider: ProviderType,
  baseUrl: string,
  apiKey: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ProviderCatalogModel[]> {
  const authToken = await getBackendAuthToken({ isTestMode: import.meta.env.MODE === 'test' });
  if (!authToken) {
    throw new Error('Backend auth handshake failed');
  }

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
    const response = await fetch(backendProviderModelsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildBackendAuthHeaders(authToken),
      },
      body: JSON.stringify({
        provider,
        base_url: baseUrl,
        api_key: apiKey,
      }),
      signal: requestController.signal,
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
      .map((model) => normalizeProviderCatalogModel(model))
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
