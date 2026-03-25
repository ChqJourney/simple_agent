import { backendAuthTokenUrl } from './backendEndpoint';

export const BACKEND_AUTH_HEADER = 'X-Tauri-Agent-Auth';

interface BackendAuthOptions {
  isTestMode?: boolean;
  onError?: (error: string, details?: string) => void;
}

let cachedAuthToken: string | null = null;
let inFlightAuthToken: Promise<string | null> | null = null;

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const tauriWindow = window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } };
  return typeof tauriWindow.__TAURI_INTERNALS__?.invoke === 'function';
}

async function fetchAuthTokenFromTauri(): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  const token = await invoke<string>('get_backend_auth_token');
  if (typeof token !== 'string' || !token) {
    throw new Error('Invalid token returned from Tauri host');
  }
  return token;
}

async function fetchAuthTokenFromHttp(onError?: BackendAuthOptions['onError']): Promise<string | null> {
  try {
    const response = await fetch(backendAuthTokenUrl);
    if (response.status === 404) {
      onError?.(
        'Backend auth handshake failed.',
        `GET ${backendAuthTokenUrl} returned 404. Check the backend base URL and ensure the server exposes /auth-token.`
      );
      return null;
    }
    if (!response.ok) {
      onError?.(
        'Backend auth handshake failed.',
        `GET ${backendAuthTokenUrl} returned HTTP ${response.status}.`
      );
      return null;
    }

    const payload = await response.json().catch(() => ({}));
    if (typeof payload.auth_token !== 'string' || !payload.auth_token) {
      onError?.(
        'Backend auth handshake failed.',
        `GET ${backendAuthTokenUrl} returned an invalid auth token payload.`
      );
      return null;
    }

    return payload.auth_token;
  } catch {
    onError?.(
      'Backend auth handshake failed.',
      `Unable to reach ${backendAuthTokenUrl}.`
    );
    return null;
  }
}

export async function getBackendAuthToken(options: BackendAuthOptions = {}): Promise<string | null> {
  if (options.isTestMode) {
    return 'test-auth-token';
  }

  if (cachedAuthToken !== null) {
    return cachedAuthToken;
  }

  if (inFlightAuthToken) {
    return inFlightAuthToken;
  }

  inFlightAuthToken = (async () => {
    if (isTauriRuntime()) {
      try {
        const tauriToken = await fetchAuthTokenFromTauri();
        cachedAuthToken = tauriToken;
        return tauriToken;
      } catch {
        // Older desktop builds and browser-only development still rely on the HTTP fallback.
      }
    }

    const httpToken = await fetchAuthTokenFromHttp(options.onError);
    if (httpToken) {
      cachedAuthToken = httpToken;
    }
    return httpToken;
  })();

  try {
    return await inFlightAuthToken;
  } finally {
    inFlightAuthToken = null;
  }
}

export function buildBackendAuthHeaders(authToken: string): Record<string, string> {
  return {
    [BACKEND_AUTH_HEADER]: authToken,
  };
}

export function resetBackendAuthTokenCache(): void {
  cachedAuthToken = null;
  inFlightAuthToken = null;
}
