import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("default Tauri capability", () => {
  it("allows creating the app data directory itself for persisted config storage", () => {
    const capabilityPath = join(process.cwd(), "src-tauri", "capabilities", "default.json");
    const capability = JSON.parse(readFileSync(capabilityPath, "utf-8")) as {
      permissions?: Array<string | { identifier: string; allow?: Array<{ path: string }> }>;
    };

    const fsDefaultPermission = capability.permissions?.find((permission) => {
      return typeof permission !== "string" && permission.identifier === "fs:default";
    });

    expect(fsDefaultPermission).toEqual({
      identifier: "fs:default",
      allow: [{ path: "$APPDATA" }, { path: "$APPDATA/**" }],
    });
  });

  it("allows writing persisted config files under app data", () => {
    const capabilityPath = join(process.cwd(), "src-tauri", "capabilities", "default.json");
    const capability = JSON.parse(readFileSync(capabilityPath, "utf-8")) as {
      permissions?: Array<string | { identifier: string; allow?: Array<{ path: string }> }>;
    };

    const writePermission = capability.permissions?.find((permission) => {
      return typeof permission !== "string" && permission.identifier === "fs:allow-write-text-file";
    });

    expect(writePermission).toEqual({
      identifier: "fs:allow-write-text-file",
      allow: [{ path: "$APPDATA/**" }],
    });
  });
});
