import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeftPanel } from "./LeftPanel";
import { useConfigStore } from "../../stores/configStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

const invokeMock = vi.hoisted(() => vi.fn());
const listSystemSkillsMock = vi.hoisted(() => vi.fn());
const listWorkspaceSkillsMock = vi.hoisted(() => vi.fn());

vi.mock("../Sidebar/SessionList", () => ({
  SessionList: () => <div>SessionList</div>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("../../utils/systemSkills", () => ({
  listSystemSkills: listSystemSkillsMock,
  listWorkspaceSkills: listWorkspaceSkillsMock,
}));

describe("LeftPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    listSystemSkillsMock.mockReset();
    listWorkspaceSkillsMock.mockReset();
    listSystemSkillsMock.mockResolvedValue({
      rootPath: "/system-skills",
      skills: [
        { name: "deploy-checks", description: "System skill", path: "/system-skills/deploy-checks/SKILL.md" },
      ],
    });
    listWorkspaceSkillsMock.mockResolvedValue({
      rootPath: "C:/Users/patri/source/repos/tauri_agent/.agent/skills",
      skills: [
        { name: "repo-helper", description: "Workspace skill", path: "C:/Users/patri/source/repos/tauri_agent/.agent/skills/repo-helper/SKILL.md" },
      ],
    });

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

  it("shows workspace title and absolute path", () => {
    render(<LeftPanel />);

    expect(screen.getByText("Workspace - tauri_agent")).toBeTruthy();
    expect(screen.getByTitle("C:/Users/patri/source/repos/tauri_agent")).toBeTruthy();
    expect(screen.getByText("SessionList")).toBeTruthy();
    expect(screen.queryByText("gpt-4o")).toBeNull();
  });

  it("shows skill counts and opens a modal with system and workspace skill lists", async () => {
    render(<LeftPanel />);

    await waitFor(() => {
      expect(screen.getByText("System 1 · Workspace 1")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Skills/i }));

    expect(screen.getByRole("dialog", { name: "Workspace skills" })).toBeTruthy();
    expect(screen.getByText("deploy-checks")).toBeTruthy();
    expect(screen.getByText("repo-helper")).toBeTruthy();
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
