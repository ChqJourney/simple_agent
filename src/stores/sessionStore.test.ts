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

  it("preserves title and locked model metadata on session updates", () => {
    useSessionStore.getState().addSession({
      session_id: "session-a",
      workspace_path: "/workspace-a",
      created_at: "2026-03-12T10:00:00.000Z",
      updated_at: "2026-03-12T10:00:00.000Z",
      scenario_id: "standard_qa",
      scenario_version: 1,
    });

    useSessionStore.getState().updateSession("session-a", {
      title: "Investigate runtime contracts",
      locked_model: {
        profile_name: "primary",
        provider: "openai",
        model: "gpt-4o-mini",
      },
    });

    expect(useSessionStore.getState().sessions[0]?.title).toBe("Investigate runtime contracts");
    expect(useSessionStore.getState().sessions[0]?.locked_model?.model).toBe("gpt-4o-mini");
    expect(useSessionStore.getState().sessions[0]?.scenario_id).toBe("standard_qa");
    expect(useSessionStore.getState().sessions[0]?.scenario_version).toBe(1);
  });

  it("moves the most recently updated session to the front", () => {
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          session_id: "session-a",
          workspace_path: "/workspace-a",
          created_at: "2026-03-12T10:00:00.000Z",
          updated_at: "2026-03-12T10:00:00.000Z",
        },
        {
          session_id: "session-b",
          workspace_path: "/workspace-a",
          created_at: "2026-03-12T11:00:00.000Z",
          updated_at: "2026-03-12T11:00:00.000Z",
        },
      ],
    }));

    useSessionStore.getState().updateSession("session-a", {
      title: "Now active",
      updated_at: "2026-03-12T12:00:00.000Z",
    });

    expect(useSessionStore.getState().sessions[0]?.session_id).toBe("session-a");
    expect(useSessionStore.getState().sessions[1]?.session_id).toBe("session-b");
  });

  it("hydrates title metadata from disk for an existing session", async () => {
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
        session_id: "session-a",
        workspace_path: "/workspace-a",
        created_at: "2026-03-12T10:00:00.000Z",
        updated_at: "2026-03-12T11:30:00.000Z",
        title: "Investigate runtime contracts",
      },
    ]);

    await useSessionStore.getState().loadSessionsFromDisk("/workspace-a");

    expect(useSessionStore.getState().sessions[0]?.title).toBe("Investigate runtime contracts");
    expect(useSessionStore.getState().sessions[0]?.updated_at).toBe("2026-03-12T11:30:00.000Z");
  });
});
