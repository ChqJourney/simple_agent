import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TaskList } from "./TaskList";
import { useSessionStore, useTaskStore, useUIStore } from "../../stores";
import { resetFrontendTestState } from "../../test/frontendTestState";

describe("TaskList", () => {
  beforeEach(() => {
    resetFrontendTestState();
    useUIStore.setState((state) => ({
      ...state,
      locale: "en-US",
    }));
    useSessionStore.setState((state) => ({
      ...state,
      currentSessionId: "session-a",
    }));
    useTaskStore.getState().clearTasks();
  });

  it("renders an empty state when the current session has no tasks", () => {
    render(<TaskList />);

    expect(screen.getByText("No tasks yet")).toBeTruthy();
  });

  it("renders only the tasks for the active session", () => {
    useTaskStore.getState().addTask({
      id: "task-a",
      sessionId: "session-a",
      content: "Visible task",
      status: "pending",
      createdAt: "2026-04-01T10:00:00.000Z",
    });
    useTaskStore.getState().addTask({
      id: "task-b",
      sessionId: "session-b",
      content: "Hidden task",
      status: "completed",
      createdAt: "2026-04-01T10:05:00.000Z",
    });

    render(<TaskList />);

    expect(screen.getByText("Visible task")).toBeTruthy();
    expect(screen.queryByText("Hidden task")).toBeNull();
  });

  it("renders nested subtasks and preserves status-specific styling hooks", () => {
    useTaskStore.getState().addTask({
      id: "task-a",
      sessionId: "session-a",
      content: "Parent task",
      status: "in_progress",
      createdAt: "2026-04-01T10:00:00.000Z",
      subTasks: [
        {
          id: "subtask-a",
          content: "Completed child",
          status: "completed",
        },
        {
          id: "subtask-b",
          content: "Failed child",
          status: "failed",
        },
      ],
    });

    render(<TaskList />);

    const parentTask = screen.getByText("Parent task");
    const completedChild = screen.getByText("Completed child");
    const failedChild = screen.getByText("Failed child");

    expect(parentTask.className).toContain("text-blue-600");
    expect(completedChild.className).toContain("text-green-600");
    expect(failedChild.className).toContain("text-red-600");
  });
});
