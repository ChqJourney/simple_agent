import { afterEach, describe, expect, it, vi } from "vitest";

const getBackendAuthTokenMock = vi.hoisted(() => vi.fn());
const buildBackendAuthHeadersMock = vi.hoisted(() => vi.fn((token: string) => ({
  "X-Tauri-Agent-Auth": token,
})));

vi.mock("./backendAuth", () => ({
  buildBackendAuthHeaders: buildBackendAuthHeadersMock,
  getBackendAuthToken: getBackendAuthTokenMock,
}));

describe("fetchWithBackendAuth", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("retries once with a refreshed token after a 401 response", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce({ status: 200 }));
    getBackendAuthTokenMock
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("fresh-token");

    const { fetchWithBackendAuth } = await import("./backendRequest");
    const response = await fetchWithBackendAuth("http://127.0.0.1:8765/tools", {}, {
      isTestMode: false,
    });

    expect(response.status).toBe(200);
    expect(getBackendAuthTokenMock).toHaveBeenNthCalledWith(1, {
      forceRefresh: false,
      isTestMode: false,
    });
    expect(getBackendAuthTokenMock).toHaveBeenNthCalledWith(2, {
      forceRefresh: true,
      isTestMode: false,
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetchMock.mock.calls[0] ?? [];
    const [, secondInit] = fetchMock.mock.calls[1] ?? [];
    expect((firstInit?.headers as Headers).get("X-Tauri-Agent-Auth")).toBe("stale-token");
    expect((secondInit?.headers as Headers).get("X-Tauri-Agent-Auth")).toBe("fresh-token");
  });
});
