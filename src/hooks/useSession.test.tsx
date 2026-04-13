import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSession } from "./useSession";
import { useChatStore } from "../stores/chatStore";
import { useRunStore } from "../stores/runStore";
import { useSessionStore } from "../stores/sessionStore";
import { useTaskStore } from "../stores/taskStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import {
  createChatSessionFixture,
  createRunSessionFixture,
  createSessionMetaFixture,
  createWorkspaceFixture,
  resetFrontendTestState,
} from "../test/frontendTestState";
import { resetMocks } from "../test/mockUtils";
import { deleteSessionHistory, loadSessionHistory, scanSessions } from "../utils/storage";

const interruptMock = vi.hoisted(() => vi.fn());
const createRemoteSessionMock = vi.hoisted(() => vi.fn());
const updateSessionScenarioMock = vi.hoisted(() => vi.fn());

vi.mock("../utils/storage", async () => {
  const actual = await vi.importActual<typeof import("../utils/storage")>("../utils/storage");
  return {
    ...actual,
    deleteSessionHistory: vi.fn(),
    loadSessionHistory: vi.fn(),
    scanSessions: vi.fn(),
  };
});

vi.mock("../contexts/WebSocketContext", () => ({
  useWebSocket: () => ({
    interrupt: interruptMock,
    createSession: createRemoteSessionMock,
    updateSessionScenario: updateSessionScenarioMock,
  }),
}));

const deleteSessionHistoryMock = vi.mocked(deleteSessionHistory);
const loadSessionHistoryMock = vi.mocked(loadSessionHistory);
const scanSessionsMock = vi.mocked(scanSessions);

describe("useSession", () => {
  beforeEach(() => {
    resetFrontendTestState();
    vi.restoreAllMocks();
    resetMocks(
      interruptMock,
      createRemoteSessionMock,
      updateSessionScenarioMock,
      deleteSessionHistoryMock,
      loadSessionHistoryMock,
      scanSessionsMock,
    );
    deleteSessionHistoryMock.mockResolvedValue(undefined);
    loadSessionHistoryMock.mockResolvedValue([]);
    scanSessionsMock.mockResolvedValue([]);

    useWorkspaceStore.setState((state) => ({
      ...state,
      currentWorkspace: createWorkspaceFixture({
        path: "C:/repo",
        lastOpened: "2026-03-19T13:00:00.000Z",
        createdAt: "2026-03-19T12:00:00.000Z",
      }),
    }));
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        createSessionMetaFixture({
          session_id: "session-a",
          workspace_path: "C:/repo",
          created_at: "2026-03-19T12:00:00.000Z",
          updated_at: "2026-03-19T12:00:00.000Z",
        }),
        createSessionMetaFixture({
          session_id: "session-b",
          workspace_path: "C:/repo",
          created_at: "2026-03-19T12:05:00.000Z",
          updated_at: "2026-03-19T12:05:00.000Z",
        }),
      ],
      currentSessionId: "session-a",
    }));
    useChatStore.setState({
      sessions: {
        "session-a": createChatSessionFixture(),
        "session-b": createChatSessionFixture(),
      },
    });
    useRunStore.setState({
      sessions: {
        "session-a": createRunSessionFixture({
          currentRunId: "run-a",
          status: "running",
        }),
        "session-b": createRunSessionFixture({
          currentRunId: "run-b",
          status: "completed",
        }),
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
      visibleTaskTabSessionIds: {
        "session-a": true,
        "session-b": true,
      },
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
    expect(useTaskStore.getState().isTaskTabVisible("session-a")).toBe(false);
    expect(useChatStore.getState().sessions["session-b"]).toBeDefined();
    expect(useRunStore.getState().sessions["session-b"]).toBeDefined();
    expect(useTaskStore.getState().getTasksBySession("session-b")).toHaveLength(1);
    expect(useTaskStore.getState().isTaskTabVisible("session-b")).toBe(true);
  });

  it("releases the previous chat session when switching sessions", async () => {
    loadSessionHistoryMock.mockResolvedValueOnce([
      {
        id: "assistant-1",
        role: "assistant",
        content: "loaded from disk",
        status: "completed",
      },
    ]);

    const { result } = renderHook(() => useSession());

    await act(async () => {
      await result.current.switchSession("session-b");
    });

    expect(loadSessionHistoryMock).toHaveBeenCalledWith("C:/repo", "session-b");
    expect(useSessionStore.getState().currentSessionId).toBe("session-b");
    expect(useChatStore.getState().sessions["session-a"]).toBeUndefined();
    expect(useChatStore.getState().sessions["session-b"]?.messages).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        content: "loaded from disk",
        status: "completed",
      },
    ]);
  });

  it("interrupts the current session before switching when a reply is still streaming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    useChatStore.setState({
      sessions: {
        ...useChatStore.getState().sessions,
        "session-a": createChatSessionFixture({
          ...useChatStore.getState().sessions["session-a"],
          isStreaming: true,
          assistantStatus: "streaming",
        }),
      },
    });

    const { result } = renderHook(() => useSession());

    await act(async () => {
      await result.current.switchSession("session-b");
    });

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(window.confirm).mock.calls[0]?.[0]).toContain("streaming");
    expect(interruptMock).toHaveBeenCalledWith("session-a");
    expect(useSessionStore.getState().currentSessionId).toBe("session-b");
  });

  it("keeps the current session when switching is cancelled during streaming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    useChatStore.setState({
      sessions: {
        ...useChatStore.getState().sessions,
        "session-a": createChatSessionFixture({
          ...useChatStore.getState().sessions["session-a"],
          isStreaming: true,
          assistantStatus: "streaming",
        }),
      },
    });

    const { result } = renderHook(() => useSession());

    await act(async () => {
      await result.current.switchSession("session-b");
    });

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(window.confirm).mock.calls[0]?.[0]).toContain("streaming");
    expect(interruptMock).not.toHaveBeenCalled();
    expect(loadSessionHistoryMock).not.toHaveBeenCalled();
    expect(useSessionStore.getState().currentSessionId).toBe("session-a");
  });
});
