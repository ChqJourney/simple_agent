// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import viteConfig from "./vite.config";

async function resolveServerConfig() {
  const config =
    typeof viteConfig === "function"
      ? await viteConfig({ command: "serve", mode: "development" })
      : viteConfig;

  return config.server;
}

describe("vite dev server config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.TAURI_DEV_HOST;
  });

  it("keeps desktop HMR enabled when TAURI_DEV_HOST is not set", async () => {
    const server = await resolveServerConfig();

    expect(server?.host).toBe(false);
    expect(server?.hmr).toBeUndefined();
  });

  it("pins HMR to the tauri dev host when TAURI_DEV_HOST is set", async () => {
    vi.stubEnv("TAURI_DEV_HOST", "192.168.1.20");

    const server = await resolveServerConfig();

    expect(server?.host).toBe("192.168.1.20");
    expect(server?.hmr).toEqual({
      protocol: "ws",
      host: "192.168.1.20",
      port: 1421,
    });
  });
});
