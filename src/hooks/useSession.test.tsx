import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSession } from "./useSession";
import { useChatStore } from "../stores/chatStore";
import { useRunStore } from "../stores/runStore";
import { useSessionStore } from "../stores/sessionStore";
import { useTaskStore } from "../stores/taskStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { deleteSessionHistory, loadSessionHistory, scanSessions } from "../utils/storage";

vi.mock("../utils/storage", async () => {
  const actual = await vi.importActual<typeof import("../utils/storage")>("../utils/storage");
  return {
    ...actual,
    deleteSessionHistory: vi.fn(),
    loadSessionHistory: vi.fn(),
    scanSessions: vi.fn(),
  };
});

const deleteSessionHistoryMock = vi.mocked(deleteSessionHistory);
const loadSessionHistoryMock = vi.mocked(loadSessionHistory);
const scanSessionsMock = vi.mocked(scanSessions);

describe("useSession", () => {
  beforeEach(() => {
    localStorage.clear();
    deleteSessionHistoryMock.mockReset();
    deleteSessionHistoryMock.mockResolvedValue(undefined);
    loadSessionHistoryMock.mockReset();
    loadSessionHistoryMock.mockResolvedValue([]);
    scanSessionsMock.mockReset();
    scanSessionsMock.mockResolvedValue([]);

    useWorkspaceStore.setState((state) => ({
      ...state,
      currentWorkspace: {
        id: "workspace-1",
        name: "repo",
        path: "C:/repo",
        lastOpened: "2026-03-19T13:00:00.000Z",
        createdAt: "2026-03-19T12:00:00.000Z",
      },
    }));
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          session_id: "session-a",
          workspace_path: "C:/repo",
          created_at: "2026-03-19T12:00:00.000Z",
          updated_at: "2026-03-19T12:00:00.000Z",
        },
        {
          session_id: "session-b",
          workspace_path: "C:/repo",
          created_at: "2026-03-19T12:05:00.000Z",
          updated_at: "2026-03-19T12:05:00.000Z",
        },
      ],
      currentSessionId: "session-a",
    }));
    useChatStore.setState({
      sessions: {
        "session-a": {
          messages: [],
          runEvents: [],
          currentStreamingContent: "",
          currentReasoningContent: "",
          isStreaming: false,
          assistantStatus: "idle",
          currentToolName: undefined,
          pendingToolConfirm: undefined,
          pendingQuestion: undefined,
        },
        "session-b": {
          messages: [],
          runEvents: [],
          currentStreamingContent: "",
          currentReasoningContent: "",
          isStreaming: false,
          assistantStatus: "idle",
          currentToolName: undefined,
          pendingToolConfirm: undefined,
          pendingQuestion: undefined,
        },
      },
    });
    useRunStore.setState({
      sessions: {
        "session-a": {
          events: [],
          currentRunId: "run-a",
          status: "running",
        },
        "session-b": {
          events: [],
          currentRunId: "run-b",
          status: "completed",
        },
      },
    });
    useTaskStore.setState({
      tasks: [
        {
          id: "task-a",
          sessionId: "session-a",
          content: "old task",
          status: "pending",
          createdAt: "2026-03-19T12:10:00.000Z",
        },
        {
          id: "task-b",
          sessionId: "session-b",
          content: "keep task",
          status: "pending",
          createdAt: "2026-03-19T12:11:00.000Z",
        },
      ],
    });
  });

  it("cleans chat, run, and task state for a deleted session", async () => {
    const { result } = renderHook(() => useSession());

    await act(async () => {
      await result.current.deleteSession("session-a");
    });

    expect(deleteSessionHistoryMock).toHaveBeenCalledWith("C:/repo", "session-a");
    expect(useChatStore.getState().sessions["session-a"]).toBeUndefined();
    expect(useRunStore.getState().sessions["session-a"]).toBeUndefined();
    expect(useTaskStore.getState().getTasksBySession("session-a")).toHaveLength(0);
    expect(useChatStore.getState().sessions["session-b"]).toBeDefined();
    expect(useRunStore.getState().sessions["session-b"]).toBeDefined();
    expect(useTaskStore.getState().getTasksBySession("session-b")).toHaveLength(1);
  });
});
