import { buildBackendAuthHeaders, getBackendAuthToken } from './backendAuth';

interface BackendFetchOptions {
  isTestMode?: boolean;
  retryOnUnauthorized?: boolean;
}

async function getRequiredBackendAuthToken(
  isTestMode: boolean,
  forceRefresh = false,
): Promise<string> {
  const authToken = await getBackendAuthToken({ isTestMode, forceRefresh });
  if (!authToken) {
    throw new Error('Backend auth handshake failed');
  }
  return authToken;
}

function mergeHeaders(headers: HeadersInit | undefined, authToken: string): Headers {
  const merged = new Headers(headers);
  Object.entries(buildBackendAuthHeaders(authToken)).forEach(([key, value]) => {
    merged.set(key, value);
  });
  return merged;
}

export async function fetchWithBackendAuth(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: BackendFetchOptions = {},
): Promise<Response> {
  const isTestMode = options.isTestMode ?? import.meta.env.MODE === 'test';
  const retryOnUnauthorized = options.retryOnUnauthorized ?? true;

  const runRequest = async (forceRefresh = false): Promise<Response> => {
    const authToken = await getRequiredBackendAuthToken(isTestMode, forceRefresh);
    return fetch(input, {
      ...init,
      headers: mergeHeaders(init.headers, authToken),
    });
  };

  const firstResponse = await runRequest();
  if (!retryOnUnauthorized || firstResponse.status !== 401 || isTestMode) {
    return firstResponse;
  }

  return runRequest(true);
}
