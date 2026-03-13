import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useRunStore } from "../../stores/runStore";
import { RunTimeline } from "./RunTimeline";

describe("RunTimeline", () => {
  beforeEach(() => {
    useRunStore.setState({ sessions: {} });
  });

  it("renders nothing for sessions with no run state without causing selector churn", () => {
    const { container } = render(<RunTimeline sessionId="missing-session" />);

    expect(container.firstChild).toBeNull();
  });

  it("renders human-readable timeline rows for run events", () => {
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

    expect(screen.getByText("Run started")).toBeTruthy();
    expect(screen.getByText("Tool requested")).toBeTruthy();
    expect(screen.getByText("file_read")).toBeTruthy();
    expect(screen.getByText("Run completed")).toBeTruthy();
  });

  it("renders readable skill and retrieval context events", () => {
    useRunStore.getState().addEvent("session-a", {
      event_type: "skill_resolution_completed",
      session_id: "session-a",
      run_id: "run-1",
      payload: {
        skill_names: ["deploy-checks"],
      },
      timestamp: "2026-03-13T09:00:00.000Z",
    });
    useRunStore.getState().addEvent("session-a", {
      event_type: "retrieval_completed",
      session_id: "session-a",
      run_id: "run-1",
      payload: {
        hit_count: 2,
      },
      timestamp: "2026-03-13T09:00:01.000Z",
    });

    render(<RunTimeline sessionId="session-a" />);

    expect(screen.getByText("Skill resolved")).toBeTruthy();
    expect(screen.getByText("deploy-checks")).toBeTruthy();
    expect(screen.getByText("Retrieval completed")).toBeTruthy();
    expect(screen.getByText("2 hits")).toBeTruthy();
  });
});
