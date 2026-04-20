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

  it("queues multiple pending questions and promotes the next one when the current question is cleared", () => {
    useChatStore.getState().setPendingQuestion("session-a", {
      tool_call_id: "question-1",
      tool_name: "ask_question",
      question: "Continue deployment?",
      details: "Traffic is low right now.",
      options: ["continue", "wait"],
      status: "idle",
    });
    useChatStore.getState().setPendingQuestion("session-a", {
      tool_call_id: "question-2",
      tool_name: "ask_question",
      question: "Which environment?",
      details: "We need the target before running the deploy.",
      options: ["staging", "production"],
      status: "idle",
    });

    expect(useChatStore.getState().sessions["session-a"]?.pendingQuestion?.tool_call_id).toBe("question-1");
    expect(useChatStore.getState().sessions["session-a"]?.queuedQuestions).toEqual([
      {
        tool_call_id: "question-2",
        tool_name: "ask_question",
        question: "Which environment?",
        details: "We need the target before running the deploy.",
        options: ["staging", "production"],
        status: "idle",
      },
    ]);

    useChatStore.getState().clearPendingQuestion("session-a", "question-1");

    expect(useChatStore.getState().sessions["session-a"]?.pendingQuestion?.tool_call_id).toBe("question-2");
    expect(useChatStore.getState().sessions["session-a"]?.queuedQuestions).toEqual([]);
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
    expect(useChatStore.getState().sessions["session-a"]?.latestUsageUpdatedAt).toEqual(expect.any(String));
  });

  it("keeps partial streamed output visible while a retry is pending", () => {
    useChatStore.getState().startStreaming("session-a");
    useChatStore.getState().addToken("session-a", "partial answer");

    useChatStore.getState().markStreamWaiting("session-a");

    expect(useChatStore.getState().sessions["session-a"]?.assistantStatus).toBe("waiting");
    expect(useChatStore.getState().sessions["session-a"]?.isStreaming).toBe(true);
    expect(useChatStore.getState().sessions["session-a"]?.currentStreamingContent).toBe("partial answer");
  });

  it("tracks tool preparation progress and clears it once the tool call is ready", () => {
    useChatStore.getState().startStreaming("session-a");
    useChatStore.getState().setToolCallProgress("session-a", "file_write", 4096);

    expect(useChatStore.getState().sessions["session-a"]?.assistantStatus).toBe("preparing_tool");
    expect(useChatStore.getState().sessions["session-a"]?.currentToolName).toBe("file_write");
    expect(useChatStore.getState().sessions["session-a"]?.currentToolArgumentCharacters).toBe(4096);

    useChatStore.getState().setToolCall("session-a", {
      tool_call_id: "tool-1",
      name: "file_write",
      arguments: { path: "notes.txt" },
    });

    expect(useChatStore.getState().sessions["session-a"]?.assistantStatus).toBe("tool_calling");
    expect(useChatStore.getState().sessions["session-a"]?.currentToolArgumentCharacters).toBeUndefined();
  });

  it("queues multiple pending tool approvals and promotes the next one when the current tool is cleared", () => {
    useChatStore.getState().setPendingToolConfirm("session-a", {
      tool_call_id: "tool-1",
      name: "file_write",
      arguments: { path: "one.txt" },
    });
    useChatStore.getState().setPendingToolConfirm("session-a", {
      tool_call_id: "tool-2",
      name: "file_write",
      arguments: { path: "two.txt" },
    });

    expect(useChatStore.getState().sessions["session-a"]?.pendingToolConfirm?.tool_call_id).toBe("tool-1");
    expect(useChatStore.getState().sessions["session-a"]?.queuedToolConfirms).toEqual([
      {
        tool_call_id: "tool-2",
        name: "file_write",
        arguments: { path: "two.txt" },
      },
    ]);

    useChatStore.getState().clearPendingToolConfirm("session-a", "tool-1");

    expect(useChatStore.getState().sessions["session-a"]?.pendingToolConfirm?.tool_call_id).toBe("tool-2");
    expect(useChatStore.getState().sessions["session-a"]?.queuedToolConfirms).toEqual([]);
  });

  it("stores context estimates independently from the latest request usage", () => {
    useChatStore.getState().startStreaming("session-a");
    useChatStore.getState().setCompleted("session-a", {
      prompt_tokens: 4096,
      completion_tokens: 256,
      total_tokens: 4352,
      context_length: 128000,
    });

    useChatStore.getState().setContextEstimate(
      "session-a",
      {
        prompt_tokens: 22000,
        completion_tokens: 0,
        total_tokens: 22000,
        context_length: 128000,
      },
      "2026-03-28T13:45:00.000Z"
    );

    expect(useChatStore.getState().sessions["session-a"]?.latestUsage?.prompt_tokens).toBe(4096);
    expect(useChatStore.getState().sessions["session-a"]?.latestContextEstimate?.prompt_tokens).toBe(22000);
    expect(useChatStore.getState().sessions["session-a"]?.latestContextEstimateUpdatedAt).toBe(
      "2026-03-28T13:45:00.000Z"
    );
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
          queuedToolConfirms: [],
          pendingQuestion: undefined,
          queuedQuestions: [],
        },
      },
    });

    useChatStore.getState().setInterrupted("session-a");

    expect(useChatStore.getState().sessions["session-a"]?.messages).toEqual([
      {
        id: expect.any(String),
        role: "reasoning",
        content: "half reasoning",
        timestamp: expect.any(String),
        status: "completed",
      },
      {
        id: expect.any(String),
        role: "assistant",
        content: "half answer",
        timestamp: expect.any(String),
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
          queuedToolConfirms: [
            {
              tool_call_id: "tool-2",
              name: "file_write",
              arguments: {},
            },
          ],
          pendingQuestion: undefined,
          queuedQuestions: [],
        },
      },
    });

    useChatStore.getState().setInterrupted("session-a");

    expect(useChatStore.getState().sessions["session-a"]?.messages[0]).toMatchObject({
      id: "assistant-1",
      status: "completed",
    });
    expect(useChatStore.getState().sessions["session-a"]?.pendingToolConfirm).toBeUndefined();
    expect(useChatStore.getState().sessions["session-a"]?.queuedToolConfirms).toEqual([]);
    expect(useChatStore.getState().sessions["session-a"]?.assistantStatus).toBe("idle");
  });
});
