import { buildBackendAuthHeaders, getBackendAuthToken } from './backendAuth';
import { backendProviderModelsUrl } from './backendEndpoint';
import { ProviderType } from '../types';

interface ProviderModelsResponse {
  ok?: boolean;
  error?: string;
  models?: unknown[];
}

export async function listProviderModels(
  provider: ProviderType,
  baseUrl: string,
  options: { signal?: AbortSignal } = {},
): Promise<string[]> {
  const authToken = await getBackendAuthToken({ isTestMode: import.meta.env.MODE === 'test' });
  if (!authToken) {
    throw new Error('Backend auth handshake failed');
  }

  const response = await fetch(backendProviderModelsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildBackendAuthHeaders(authToken),
    },
    body: JSON.stringify({
      provider,
      base_url: baseUrl,
    }),
    signal: options.signal,
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
    .filter((model): model is string => typeof model === 'string' && model.trim().length > 0)
    .map((model) => model.trim());
}
