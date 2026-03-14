import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfigStateStorage } from "../utils/configStorage";

const appDataDirMock = vi.hoisted(() => vi.fn());
const joinMock = vi.hoisted(() => vi.fn());
const existsMock = vi.hoisted(() => vi.fn());
const mkdirMock = vi.hoisted(() => vi.fn());
const readTextFileMock = vi.hoisted(() => vi.fn());
const writeTextFileMock = vi.hoisted(() => vi.fn());
const removeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: appDataDirMock,
  join: joinMock,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: existsMock,
  mkdir: mkdirMock,
  readTextFile: readTextFileMock,
  writeTextFile: writeTextFileMock,
  remove: removeMock,
}));

describe("configStore persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        invoke: vi.fn(),
      },
    });
    appDataDirMock.mockReset();
    joinMock.mockReset();
    existsMock.mockReset();
    mkdirMock.mockReset();
    readTextFileMock.mockReset();
    writeTextFileMock.mockReset();
    removeMock.mockReset();

    appDataDirMock.mockResolvedValue("C:/Users/patri/AppData/Roaming/photonee");
    joinMock.mockImplementation(async (...parts: string[]) => parts.join("/"));
    existsMock.mockResolvedValue(false);
    mkdirMock.mockResolvedValue(undefined);
    readTextFileMock.mockResolvedValue(null);
    writeTextFileMock.mockResolvedValue(undefined);
    removeMock.mockResolvedValue(undefined);
  });

  it("writes persisted config to the tauri app data directory instead of localStorage", async () => {
    const storage = createConfigStateStorage();

    await storage.setItem("config-storage", JSON.stringify({
      state: {
        config: {
          provider: "openai",
          model: "gpt-4o",
          api_key: "secret-key",
          base_url: "https://api.openai.com/v1",
          enable_reasoning: false,
        },
      },
      version: 0,
    }));

    expect(writeTextFileMock).toHaveBeenCalledWith(
      "C:/Users/patri/AppData/Roaming/photonee/config-storage.json",
      expect.stringContaining("\"api_key\":\"secret-key\""),
    );
    expect(localStorage.getItem("config-storage")).toBeNull();
  });

  it("hydrates persisted config from the tauri app data directory", async () => {
    const storage = createConfigStateStorage();
    existsMock.mockResolvedValue(true);
    readTextFileMock.mockResolvedValue(JSON.stringify({
      state: {
        config: {
          provider: "openai",
          model: "gpt-4o-mini",
          api_key: "persisted-key",
          base_url: "https://api.openai.com/v1",
          enable_reasoning: false,
        },
      },
      version: 0,
    }));

    const storedValue = await storage.getItem("config-storage");

    expect(storedValue).toContain("\"persisted-key\"");
    expect(readTextFileMock).toHaveBeenCalledWith(
      "C:/Users/patri/AppData/Roaming/photonee/config-storage.json",
    );
  });
});
