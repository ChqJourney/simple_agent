import { afterEach, describe, expect, it, vi } from "vitest";

describe("backendAuth", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("caches the fetched HTTP auth token between calls", async () => {
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ auth_token: "cached-token" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const backendAuth = await import("./backendAuth");

    await expect(backendAuth.getBackendAuthToken()).resolves.toBe("cached-token");
    await expect(backendAuth.getBackendAuthToken()).resolves.toBe("cached-token");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses the in-flight HTTP auth request for concurrent callers", async () => {
    vi.stubGlobal("window", {});
    let resolveFetch: ((value: unknown) => void) | undefined;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const backendAuth = await import("./backendAuth");

    const firstPromise = backendAuth.getBackendAuthToken();
    const secondPromise = backendAuth.getBackendAuthToken();

    resolveFetch?.({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ auth_token: "shared-token" }),
    });

    await expect(firstPromise).resolves.toBe("shared-token");
    await expect(secondPromise).resolves.toBe("shared-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the HTTP endpoint when the Tauri token lookup fails", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: vi.fn().mockRejectedValue(new Error("host unavailable")),
    }));
    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {
        invoke: vi.fn(),
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ auth_token: "http-token" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const backendAuth = await import("./backendAuth");

    await expect(backendAuth.getBackendAuthToken()).resolves.toBe("http-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a helpful error when the HTTP auth endpoint returns 404", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn(),
    }));

    const onError = vi.fn();
    const backendAuth = await import("./backendAuth");

    await expect(backendAuth.getBackendAuthToken({ onError })).resolves.toBeNull();

    expect(onError).toHaveBeenCalledWith(
      "Backend auth handshake failed.",
      expect.stringContaining("/auth-token"),
    );
  });

  it("reports a helpful error when the HTTP auth payload is invalid", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ auth_token: "" }),
    }));

    const onError = vi.fn();
    const backendAuth = await import("./backendAuth");

    await expect(backendAuth.getBackendAuthToken({ onError })).resolves.toBeNull();

    expect(onError).toHaveBeenCalledWith(
      "Backend auth handshake failed.",
      expect.stringContaining("invalid auth token payload"),
    );
  });
});
