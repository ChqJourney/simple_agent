import { afterEach, describe, expect, it, vi } from "vitest";

describe("backend endpoints", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("pins the desktop app to the local sidecar backend", async () => {
    vi.stubEnv("VITE_BACKEND_HTTP_BASE", "http://192.168.1.8:9999");
    vi.stubEnv("VITE_BACKEND_WS_BASE", "ws://192.168.1.8:9999");
    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {
        invoke: vi.fn(),
      },
    });

    const backendEndpoint = await import("./backendEndpoint");

    expect(backendEndpoint.backendHttpBase).toBe("http://127.0.0.1:8765");
    expect(backendEndpoint.backendWsUrl).toBe("ws://127.0.0.1:8765/ws");
    expect(backendEndpoint.backendAuthTokenUrl).toBe("http://127.0.0.1:8765/auth-token");
  });

  it("still allows non-desktop environments to override backend endpoints", async () => {
    vi.stubEnv("VITE_BACKEND_HTTP_BASE", "http://192.168.1.8:9999/");
    vi.stubGlobal("window", {});

    const backendEndpoint = await import("./backendEndpoint");

    expect(backendEndpoint.backendHttpBase).toBe("http://192.168.1.8:9999");
    expect(backendEndpoint.backendWsUrl).toBe("ws://192.168.1.8:9999/ws");
  });
});
