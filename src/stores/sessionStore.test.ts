import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "./sessionStore";
import { scanSessions } from "../utils/storage";

vi.mock("../utils/storage", async () => {
  const actual = await vi.importActual<typeof import("../utils/storage")>("../utils/storage");
  return {
    ...actual,
    scanSessions: vi.fn(),
    deleteSessionHistory: vi.fn(),
  };
});

const scanSessionsMock = vi.mocked(scanSessions);

describe("sessionStore", () => {
  beforeEach(() => {
    localStorage.clear();
    scanSessionsMock.mockReset();
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [],
      currentSessionId: null,
    }));
  });

  it("selects a session from the loaded workspace when the current session belongs elsewhere", async () => {
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          session_id: "session-a",
          workspace_path: "/workspace-a",
          created_at: "2026-03-12T10:00:00.000Z",
          updated_at: "2026-03-12T10:00:00.000Z",
        },
      ],
      currentSessionId: "session-a",
    }));

    scanSessionsMock.mockResolvedValue([
      {
        session_id: "session-b",
        workspace_path: "/workspace-b",
        created_at: "2026-03-12T11:00:00.000Z",
        updated_at: "2026-03-12T11:00:00.000Z",
      },
    ]);

    await useSessionStore.getState().loadSessionsFromDisk("/workspace-b");

    expect(useSessionStore.getState().currentSessionId).toBe("session-b");
  });
});
