import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./backendAuth", () => ({
  buildBackendAuthHeaders: vi.fn(() => ({ "X-Tauri-Agent-Auth": "test-auth-token" })),
  getBackendAuthToken: vi.fn(async () => "test-auth-token"),
}));

vi.mock("./backendEndpoint", () => ({
  backendProviderModelsUrl: "http://127.0.0.1:8765/provider-models",
}));

describe("listProviderModels", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns normalized model metadata from the backend payload", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        ok: true,
        models: [
          { id: " gpt-4.1-mini ", context_length: 128000, supports_image_in: true },
          "",
          { id: "gpt-4.1", input_modalities: ["text"] },
          42,
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { listProviderModels } = await import("./providerModels");
    const models = await listProviderModels("openai", "https://api.openai.com/v1", "key");

    expect(models).toEqual([
      { id: "gpt-4.1-mini", context_length: 128000, supports_image_in: true },
      { id: "gpt-4.1", supports_image_in: false },
    ]);
  });

  it("times out hanging requests so the UI can fall back cleanly", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { listProviderModels } = await import("./providerModels");
    const promise = listProviderModels(
      "openai",
      "https://api.openai.com/v1",
      "key",
      { timeoutMs: 50 },
    );
    const expectation = expect(promise).rejects.toThrow("Timed out while loading the live model catalog");

    await vi.advanceTimersByTimeAsync(50);

    await expectation;
  });
});
