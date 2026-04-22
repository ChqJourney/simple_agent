import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RightPanel } from "./RightPanel";
import { useSessionStore, useTaskStore, useUIStore } from "../../stores";
import { useChatStore } from "../../stores/chatStore";
import { createChatSessionFixture, createSessionMetaFixture, resetFrontendTestState } from "../../test/frontendTestState";

vi.mock("./FileTree", () => ({
  FileTree: () => <div>FileTree Content</div>,
}));

vi.mock("./TaskList", () => ({
  TaskList: () => <div>TaskList Content</div>,
}));

vi.mock("../Checklist", () => ({
  ChecklistResultPanel: () => <div>Checklist Content</div>,
}));

vi.mock("../Report", () => ({
  StandardQaReportPanel: () => <div>Report Content</div>,
}));

describe("RightPanel", () => {
  beforeEach(() => {
    resetFrontendTestState();
    useUIStore.setState((state) => ({
      ...state,
      rightPanelTab: "filetree",
      rightPanelCollapsed: false,
      rightPanelWidth: 288,
    }));
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [createSessionMetaFixture()],
      currentSessionId: "session-a",
    }));
    useChatStore.setState({
      sessions: {
        "session-a": createChatSessionFixture(),
      },
    });
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

  it("shows the checklist tab for checklist sessions with parseable results", () => {
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        createSessionMetaFixture({
          scenario_id: "checklist_evaluation",
          scenario_version: 1,
          scenario_label: "Checklist Evaluation",
        }),
      ],
    }));
    useChatStore.setState({
      sessions: {
        "session-a": createChatSessionFixture({
          messages: [
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
          ],
        }),
      },
    });

    render(<RightPanel />);

    expect(screen.getByRole("button", { name: "Checklist" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Checklist" }));

    expect(screen.getByText("Checklist Content")).toBeTruthy();
  });

  it("shows and auto-focuses the report tab for standard QA sessions", async () => {
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        createSessionMetaFixture({
          scenario_id: "standard_qa",
          scenario_version: 1,
          scenario_label: "Standard QA",
        }),
      ],
    }));

    render(<RightPanel />);

    expect(screen.getByRole("button", { name: "Report" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("Report Content")).toBeTruthy();
      expect(useUIStore.getState().rightPanelTab).toBe("report");
    });
  });

  it("falls back to file tree when the checklist tab is no longer available", async () => {
    useUIStore.setState((state) => ({
      ...state,
      rightPanelTab: "checklist",
    }));
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        createSessionMetaFixture({
          scenario_id: "checklist_evaluation",
          scenario_version: 1,
          scenario_label: "Checklist Evaluation",
        }),
      ],
    }));
    useChatStore.setState({
      sessions: {
        "session-a": createChatSessionFixture({
          messages: [
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
          ],
        }),
      },
    });

    render(<RightPanel />);

    expect(screen.getByText("Checklist Content")).toBeTruthy();

    act(() => {
      useChatStore.setState({
        sessions: {
          "session-a": createChatSessionFixture({
            messages: [],
          }),
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Checklist" })).toBeNull();
      expect(screen.getByText("FileTree Content")).toBeTruthy();
      expect(useUIStore.getState().rightPanelTab).toBe("filetree");
    });
  });
});
