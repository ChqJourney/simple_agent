import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useRunStore } from "../../stores/runStore";
import { RunTimeline } from "./RunTimeline";

describe("RunTimeline", () => {
  beforeEach(() => {
    useRunStore.setState({ sessions: {} });
  });

  it("renders an empty state when no session is selected", () => {
    render(<RunTimeline sessionId={null} />);

    expect(screen.getByText("No session selected")).toBeTruthy();
  });

  it("renders an empty state when the session has no run events", () => {
    render(<RunTimeline sessionId="missing-session" />);

    expect(screen.getByText("No runs yet")).toBeTruthy();
  });

  it("renders the latest status and recent events without a disclosure toggle", () => {
    useRunStore.getState().addEvent("session-a", {
      event_type: "run_started",
      session_id: "session-a",
      run_id: "run-1",
      payload: {},
      timestamp: "2026-03-13T09:00:00.000Z",
    });
    useRunStore.getState().addEvent("session-a", {
      event_type: "tool_call_requested",
      session_id: "session-a",
      run_id: "run-1",
      payload: {
        tool_name: "file_read",
      },
      timestamp: "2026-03-13T09:00:01.000Z",
    });
    useRunStore.getState().addEvent("session-a", {
      event_type: "run_completed",
      session_id: "session-a",
      run_id: "run-1",
      payload: {},
      timestamp: "2026-03-13T09:00:02.000Z",
    });

    render(<RunTimeline sessionId="session-a" />);

    expect(screen.getByText("Run Timeline")).toBeTruthy();
    expect(screen.getAllByText("Run completed").length).toBeGreaterThan(0);
    expect(screen.getByText("Tool requested")).toBeTruthy();
    expect(screen.getByText("file_read")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Expand run timeline" })).toBeNull();
  });

  it("renders readable skill context events", () => {
    useRunStore.getState().addEvent("session-a", {
      event_type: "skill_catalog_prepared",
      session_id: "session-a",
      run_id: "run-1",
      payload: {
        skill_names: ["deploy-checks"],
      },
      timestamp: "2026-03-13T09:00:00.000Z",
    });

    render(<RunTimeline sessionId="session-a" />);

    expect(screen.getByText("Skills indexed")).toBeTruthy();
    expect(screen.getByText("deploy-checks")).toBeTruthy();
  });

  it("renders skill load events with the loaded skill name", () => {
    useRunStore.getState().addEvent("session-a", {
      event_type: "skill_loaded",
      session_id: "session-a",
      run_id: "run-1",
      payload: {
        skill_name: "deploy-checks",
      },
      timestamp: "2026-03-13T09:00:00.000Z",
    });

    render(<RunTimeline sessionId="session-a" />);

    expect(screen.getByText("Skill loaded")).toBeTruthy();
    expect(screen.getByText("deploy-checks")).toBeTruthy();
  });

  it("renders readable compaction events with strategy details", () => {
    useRunStore.getState().addEvent("session-a", {
      event_type: "session_compaction_completed",
      session_id: "session-a",
      run_id: "run-1",
      payload: {
        strategy: "background",
        post_tokens_estimate: 420,
      },
      timestamp: "2026-03-13T09:00:00.000Z",
    });

    render(<RunTimeline sessionId="session-a" />);

    expect(screen.getAllByText("Compaction completed").length).toBeGreaterThan(0);
    expect(screen.getByText("background - 420 tokens")).toBeTruthy();
  });

  it("renders delegated task events with task and worker details", () => {
    useRunStore.getState().addEvent("session-a", {
      event_type: "delegated_task_started",
      session_id: "session-a",
      run_id: "run-1",
      payload: {
        task: "Summarize unresolved risks",
      },
      timestamp: "2026-03-13T09:00:00.000Z",
    });
    useRunStore.getState().addEvent("session-a", {
      event_type: "delegated_task_completed",
      session_id: "session-a",
      run_id: "run-1",
      payload: {
        worker_provider: "openai",
        worker_model: "gpt-4o-mini",
      },
      timestamp: "2026-03-13T09:00:01.000Z",
    });

    render(<RunTimeline sessionId="session-a" />);

    expect(screen.getAllByText("Delegated task completed").length).toBeGreaterThan(0);
    expect(screen.getByText("Summarize unresolved risks")).toBeTruthy();
    expect(screen.getByText("openai/gpt-4o-mini")).toBeTruthy();
  });

  it("renders retry events with attempt and stall reason details", () => {
    useRunStore.getState().addEvent("session-a", {
      event_type: "run_started",
      session_id: "session-a",
      run_id: "run-1",
      payload: {},
      timestamp: "2026-03-13T09:00:00.000Z",
    });
    useRunStore.getState().addEvent("session-a", {
      event_type: "retry_scheduled",
      session_id: "session-a",
      run_id: "run-1",
      payload: {
        attempt: 2,
        details: "LLM stream stalled before completion.",
      },
      timestamp: "2026-03-13T09:00:01.000Z",
    });

    render(<RunTimeline sessionId="session-a" />);

    expect(screen.getAllByText("Retry scheduled").length).toBeGreaterThan(0);
    expect(screen.getByText("attempt 2 - LLM stream stalled before completion.")).toBeTruthy();
  });
});
