import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("tauri.conf bundle configuration", () => {
  it("keeps the base config free of Windows-only sidecar packaging", () => {
    const configPath = join(process.cwd(), "src-tauri", "tauri.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
      bundle?: { externalBin?: string[] };
    };

    expect(config.bundle?.externalBin).toBeUndefined();
  });

  it("declares the Windows backend sidecar in the Windows override config", () => {
    const configPath = join(process.cwd(), "src-tauri", "tauri.windows.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
      bundle?: { externalBin?: string[] };
    };

    expect(config.bundle?.externalBin).toContain("binaries/core");
  });

  it("declares embedded runtimes as packaged resources in the Windows override config", () => {
    const configPath = join(process.cwd(), "src-tauri", "tauri.windows.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
      bundle?: { resources?: string[] | Record<string, string> };
    };

    expect(config.bundle?.resources).toEqual(
      expect.arrayContaining(["resources/runtimes/python", "resources/runtimes/node"]),
    );
  });

  it("keeps the Windows bundle target set to msi", () => {
    const configPath = join(process.cwd(), "src-tauri", "tauri.windows.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
      bundle?: { targets?: string | string[] };
    };

    expect(config.bundle?.targets).toBe("msi");
  });

  it("allows the Vite HMR websocket in the dev CSP only", () => {
    const configPath = join(process.cwd(), "src-tauri", "tauri.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
      app?: {
        security?: {
          csp?: string | null;
          devCsp?: string | null;
        };
      };
    };

    expect(config.app?.security?.csp).toContain("http://127.0.0.1:8765");
    expect(config.app?.security?.csp).toContain("ws://127.0.0.1:8765");
    expect(config.app?.security?.csp).not.toContain("http://localhost:8765");
    expect(config.app?.security?.csp).not.toContain("ws://localhost:8765");
    expect(config.app?.security?.csp).not.toContain("ws://localhost:1421");
    expect(config.app?.security?.devCsp).toContain("ws://localhost:1421");
    expect(config.app?.security?.devCsp).toContain("ws://127.0.0.1:1421");
  });
});
