import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RightPanel } from "./RightPanel";
import { useSessionStore, useTaskStore, useUIStore } from "../../stores";

vi.mock("./FileTree", () => ({
  FileTree: () => <div>FileTree Content</div>,
}));

vi.mock("./TaskList", () => ({
  TaskList: () => <div>TaskList Content</div>,
}));

describe("RightPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState((state) => ({
      ...state,
      rightPanelTab: "filetree",
      rightPanelCollapsed: false,
      rightPanelWidth: 288,
    }));
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [],
      currentSessionId: "session-a",
    }));
    useTaskStore.setState({
      tasks: [],
      visibleTaskTabSessionIds: {},
    });
  });

  it("renders only the file tree tab when no todo task tab is visible", () => {
    render(<RightPanel />);

    expect(screen.getByRole("button", { name: "File Tree" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tasks" })).toBeNull();
    expect(screen.getByText("FileTree Content")).toBeTruthy();
  });

  it("adds the task tab for the active session when requested", () => {
    useTaskStore.getState().markTaskTabVisible("session-a");

    render(<RightPanel />);

    expect(screen.getByRole("button", { name: "Tasks" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));

    expect(screen.getByText("TaskList Content")).toBeTruthy();
  });

  it("falls back to file tree when the active task tab is removed", async () => {
    useUIStore.setState((state) => ({
      ...state,
      rightPanelTab: "tasklist",
    }));
    useTaskStore.getState().markTaskTabVisible("session-a");

    render(<RightPanel />);

    expect(screen.getByText("TaskList Content")).toBeTruthy();

    act(() => {
      useTaskStore.getState().hideTaskTab("session-a");
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Tasks" })).toBeNull();
      expect(screen.getByText("FileTree Content")).toBeTruthy();
      expect(useUIStore.getState().rightPanelTab).toBe("filetree");
    });
  });
});
