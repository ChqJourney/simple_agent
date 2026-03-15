import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("tauri.conf bundle configuration", () => {
  it("declares the Windows backend sidecar in externalBin", () => {
    const configPath = join(process.cwd(), "src-tauri", "tauri.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
      bundle?: { externalBin?: string[] };
    };

    expect(config.bundle?.externalBin).toContain("binaries/python_backend");
  });

  it("declares embedded runtimes as packaged resources", () => {
    const configPath = join(process.cwd(), "src-tauri", "tauri.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
      bundle?: { resources?: string[] | Record<string, string> };
    };

    expect(config.bundle?.resources).toEqual(
      expect.arrayContaining(["resources/runtimes/python", "resources/runtimes/node"]),
    );
  });

  it("keeps the bundle target set to msi", () => {
    const configPath = join(process.cwd(), "src-tauri", "tauri.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
      bundle?: { targets?: string | string[] };
    };

    expect(config.bundle?.targets).toBe("msi");
  });
});
