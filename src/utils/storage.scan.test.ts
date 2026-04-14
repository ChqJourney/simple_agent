import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSessionHistory, scanSessions } from "./storage";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("storage session access", () => {
  beforeEach(() => {
    (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__ = {
      invoke: vi.fn(),
    };
    invokeMock.mockReset();
  });

  it("loads scanned sessions through tauri invoke", async () => {
    invokeMock.mockResolvedValue([
      {
        session_id: "session-1",
        workspace_path: "/workspace-a",
        created_at: "2026-03-19T08:00:00.000Z",
        updated_at: "2026-03-19T08:10:00.000Z",
        title: "Metadata title",
        locked_model: {
          profile_name: "primary",
          provider: "openai",
          model: "gpt-4o-mini",
        },
        scenario_id: "standard_qa",
        scenario_version: 1,
        scenario_label: "Standard QA",
      },
    ]);

    const sessions = await scanSessions("/workspace-a");

    expect(invokeMock).toHaveBeenCalledWith("scan_workspace_sessions", {
      workspacePath: "/workspace-a",
    });
    expect(sessions).toEqual([
      expect.objectContaining({
        session_id: "session-1",
        workspace_path: "/workspace-a",
        title: "Metadata title",
        scenario_id: "standard_qa",
      }),
    ]);
  });

  it("loads session history through tauri invoke", async () => {
    invokeMock.mockResolvedValue({
      content: [
        JSON.stringify({
          role: "user",
          content: "hello",
          timestamp: "2026-03-19T08:00:00.000Z",
        }),
        JSON.stringify({
          role: "assistant",
          content: "world",
          timestamp: "2026-03-19T08:00:10.000Z",
        }),
      ].join("\n"),
    });

    const messages = await loadSessionHistory("/workspace-a", "session-1");

    expect(invokeMock).toHaveBeenCalledWith("read_session_history", {
      workspacePath: "/workspace-a",
      sessionId: "session-1",
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.content).toBe("world");
  });
});
