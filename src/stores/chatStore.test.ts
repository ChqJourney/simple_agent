import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./chatStore";

describe("chatStore run events", () => {
  beforeEach(() => {
    useChatStore.setState({ sessions: {} });
  });

  it("stores structured run events per session", () => {
    useChatStore.getState().addRunEvent("session-a", {
      event_type: "run_started",
      session_id: "session-a",
      run_id: "run-1",
      payload: {
        source: "test",
      },
      timestamp: "2026-03-13T09:00:00.000Z",
    });

    expect(useChatStore.getState().sessions["session-a"]?.runEvents).toHaveLength(1);
    expect(useChatStore.getState().sessions["session-a"]?.runEvents[0]?.event_type).toBe("run_started");
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
});
