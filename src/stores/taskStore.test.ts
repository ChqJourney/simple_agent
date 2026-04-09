import { beforeEach, describe, expect, it } from "vitest";
import { useTaskStore } from "./taskStore";

describe("taskStore", () => {
  beforeEach(() => {
    useTaskStore.getState().clearTasks();
  });

  it("treats nested pending or in-progress subtasks as active session work", () => {
    useTaskStore.getState().addTask({
      id: "task-1",
      sessionId: "session-a",
      content: "Parent task",
      status: "completed",
      createdAt: "2026-04-01T10:00:00.000Z",
      subTasks: [
        {
          id: "subtask-1",
          content: "Still running",
          status: "in_progress",
        },
      ],
    });

    expect(useTaskStore.getState().hasActiveTasksBySession("session-a")).toBe(true);
  });

  it("preserves the original createdAt when upserting an existing task", () => {
    useTaskStore.getState().addTask({
      id: "task-1",
      sessionId: "session-a",
      content: "Original task",
      status: "pending",
      createdAt: "2026-04-01T10:00:00.000Z",
    });

    useTaskStore.getState().upsertTask({
      id: "task-1",
      sessionId: "session-a",
      content: "Updated task",
      status: "completed",
      createdAt: "2026-04-09T10:00:00.000Z",
    });

    expect(useTaskStore.getState().getTasksBySession("session-a")).toEqual([
      expect.objectContaining({
        id: "task-1",
        content: "Updated task",
        status: "completed",
        createdAt: "2026-04-01T10:00:00.000Z",
      }),
    ]);
  });

  it("clears session tasks and their visible task tab state together", () => {
    useTaskStore.getState().addTask({
      id: "task-a",
      sessionId: "session-a",
      content: "Clear me",
      status: "pending",
      createdAt: "2026-04-01T10:00:00.000Z",
    });
    useTaskStore.getState().addTask({
      id: "task-b",
      sessionId: "session-b",
      content: "Keep me",
      status: "pending",
      createdAt: "2026-04-01T10:05:00.000Z",
    });
    useTaskStore.getState().markTaskTabVisible("session-a");
    useTaskStore.getState().markTaskTabVisible("session-b");

    useTaskStore.getState().clearSessionTasks("session-a");

    expect(useTaskStore.getState().getTasksBySession("session-a")).toHaveLength(0);
    expect(useTaskStore.getState().isTaskTabVisible("session-a")).toBe(false);
    expect(useTaskStore.getState().getTasksBySession("session-b")).toHaveLength(1);
    expect(useTaskStore.getState().isTaskTabVisible("session-b")).toBe(true);
  });
});
