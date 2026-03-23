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
});
