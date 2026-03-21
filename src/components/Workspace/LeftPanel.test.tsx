import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeftPanel } from "./LeftPanel";
import { useConfigStore } from "../../stores/configStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("../Sidebar/SessionList", () => ({
  SessionList: () => <div>SessionList</div>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("LeftPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspaceStore.setState((state) => ({
      ...state,
      currentWorkspace: {
        id: "workspace-1",
        name: "tauri_agent",
        path: "C:/Users/patri/source/repos/tauri_agent",
        lastOpened: "2026-03-19T10:00:00.000Z",
        createdAt: "2026-03-19T09:00:00.000Z",
      },
    }));
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          session_id: "session-a",
          workspace_path: "C:/Users/patri/source/repos/tauri_agent",
          created_at: "2026-03-19T10:00:00.000Z",
          updated_at: "2026-03-19T10:00:00.000Z",
          title: "One",
        },
        {
          session_id: "session-b",
          workspace_path: "C:/Users/patri/source/repos/tauri_agent",
          created_at: "2026-03-19T11:00:00.000Z",
          updated_at: "2026-03-19T11:00:00.000Z",
          title: "Two",
        },
        {
          session_id: "session-c",
          workspace_path: "C:/Users/patri/source/repos/other",
          created_at: "2026-03-19T12:00:00.000Z",
          updated_at: "2026-03-19T12:00:00.000Z",
          title: "Other",
        },
      ],
    }));
    useConfigStore.setState({
      config: {
        provider: "openai",
        model: "gpt-4o",
      } as never,
    });
  });

  it("shows workspace title, absolute path, and filtered session count", () => {
    render(<LeftPanel />);

    expect(screen.getByText("Workspace - tauri_agent")).toBeTruthy();
    expect(screen.getByTitle("C:/Users/patri/source/repos/tauri_agent")).toBeTruthy();
    expect(screen.getByText("2 sessions")).toBeTruthy();
    expect(screen.queryByText("gpt-4o")).toBeNull();
  });

  it("opens the current workspace folder from the left panel action", async () => {
    render(<LeftPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Open workspace folder" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("open_workspace_folder", {
        selectedPath: "C:/Users/patri/source/repos/tauri_agent",
      });
    });
  });
});
