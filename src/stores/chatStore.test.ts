import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./chatStore";

describe("chatStore run events", () => {
  beforeEach(() => {
    useChatStore.setState({ sessions: {} });
  });

  it("stores and clears pending questions per session", () => {
    useChatStore.getState().setPendingQuestion("session-a", {
      tool_call_id: "question-1",
      tool_name: "ask_question",
      question: "Continue deployment?",
      details: "Traffic is low right now.",
      options: ["continue", "wait"],
      status: "idle",
    });

    expect(useChatStore.getState().sessions["session-a"]?.pendingQuestion?.question).toBe(
      "Continue deployment?"
    );

    useChatStore.getState().clearPendingQuestion("session-a", "question-1");

    expect(useChatStore.getState().sessions["session-a"]?.pendingQuestion).toBeUndefined();
  });

  it("tracks pending question submission state", () => {
    useChatStore.getState().setPendingQuestion("session-a", {
      tool_call_id: "question-1",
      tool_name: "ask_question",
      question: "Continue deployment?",
      details: "Traffic is low right now.",
      options: ["continue", "wait"],
      status: "idle",
    });

    useChatStore.getState().markPendingQuestionSubmitting("session-a", "question-1");
    expect(useChatStore.getState().sessions["session-a"]?.pendingQuestion?.status).toBe("submitting");

    useChatStore.getState().markPendingQuestionIdle("session-a", "question-1");
    expect(useChatStore.getState().sessions["session-a"]?.pendingQuestion?.status).toBe("idle");
  });

  it("stores latest usage snapshots on completion", () => {
    useChatStore.getState().startStreaming("session-a");
    useChatStore.getState().addToken("session-a", "hello world");
    useChatStore.getState().setCompleted("session-a", {
      prompt_tokens: 4096,
      completion_tokens: 256,
      total_tokens: 4352,
      context_length: 128000,
    });

    expect(useChatStore.getState().sessions["session-a"]?.latestUsage).toEqual({
      prompt_tokens: 4096,
      completion_tokens: 256,
      total_tokens: 4352,
      context_length: 128000,
    });
  });

  it("derives latest usage snapshots when loading persisted messages", () => {
    useChatStore.getState().loadSession("session-a", [
      {
        id: "assistant-1",
        role: "assistant",
        content: "done",
        status: "completed",
        usage: {
          prompt_tokens: 2048,
          completion_tokens: 128,
          total_tokens: 2176,
          context_length: 64000,
        },
      },
    ]);

    expect(useChatStore.getState().sessions["session-a"]?.latestUsage?.prompt_tokens).toBe(2048);
    expect(useChatStore.getState().sessions["session-a"]?.latestUsage?.context_length).toBe(64000);
  });

  it("preserves partial reasoning and assistant output when interrupted", () => {
    useChatStore.setState({
      sessions: {
        "session-a": {
          messages: [],
          latestUsage: undefined,
          currentStreamingContent: "half answer",
          currentReasoningContent: "half reasoning",
          isStreaming: true,
          assistantStatus: "streaming",
          currentToolName: undefined,
          pendingToolConfirm: undefined,
          pendingQuestion: undefined,
        },
      },
    });

    useChatStore.getState().setInterrupted("session-a");

    expect(useChatStore.getState().sessions["session-a"]?.messages).toEqual([
      {
        id: expect.any(String),
        role: "reasoning",
        content: "half reasoning",
        status: "completed",
      },
      {
        id: expect.any(String),
        role: "assistant",
        content: "half answer",
        status: "completed",
      },
    ]);
    expect(useChatStore.getState().sessions["session-a"]?.isStreaming).toBe(false);
    expect(useChatStore.getState().sessions["session-a"]?.currentStreamingContent).toBe("");
    expect(useChatStore.getState().sessions["session-a"]?.currentReasoningContent).toBe("");
  });

  it("marks in-flight tool call messages completed when interrupted", () => {
    useChatStore.setState({
      sessions: {
        "session-a": {
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              content: "calling tool",
              tool_calls: [
                {
                  tool_call_id: "tool-1",
                  name: "file_write",
                  arguments: {},
                },
              ],
              status: "streaming",
            },
          ],
          latestUsage: undefined,
          currentStreamingContent: "",
          currentReasoningContent: "",
          isStreaming: true,
          assistantStatus: "tool_calling",
          currentToolName: "file_write",
          pendingToolConfirm: {
            tool_call_id: "tool-1",
            name: "file_write",
            arguments: {},
          },
          pendingQuestion: undefined,
        },
      },
    });

    useChatStore.getState().setInterrupted("session-a");

    expect(useChatStore.getState().sessions["session-a"]?.messages[0]).toMatchObject({
      id: "assistant-1",
      status: "completed",
    });
    expect(useChatStore.getState().sessions["session-a"]?.pendingToolConfirm).toBeUndefined();
    expect(useChatStore.getState().sessions["session-a"]?.assistantStatus).toBe("idle");
  });
});
