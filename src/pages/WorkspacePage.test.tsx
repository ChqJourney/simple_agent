import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePage } from "./WorkspacePage";
import { useRunStore, useSessionStore, useUIStore, useWorkspaceStore } from "../stores";
import { useChatStore } from "../stores/chatStore";
import {
  createChatSessionFixture,
  createSessionMetaFixture,
  createWorkspaceFixture,
  resetFrontendTestState,
} from "../test/frontendTestState";
import { resetMocks } from "../test/mockUtils";
import { loadSessionHistory, scanSessions } from "../utils/storage";

const navigateMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());
const sendWorkspaceMock = vi.hoisted(() => vi.fn());
const interruptMock = vi.hoisted(() => vi.fn());
const useBeforeUnloadMock = vi.hoisted(() => vi.fn());
const confirmDialogMock = vi.hoisted(() => vi.fn());
let currentWorkspaceId = "workspace-1";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: confirmDialogMock,
}));

vi.mock("../utils/storage", async () => {
  const actual = await vi.importActual<typeof import("../utils/storage")>("../utils/storage");
  return {
    ...actual,
    loadSessionHistory: vi.fn(),
    scanSessions: vi.fn(),
    deleteSessionHistory: vi.fn(),
  };
});

vi.mock("../components/Workspace", () => ({
  TopBar: (props: { onOpenTimeline?: () => void; onBackHome?: () => void }) => {
    return (
      <>
        <button aria-label="Back to home" onClick={() => props.onBackHome?.()}>
          Back to home
        </button>
        <button onClick={() => props.onOpenTimeline?.()}>Open Timeline</button>
      </>
    );
  },
  LeftPanel: () => <div>LeftPanel</div>,
  RightPanel: () => <div>RightPanel</div>,
}));

vi.mock("../components/Chat", () => ({
  ChatContainer: () => <div>ChatContainer</div>,
}));

vi.mock("../components/Run", () => ({
  RunTimeline: ({ sessionId }: { sessionId?: string | null }) => (
    <div>{sessionId ? `Timeline for ${sessionId}` : "No session selected"}</div>
  ),
}));

vi.mock("../contexts/WebSocketContext", () => ({
  useWebSocket: () => ({
    isConnected: false,
    sendWorkspace: sendWorkspaceMock,
    interrupt: interruptMock,
  }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ workspaceId: currentWorkspaceId }),
    useBeforeUnload: useBeforeUnloadMock,
  };
});

const scanSessionsMock = vi.mocked(scanSessions);
const loadSessionHistoryMock = vi.mocked(loadSessionHistory);

describe("WorkspacePage", () => {
  beforeEach(() => {
    resetFrontendTestState();
    currentWorkspaceId = "workspace-1";
    vi.restoreAllMocks();
    resetMocks(
      navigateMock,
      invokeMock,
      sendWorkspaceMock,
      interruptMock,
      useBeforeUnloadMock,
      confirmDialogMock,
      scanSessionsMock,
      loadSessionHistoryMock,
    );
    scanSessionsMock.mockResolvedValue([]);
    loadSessionHistoryMock.mockResolvedValue([]);
    invokeMock.mockResolvedValue({
      canonical_path: "C:/Users/patri/source/repos/repo",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
      })
    );

    useWorkspaceStore.setState((state) => ({
      ...state,
      workspaces: [
        createWorkspaceFixture({
          id: "workspace-1",
          path: "C:/Users/patri/source/repos/../repos/repo",
          lastOpened: "2026-03-12T10:00:00.000Z",
          createdAt: "2026-03-12T09:00:00.000Z",
        }),
        createWorkspaceFixture({
          id: "workspace-2",
          name: "repo-2",
          path: "C:/Users/patri/source/repos/../repos/repo-2",
          lastOpened: "2026-03-12T10:05:00.000Z",
          createdAt: "2026-03-12T09:05:00.000Z",
        }),
      ],
      currentWorkspace: null,
    }));
    useUIStore.setState((state) => ({
      ...state,
      isPageLoading: true,
      locale: "en-US",
    }));
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [],
      currentSessionId: null,
    }));
    useChatStore.setState({
      sessions: {},
    });
    useRunStore.setState({
      sessions: {},
    });
    delete (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  });

  it("re-authorizes the saved workspace path before loading desktop files", async () => {
    render(<WorkspacePage />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("authorize_workspace_path", {
        selectedPath: "C:/Users/patri/source/repos/../repos/repo",
      });
    });

    await waitFor(() => {
      expect(scanSessionsMock).toHaveBeenCalledWith("C:/Users/patri/source/repos/repo");
    });

    expect(useWorkspaceStore.getState().workspaces[0]?.path).toBe(
      "C:/Users/patri/source/repos/repo"
    );
  });

  it("does not show a locked model badge for the current session", async () => {
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        createSessionMetaFixture({
          workspace_path: "C:/Users/patri/source/repos/repo",
          locked_model: {
            profile_name: "primary",
            provider: "openai",
            model: "gpt-4o",
          },
        }),
      ],
      currentSessionId: "session-a",
    }));

    const { queryByText } = render(<WorkspacePage />);

    expect(queryByText("Locked: openai/gpt-4o")).toBeNull();
  });

  it("auto-loads the first session history after entering the workspace", async () => {
    scanSessionsMock.mockResolvedValueOnce([
      {
        session_id: "session-a",
        workspace_path: "C:/Users/patri/source/repos/repo",
        created_at: "2026-03-12T10:00:00.000Z",
        updated_at: "2026-03-12T10:00:00.000Z",
        title: "First session",
      },
    ]);
    loadSessionHistoryMock.mockResolvedValueOnce([
      {
        id: "assistant-1",
        role: "assistant",
        content: "loaded automatically",
        status: "completed",
      },
    ]);

    render(<WorkspacePage />);

    await waitFor(() => {
      expect(loadSessionHistoryMock).toHaveBeenCalledWith(
        "C:/Users/patri/source/repos/repo",
        "session-a"
      );
    });

    expect(useSessionStore.getState().currentSessionId).toBe("session-a");
    expect(useChatStore.getState().sessions["session-a"]?.messages).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        content: "loaded automatically",
        status: "completed",
      },
    ]);
  });

  it("opens the timeline modal from the top bar even when there is no current session", async () => {
    render(<WorkspacePage />);

    fireEvent.click(screen.getByRole("button", { name: "Open Timeline" }));

    expect(screen.getByRole("dialog", { name: "Run timeline" })).toBeTruthy();
    expect(screen.getByText("No session selected")).toBeTruthy();
  });

  it("applies persisted left and right panel widths from ui state", async () => {
    useUIStore.setState((state) => ({
      ...state,
      leftPanelWidth: 312,
      rightPanelWidth: 344,
      locale: "en-US",
    }));

    render(<WorkspacePage />);

    expect((screen.getByTestId("workspace-left-panel") as HTMLDivElement).style.width).toBe("312px");
    expect((screen.getByTestId("workspace-right-panel") as HTMLDivElement).style.width).toBe("344px");
  });

  it("auto-focuses the checklist tab and highlights the right side when checklist results appear", async () => {
    scanSessionsMock.mockResolvedValueOnce([
      createSessionMetaFixture({
        scenario_id: "checklist_evaluation",
        scenario_version: 1,
        scenario_label: "Checklist Evaluation",
        workspace_path: "C:/Users/patri/source/repos/repo",
      }),
    ]);
    loadSessionHistoryMock.mockResolvedValueOnce([
      {
        id: "assistant-1",
        role: "assistant",
        content: `
\`\`\`json
{"rows":[{"clause":"5.1","requirement":"Durable marking","judgement":"pass"}]}
\`\`\`
`,
        status: "completed",
      },
    ]);
    useUIStore.setState((state) => ({
      ...state,
      rightPanelCollapsed: true,
      rightPanelTab: "filetree",
    }));

    render(<WorkspacePage />);

    await waitFor(() => {
      expect(useUIStore.getState().rightPanelCollapsed).toBe(false);
      expect(useUIStore.getState().rightPanelTab).toBe("checklist");
    });

    await waitFor(() => {
      expect(screen.getByTestId("workspace-main-panel").className).toContain("border-r");
      expect(screen.getByTestId("workspace-right-panel").className).toContain("border-l");
    });
  });

  it("only persists the left panel width after the resize drag completes", async () => {
    render(<WorkspacePage />);

    fireEvent.mouseDown(screen.getByTestId("workspace-left-resize-handle"), {
      clientX: 256,
    });
    fireEvent.mouseMove(window, {
      clientX: 340,
    });

    expect(useUIStore.getState().leftPanelWidth).not.toBe(340);
    expect((screen.getByTestId("workspace-left-panel") as HTMLDivElement).style.width).toBe("340px");

    fireEvent.mouseUp(window);

    await waitFor(() => {
      expect(useUIStore.getState().leftPanelWidth).toBe(340);
    });
  });

  it("ignores stale workspace authorization results after the current workspace changes", async () => {
    let resolveFirst: ((value: { canonical_path: string }) => void) | undefined;
    let resolveSecond: ((value: { canonical_path: string }) => void) | undefined;
    let firstPending = true;
    let secondPending = true;

    invokeMock.mockImplementation((_command, args: { selectedPath: string }) => {
      if (firstPending && args.selectedPath === "C:/Users/patri/source/repos/../repos/repo") {
        firstPending = false;
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }

      if (secondPending && args.selectedPath === "C:/Users/patri/source/repos/../repos/repo-2") {
        secondPending = false;
        return new Promise((resolve) => {
          resolveSecond = resolve;
        });
      }

      return Promise.resolve({
        canonical_path: args.selectedPath.includes("repo-2")
          ? "C:/Users/patri/source/repos/repo-2"
          : "C:/Users/patri/source/repos/repo",
      });
    });

    render(<WorkspacePage />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("authorize_workspace_path", {
        selectedPath: "C:/Users/patri/source/repos/../repos/repo",
      });
    });

    act(() => {
      useWorkspaceStore.getState().setCurrentWorkspace(useWorkspaceStore.getState().workspaces[1] ?? null);
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("authorize_workspace_path", {
        selectedPath: "C:/Users/patri/source/repos/../repos/repo-2",
      });
    });

    resolveFirst?.({
      canonical_path: "C:/Users/patri/source/repos/repo",
    });
    resolveSecond?.({
      canonical_path: "C:/Users/patri/source/repos/repo-2",
    });

    await waitFor(() => {
      expect(scanSessionsMock).toHaveBeenCalledWith("C:/Users/patri/source/repos/repo-2");
    });

    expect(scanSessionsMock).not.toHaveBeenCalledWith("C:/Users/patri/source/repos/repo");
  });

  it("confirms before leaving a workspace with active runs and interrupts them when confirmed", async () => {
    const updatedWorkspace =
      useWorkspaceStore
        .getState()
        .syncWorkspacePath("workspace-1", "C:/Users/patri/source/repos/repo")
      ?? null;
    useWorkspaceStore.setState((state) => ({
      ...state,
      currentWorkspace: updatedWorkspace,
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    scanSessionsMock.mockResolvedValueOnce([
      {
        session_id: "session-a",
        workspace_path: "C:/Users/patri/source/repos/repo",
        created_at: "2026-03-12T10:00:00.000Z",
        updated_at: "2026-03-12T10:00:00.000Z",
      },
    ]);
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          session_id: "session-a",
          workspace_path: "C:/Users/patri/source/repos/repo",
          created_at: "2026-03-12T10:00:00.000Z",
          updated_at: "2026-03-12T10:00:00.000Z",
        },
      ],
      currentSessionId: "session-a",
    }));
    render(<WorkspacePage />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().currentWorkspace?.path).toBe(
        "C:/Users/patri/source/repos/repo"
      );
    });
    act(() => {
      useSessionStore.setState((state) => ({
        ...state,
        sessions: [
          {
            session_id: "session-a",
            workspace_path: "C:/Users/patri/source/repos/../repos/repo",
            created_at: "2026-03-12T10:00:00.000Z",
            updated_at: "2026-03-12T10:00:00.000Z",
          },
        ],
        currentSessionId: "session-a",
      }));
      useChatStore.setState({
      sessions: {
        "session-a": createChatSessionFixture({
          isStreaming: true,
          assistantStatus: "streaming",
        }),
      },
    });
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to home" }));

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledTimes(1);
      expect(interruptMock).toHaveBeenCalledWith("session-a");
      expect(navigateMock).toHaveBeenCalledWith("/");
    });
    expect(vi.mocked(window.confirm).mock.calls[0]?.[0]).toContain("streaming");
  });

  it("stays on the workspace when leaving is cancelled", async () => {
    const updatedWorkspace =
      useWorkspaceStore
        .getState()
        .syncWorkspacePath("workspace-1", "C:/Users/patri/source/repos/repo")
      ?? null;
    useWorkspaceStore.setState((state) => ({
      ...state,
      currentWorkspace: updatedWorkspace,
    }));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    scanSessionsMock.mockResolvedValueOnce([
      {
        session_id: "session-a",
        workspace_path: "C:/Users/patri/source/repos/repo",
        created_at: "2026-03-12T10:00:00.000Z",
        updated_at: "2026-03-12T10:00:00.000Z",
      },
    ]);
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          session_id: "session-a",
          workspace_path: "C:/Users/patri/source/repos/repo",
          created_at: "2026-03-12T10:00:00.000Z",
          updated_at: "2026-03-12T10:00:00.000Z",
        },
      ],
      currentSessionId: "session-a",
    }));
    render(<WorkspacePage />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().currentWorkspace?.path).toBe(
        "C:/Users/patri/source/repos/repo"
      );
    });
    act(() => {
      useSessionStore.setState((state) => ({
        ...state,
        sessions: [
          {
            session_id: "session-a",
            workspace_path: "C:/Users/patri/source/repos/../repos/repo",
            created_at: "2026-03-12T10:00:00.000Z",
            updated_at: "2026-03-12T10:00:00.000Z",
          },
        ],
        currentSessionId: "session-a",
      }));
      useChatStore.setState({
      sessions: {
        "session-a": createChatSessionFixture({
          isStreaming: true,
          assistantStatus: "streaming",
        }),
      },
    });
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to home" }));

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(window.confirm).mock.calls[0]?.[0]).toContain("streaming");
    expect(interruptMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalledWith("/");
  });

  it("waits for the tauri confirm dialog before leaving the workspace", async () => {
    const updatedWorkspace =
      useWorkspaceStore
        .getState()
        .syncWorkspacePath("workspace-1", "C:/Users/patri/source/repos/repo")
      ?? null;
    useWorkspaceStore.setState((state) => ({
      ...state,
      currentWorkspace: updatedWorkspace,
    }));
    (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__ = {
      invoke: vi.fn(),
    };

    let resolveConfirm: ((value: boolean) => void) | undefined;
    confirmDialogMock.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        })
    );

    render(<WorkspacePage />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().currentWorkspace?.path).toBe(
        "C:/Users/patri/source/repos/repo"
      );
    });

    act(() => {
      useSessionStore.setState((state) => ({
        ...state,
        sessions: [
          {
            session_id: "session-a",
            workspace_path: "C:/Users/patri/source/repos/../repos/repo",
            created_at: "2026-03-12T10:00:00.000Z",
            updated_at: "2026-03-12T10:00:00.000Z",
          },
        ],
        currentSessionId: "session-a",
      }));
      useChatStore.setState({
      sessions: {
        "session-a": createChatSessionFixture({
          isStreaming: true,
          assistantStatus: "streaming",
        }),
      },
    });
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to home" }));

    await waitFor(() => {
      expect(confirmDialogMock).toHaveBeenCalled();
    });
    expect(confirmDialogMock.mock.calls[0]?.[0]).toContain("streaming");
    expect(confirmDialogMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        title: expect.any(String),
        kind: "warning",
      }),
    );
    expect(interruptMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();

    resolveConfirm?.(false);

    await waitFor(() => {
      expect(interruptMock).not.toHaveBeenCalled();
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  it("prompts before leaving when background compaction is active", async () => {
    const updatedWorkspace =
      useWorkspaceStore
        .getState()
        .syncWorkspacePath("workspace-1", "C:/Users/patri/source/repos/repo")
      ?? null;
    useWorkspaceStore.setState((state) => ({
      ...state,
      currentWorkspace: updatedWorkspace,
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          session_id: "session-a",
          workspace_path: "C:/Users/patri/source/repos/repo",
          created_at: "2026-03-12T10:00:00.000Z",
          updated_at: "2026-03-12T10:00:00.000Z",
        },
      ],
      currentSessionId: "session-a",
    }));
    useRunStore.getState().addEvent("session-a", {
      event_type: "session_compaction_started",
      session_id: "session-a",
      run_id: "run-1",
      payload: {
        strategy: "background",
      },
      timestamp: "2026-03-28T07:01:30.000Z",
    });

    render(<WorkspacePage />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().currentWorkspace?.path).toBe(
        "C:/Users/patri/source/repos/repo"
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to home" }));

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledTimes(1);
      expect(interruptMock).toHaveBeenCalledWith("session-a");
      expect(navigateMock).toHaveBeenCalledWith("/");
    });
    expect(vi.mocked(window.confirm).mock.calls[0]?.[0]).toContain("compaction");
  });

  it("stays on the workspace when leaving is cancelled during background compaction", async () => {
    const updatedWorkspace =
      useWorkspaceStore
        .getState()
        .syncWorkspacePath("workspace-1", "C:/Users/patri/source/repos/repo")
      ?? null;
    useWorkspaceStore.setState((state) => ({
      ...state,
      currentWorkspace: updatedWorkspace,
    }));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          session_id: "session-a",
          workspace_path: "C:/Users/patri/source/repos/repo",
          created_at: "2026-03-12T10:00:00.000Z",
          updated_at: "2026-03-12T10:00:00.000Z",
        },
      ],
      currentSessionId: "session-a",
    }));
    useRunStore.getState().addEvent("session-a", {
      event_type: "session_compaction_started",
      session_id: "session-a",
      run_id: "run-1",
      payload: {
        strategy: "background",
      },
      timestamp: "2026-03-28T07:01:30.000Z",
    });

    render(<WorkspacePage />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().currentWorkspace?.path).toBe(
        "C:/Users/patri/source/repos/repo"
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to home" }));

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(window.confirm).mock.calls[0]?.[0]).toContain("compaction");
    expect(interruptMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalledWith("/");
  });

  it("uses a combined prompt when both streaming and compaction are active", async () => {
    const updatedWorkspace =
      useWorkspaceStore
        .getState()
        .syncWorkspacePath("workspace-1", "C:/Users/patri/source/repos/repo")
      ?? null;
    useWorkspaceStore.setState((state) => ({
      ...state,
      currentWorkspace: updatedWorkspace,
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          session_id: "session-a",
          workspace_path: "C:/Users/patri/source/repos/repo",
          created_at: "2026-03-12T10:00:00.000Z",
          updated_at: "2026-03-12T10:00:00.000Z",
        },
      ],
      currentSessionId: "session-a",
    }));

    render(<WorkspacePage />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().currentWorkspace?.path).toBe(
        "C:/Users/patri/source/repos/repo"
      );
    });

    act(() => {
      useChatStore.setState({
      sessions: {
        "session-a": createChatSessionFixture({
          isStreaming: true,
          assistantStatus: "streaming",
        }),
      },
    });
      useRunStore.getState().addEvent("session-a", {
        event_type: "session_compaction_started",
        session_id: "session-a",
        run_id: "run-1",
        payload: {
          strategy: "background",
        },
        timestamp: "2026-03-28T07:01:30.000Z",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to home" }));

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledTimes(1);
      expect(interruptMock).toHaveBeenCalledWith("session-a");
      expect(navigateMock).toHaveBeenCalledWith("/");
    });
    const combinedPrompt = vi.mocked(window.confirm).mock.calls[0]?.[0] ?? "";
    expect(combinedPrompt).toContain("streaming");
    expect(combinedPrompt).toContain("compaction");
  });
});
