import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePage } from "./WorkspacePage";
import { useSessionStore, useUIStore, useWorkspaceStore } from "../stores";
import { scanSessions } from "../utils/storage";

const navigateMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());
const sendWorkspaceMock = vi.hoisted(() => vi.fn());
let currentWorkspaceId = "workspace-1";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("../utils/storage", async () => {
  const actual = await vi.importActual<typeof import("../utils/storage")>("../utils/storage");
  return {
    ...actual,
    scanSessions: vi.fn(),
    deleteSessionHistory: vi.fn(),
  };
});

vi.mock("../components/Workspace", () => ({
  TopBar: ({ onOpenTimeline }: { onOpenTimeline?: () => void }) => (
    <button onClick={onOpenTimeline}>Open Timeline</button>
  ),
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
  }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ workspaceId: currentWorkspaceId }),
  };
});

const scanSessionsMock = vi.mocked(scanSessions);

describe("WorkspacePage", () => {
  beforeEach(() => {
    localStorage.clear();
    currentWorkspaceId = "workspace-1";
    navigateMock.mockReset();
    invokeMock.mockReset();
    sendWorkspaceMock.mockReset();
    scanSessionsMock.mockReset();
    scanSessionsMock.mockResolvedValue([]);
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
        {
          id: "workspace-1",
          name: "repo",
          path: "C:/Users/patri/source/repos/../repos/repo",
          lastOpened: "2026-03-12T10:00:00.000Z",
          createdAt: "2026-03-12T09:00:00.000Z",
        },
        {
          id: "workspace-2",
          name: "repo-2",
          path: "C:/Users/patri/source/repos/../repos/repo-2",
          lastOpened: "2026-03-12T10:05:00.000Z",
          createdAt: "2026-03-12T09:05:00.000Z",
        },
      ],
      currentWorkspace: null,
    }));
    useUIStore.setState((state) => ({
      ...state,
      isPageLoading: true,
    }));
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [],
      currentSessionId: null,
    }));
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
        {
          session_id: "session-a",
          workspace_path: "C:/Users/patri/source/repos/repo",
          created_at: "2026-03-12T10:00:00.000Z",
          updated_at: "2026-03-12T10:00:00.000Z",
          locked_model: {
            profile_name: "primary",
            provider: "openai",
            model: "gpt-4o",
          },
        },
      ],
      currentSessionId: "session-a",
    }));

    const { queryByText } = render(<WorkspacePage />);

    expect(queryByText("Locked: openai/gpt-4o")).toBeNull();
  });

  it("opens the timeline modal from the top bar even when there is no current session", async () => {
    render(<WorkspacePage />);

    fireEvent.click(screen.getByRole("button", { name: "Open Timeline" }));

    expect(screen.getByRole("dialog", { name: "Run timeline" })).toBeTruthy();
    expect(screen.getByText("No session selected")).toBeTruthy();
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
});
