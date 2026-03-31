const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = "8765";
const LOCAL_HTTP_BASE = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
const LOCAL_WS_BASE = `ws://${DEFAULT_HOST}:${DEFAULT_PORT}`;

function hasTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const tauriWindow = window as Window & {
    __TAURI_INTERNALS__?: {
      invoke?: unknown;
    };
  };

  return typeof tauriWindow.__TAURI_INTERNALS__?.invoke === "function";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function deriveWsBase(httpBase: string): string {
  if (httpBase.startsWith("https://")) {
    return `wss://${httpBase.slice("https://".length)}`;
  }
  if (httpBase.startsWith("http://")) {
    return `ws://${httpBase.slice("http://".length)}`;
  }
  return `ws://${httpBase}`;
}

const configuredHttpBase = trimTrailingSlash(
  hasTauriRuntime()
    ? LOCAL_HTTP_BASE
    : import.meta.env.VITE_BACKEND_HTTP_BASE || LOCAL_HTTP_BASE
);
const configuredWsBase = trimTrailingSlash(
  hasTauriRuntime()
    ? LOCAL_WS_BASE
    : import.meta.env.VITE_BACKEND_WS_BASE || deriveWsBase(configuredHttpBase)
);

export const backendHttpBase = configuredHttpBase;
export const backendWsUrl = `${configuredWsBase}/ws`;
export const backendAuthTokenUrl = `${configuredHttpBase}/auth-token`;
export const backendHealthUrl = `${configuredHttpBase}/health`;
export const backendToolsUrl = `${configuredHttpBase}/tools`;
export const backendTestConfigUrl = `${configuredHttpBase}/test-config`;
