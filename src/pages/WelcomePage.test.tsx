import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WelcomePage } from "./WelcomePage";
import { useUIStore, useWorkspaceStore } from "../stores";

const navigateMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe("WelcomePage", () => {
  beforeEach(() => {
    localStorage.clear();
    navigateMock.mockReset();
    openMock.mockReset();
    invokeMock.mockReset();

    useWorkspaceStore.setState((state) => ({
      ...state,
      workspaces: [],
      currentWorkspace: null,
    }));
    useUIStore.setState((state) => ({
      ...state,
      isPageLoading: false,
    }));
  });

  it("reuses an existing workspace when the host reports the selected path already exists", async () => {
    useWorkspaceStore.setState((state) => ({
      ...state,
      workspaces: [
        {
          id: "workspace-1",
          name: "repo",
          path: "C:/Users/patri/source/repos/repo",
          lastOpened: "2026-03-12T10:00:00.000Z",
          createdAt: "2026-03-12T09:00:00.000Z",
        },
      ],
    }));
    openMock.mockResolvedValue("C:/Users/patri/source/repos/repo/./");
    invokeMock.mockResolvedValue({
      status: "existing",
      canonical_path: "C:/Users/patri/source/repos/repo",
      existing_index: 0,
    });

    render(<WelcomePage />);

    fireEvent.click(screen.getByRole("button", { name: /\+ new workspace/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("prepare_workspace_path", {
        selectedPath: "C:/Users/patri/source/repos/repo/./",
        existingPaths: ["C:/Users/patri/source/repos/repo"],
      });
    });

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    expect(useWorkspaceStore.getState().currentWorkspace?.id).toBe("workspace-1");
    expect(navigateMock).toHaveBeenCalledWith("/workspace/workspace-1");
  });

  it("stores the canonical path returned by the host for new workspaces", async () => {
    openMock.mockResolvedValue("C:/Users/patri/source/repos/repo/../repo");
    invokeMock.mockResolvedValue({
      status: "created",
      canonical_path: "C:/Users/patri/source/repos/repo",
    });

    render(<WelcomePage />);

    fireEvent.click(screen.getByRole("button", { name: /\+ new workspace/i }));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    });

    expect(useWorkspaceStore.getState().workspaces[0]?.path).toBe(
      "C:/Users/patri/source/repos/repo"
    );
    expect(useWorkspaceStore.getState().currentWorkspace?.path).toBe(
      "C:/Users/patri/source/repos/repo"
    );
  });
});
