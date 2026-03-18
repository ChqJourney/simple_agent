import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatContainer } from "./ChatContainer";
import { useChatStore } from "../../stores/chatStore";
import { useConfigStore } from "../../stores/configStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

const sendMessageMock = vi.hoisted(() => vi.fn());
const answerQuestionMock = vi.hoisted(() => vi.fn());
const confirmToolMock = vi.hoisted(() => vi.fn());
const interruptMock = vi.hoisted(() => vi.fn());
const setExecutionModeMock = vi.hoisted(() => vi.fn());
const createSessionMock = vi.hoisted(() => vi.fn(() => "session-a"));

vi.mock("../../contexts/WebSocketContext", () => ({
  useWebSocket: () => ({
    sendMessage: sendMessageMock,
    answerQuestion: answerQuestionMock,
    isConnected: true,
    confirmTool: confirmToolMock,
    interrupt: interruptMock,
    setExecutionMode: setExecutionModeMock,
  }),
}));

vi.mock("../../hooks/useSession", () => ({
  useSession: () => ({
    currentSessionId: "session-a",
    createSession: createSessionMock,
  }),
}));

vi.mock("./MessageList", () => ({
  MessageList: () => <div>MessageList</div>,
}));

vi.mock("./MessageInput", () => ({
  MessageInput: () => <div>MessageInput</div>,
}));

vi.mock("../Run", () => ({
  RunTimeline: () => <div>RunTimeline</div>,
}));

vi.mock("../Tools", async () => {
  const actual = await vi.importActual<typeof import("../Tools")>("../Tools");
  return {
    ...actual,
    ToolConfirmModal: () => null,
  };
});

describe("ChatContainer", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    answerQuestionMock.mockReset();
    answerQuestionMock.mockReturnValue(true);
    confirmToolMock.mockReset();
    interruptMock.mockReset();
    setExecutionModeMock.mockReset();
    createSessionMock.mockClear();
    useConfigStore.setState({ config: null as never });
    useWorkspaceStore.setState((state) => ({
      ...state,
      currentWorkspace: {
        id: "workspace-1",
        name: "repo",
        path: "C:/Users/patri/source/repos/tauri_agent",
        lastOpened: "2026-03-13T10:00:00.000Z",
        createdAt: "2026-03-13T09:00:00.000Z",
      },
    }));
    useChatStore.setState({
      sessions: {
        "session-a": {
          messages: [],
          runEvents: [],
          currentStreamingContent: "",
          currentReasoningContent: "",
          isStreaming: false,
          assistantStatus: "idle",
          currentToolName: undefined,
          pendingToolConfirm: undefined,
          pendingQuestion: {
            tool_call_id: "question-1",
            tool_name: "ask_question",
            question: "Continue deployment?",
            details: "Traffic is low right now.",
            options: ["continue", "wait"],
            status: "idle",
          },
        },
      },
    });
  });

  it("keeps pending questions visible until the backend confirms the answer", () => {
    render(<ChatContainer />);

    expect(screen.getByText("Continue deployment?")).toBeTruthy();
    expect(screen.getByText("Traffic is low right now.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "continue" }));

    expect(answerQuestionMock).toHaveBeenCalledWith(
      "question-1",
      "continue",
      "submit",
    );
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(screen.getByText("Continue deployment?")).toBeTruthy();
    expect((screen.getByRole("button", { name: "continue" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "wait" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Dismiss" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("restores the pending question when structured answer sending fails", () => {
    answerQuestionMock.mockReturnValue(false);

    render(<ChatContainer />);

    fireEvent.click(screen.getByRole("button", { name: "continue" }));

    expect(answerQuestionMock).toHaveBeenCalledWith(
      "question-1",
      "continue",
      "submit",
    );
    expect((screen.getByRole("button", { name: "continue" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Dismiss" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
