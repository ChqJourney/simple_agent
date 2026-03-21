import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("default Tauri capability", () => {
  const expectedReadScope = [
    { path: "$HOME" },
    { path: "$HOME/**" },
    { path: "$APPDATA" },
    { path: "$APPDATA/**" },
  ];

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
      allow: [
        { path: "$HOME" },
        { path: "$HOME/**" },
        { path: "$APPDATA" },
        { path: "$APPDATA/**" },
      ],
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

  it("scopes workspace read operations to home and app data paths", () => {
    const capabilityPath = join(process.cwd(), "src-tauri", "capabilities", "default.json");
    const capability = JSON.parse(readFileSync(capabilityPath, "utf-8")) as {
      permissions?: Array<string | { identifier: string; allow?: Array<{ path: string }> }>;
    };

    const readPermissionIdentifiers = [
      "fs:allow-read-dir",
      "fs:allow-read-text-file",
      "fs:allow-exists",
      "fs:allow-stat",
      "fs:allow-remove",
    ];

    readPermissionIdentifiers.forEach((identifier) => {
      const permission = capability.permissions?.find((entry) => {
        return typeof entry !== "string" && entry.identifier === identifier;
      });

      expect(permission).toEqual({
        identifier,
        allow: expectedReadScope,
      });
    });
  });
});
