import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanSessions } from "./storage";

const existsMock = vi.hoisted(() => vi.fn());
const readDirMock = vi.hoisted(() => vi.fn());
const readTextFileMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: existsMock,
  readDir: readDirMock,
  readTextFile: readTextFileMock,
  remove: vi.fn(),
}));

describe("scanSessions", () => {
  beforeEach(() => {
    (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__ = {
      invoke: vi.fn(),
    };
    existsMock.mockReset();
    readDirMock.mockReset();
    readTextFileMock.mockReset();
  });

  it("prefers metadata over reading full transcript content", async () => {
    const workspacePath = "/workspace-a";
    const sessionsDir = `${workspacePath}/.agent/sessions`;
    const transcriptPath = `${sessionsDir}/session-1.jsonl`;
    const metadataPath = `${sessionsDir}/session-1.meta.json`;

    existsMock.mockImplementation(async (path: string) => {
      if (path === sessionsDir) return true;
      if (path === metadataPath) return true;
      if (path === transcriptPath) return true;
      return false;
    });
    readDirMock.mockResolvedValue([{ isFile: true, name: "session-1.jsonl" }]);
    readTextFileMock.mockImplementation(async (path: string) => {
      if (path === metadataPath) {
        return JSON.stringify({
          created_at: "2026-03-19T08:00:00.000Z",
          updated_at: "2026-03-19T08:10:00.000Z",
          title: "Metadata title",
          locked_model: {
            profile_name: "primary",
            provider: "openai",
            model: "gpt-4o-mini",
          },
        });
      }
      if (path === transcriptPath) {
        throw new Error("Transcript should not be read when metadata is complete");
      }
      return "";
    });

    const sessions = await scanSessions(workspacePath);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual(
      expect.objectContaining({
        session_id: "session-1",
        workspace_path: workspacePath,
        created_at: "2026-03-19T08:00:00.000Z",
        updated_at: "2026-03-19T08:10:00.000Z",
        title: "Metadata title",
        locked_model: {
          profile_name: "primary",
          provider: "openai",
          model: "gpt-4o-mini",
        },
      })
    );
    expect(readTextFileMock).not.toHaveBeenCalledWith(transcriptPath);
  });
});
