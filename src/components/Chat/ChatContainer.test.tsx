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
const messageInputPropsMock = vi.hoisted(() => vi.fn());
const messageListPropsMock = vi.hoisted(() => vi.fn());

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
  MessageList: (props: { onRetryMessage?: (message: { content: string | null; attachments?: Array<{ kind: "image"; path: string; name: string }> }) => void }) => {
    messageListPropsMock(props);
    return (
      <div>
        MessageList
        {props.onRetryMessage && (
          <button
            type="button"
            aria-label="retry message"
            onClick={() => props.onRetryMessage?.({
              content: "Retry this request",
              attachments: [
                {
                  kind: "image",
                  path: "/tmp/retry.png",
                  name: "retry.png",
                },
              ],
            })}
          >
            retry message
          </button>
        )}
      </div>
    );
  },
}));

vi.mock("./MessageInput", () => ({
  MessageInput: (props: { disabled?: boolean; placeholder?: string; supportsImageAttachments?: boolean }) => {
    messageInputPropsMock(props);
    return <div>{props.disabled ? "MessageInput disabled" : "MessageInput enabled"}</div>;
  },
}));

vi.mock("../Run", () => ({
  RunTimeline: () => <div>RunTimeline</div>,
}));

vi.mock("../Tools", async () => {
  const actual = await vi.importActual<typeof import("../Tools")>("../Tools");
  return {
    ...actual,
    ToolConfirmModal: ({ onDecision }: { onDecision: (decision: "approve_once" | "approve_always" | "reject") => void }) => (
      <button type="button" onClick={() => onDecision("approve_once")} aria-label="approve tool">
        approve tool
      </button>
    ),
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
    messageInputPropsMock.mockReset();
    messageListPropsMock.mockReset();
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
      "session-a",
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
      "session-a",
      "question-1",
      "continue",
      "submit",
    );
    expect((screen.getByRole("button", { name: "continue" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Dismiss" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits a free-text answer when the question has no preset options", () => {
    useChatStore.setState({
      sessions: {
        "session-a": {
          messages: [],
          currentStreamingContent: "",
          currentReasoningContent: "",
          isStreaming: false,
          assistantStatus: "idle",
          currentToolName: undefined,
          pendingToolConfirm: undefined,
          pendingQuestion: {
            tool_call_id: "question-2",
            tool_name: "ask_question",
            question: "Which branch should I compare against?",
            details: "I couldn't infer the release target from the repo state.",
            options: [],
            status: "idle",
          },
        },
      },
    });

    render(<ChatContainer />);

    fireEvent.change(screen.getByPlaceholderText("Type your answer"), {
      target: { value: "release/2026.03" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(answerQuestionMock).toHaveBeenCalledWith(
      "session-a",
      "question-2",
      "release/2026.03",
      "submit",
    );
  });

  it("keeps tool approval visible when confirmation sending fails", () => {
    confirmToolMock.mockReturnValue(false);
    useChatStore.setState({
      sessions: {
        "session-a": {
          messages: [],
          currentStreamingContent: "",
          currentReasoningContent: "",
          isStreaming: false,
          assistantStatus: "tool_calling",
          currentToolName: "file_write",
          pendingToolConfirm: {
            tool_call_id: "tool-1",
            name: "file_write",
            arguments: { path: "README.md" },
          },
          pendingQuestion: undefined,
        },
      },
    });

    render(<ChatContainer />);

    expect(screen.getByRole("button", { name: "approve tool" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "approve tool" }));

    expect(confirmToolMock).toHaveBeenCalledWith("session-a", "tool-1", "approve_once", "session");
    expect(screen.getByRole("button", { name: "approve tool" })).toBeTruthy();
  });

  it("does not render the run timeline inline above the chat anymore", () => {
    render(<ChatContainer />);

    expect(screen.queryByText("RunTimeline")).toBeNull();
    expect(screen.getByText("MessageList")).toBeTruthy();
    expect(screen.getByText("MessageInput disabled")).toBeTruthy();
  });

  it("disables the composer when no runnable model config is available", () => {
    render(<ChatContainer />);

    expect(messageInputPropsMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        disabled: true,
        placeholder: "Configure a primary model before sending messages...",
      })
    );
  });

  it("enables the composer when a primary model is configured", () => {
    useConfigStore.setState({
      config: {
        provider: "openai",
        model: "gpt-4o-mini",
        api_key: "test-key",
        base_url: "https://api.openai.com/v1",
        enable_reasoning: false,
        profiles: {
          primary: {
            provider: "openai",
            model: "gpt-4o-mini",
            api_key: "test-key",
            base_url: "https://api.openai.com/v1",
            enable_reasoning: false,
            profile_name: "primary",
          },
        },
      } as never,
    });

    render(<ChatContainer />);

    expect(messageInputPropsMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        disabled: false,
        placeholder: "Type your message...",
      })
    );
  });

  it("keeps image attachments enabled for supported models even before an API key is added", () => {
    useConfigStore.setState({
      config: {
        provider: "openai",
        model: "gpt-4o",
        api_key: "",
        base_url: "https://api.openai.com/v1",
        enable_reasoning: false,
        profiles: {
          primary: {
            provider: "openai",
            model: "gpt-4o",
            api_key: "",
            base_url: "https://api.openai.com/v1",
            enable_reasoning: false,
            profile_name: "primary",
          },
        },
      } as never,
    });

    render(<ChatContainer />);

    expect(messageInputPropsMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        disabled: true,
        placeholder: "Add an API key before sending messages...",
        supportsImageAttachments: true,
      })
    );
  });

  it("re-sends a failed user message through the existing send flow", () => {
    useConfigStore.setState({
      config: {
        provider: "openai",
        model: "gpt-4o-mini",
        api_key: "test-key",
        base_url: "https://api.openai.com/v1",
        enable_reasoning: false,
        profiles: {
          primary: {
            provider: "openai",
            model: "gpt-4o-mini",
            api_key: "test-key",
            base_url: "https://api.openai.com/v1",
            enable_reasoning: false,
            profile_name: "primary",
          },
        },
      } as never,
    });

    render(<ChatContainer />);

    fireEvent.click(screen.getByRole("button", { name: "retry message" }));

    expect(sendMessageMock).toHaveBeenCalledWith(
      "session-a",
      "Retry this request",
      [
        {
          kind: "image",
          path: "/tmp/retry.png",
          name: "retry.png",
        },
      ],
      "C:/Users/patri/source/repos/tauri_agent",
    );
    const sessionMessages = useChatStore.getState().sessions["session-a"]?.messages;

    expect(sessionMessages?.[sessionMessages.length - 1]).toEqual(
      expect.objectContaining({
        role: "user",
        content: "Retry this request",
      })
    );
  });
});
