import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePage } from "./WorkspacePage";
import { useSessionStore, useUIStore, useWorkspaceStore } from "../stores";
import { scanSessions } from "../utils/storage";

const navigateMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());
const sendWorkspaceMock = vi.hoisted(() => vi.fn());

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
  TopBar: () => <div>TopBar</div>,
  LeftPanel: () => <div>LeftPanel</div>,
  RightPanel: () => <div>RightPanel</div>,
}));

vi.mock("../components/Chat", () => ({
  ChatContainer: () => <div>ChatContainer</div>,
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
    useParams: () => ({ workspaceId: "workspace-1" }),
  };
});

const scanSessionsMock = vi.mocked(scanSessions);

describe("WorkspacePage", () => {
  beforeEach(() => {
    localStorage.clear();
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
});
