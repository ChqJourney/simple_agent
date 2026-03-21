import { beforeEach, describe, expect, it } from "vitest";
import { useRunStore } from "./runStore";

describe("runStore", () => {
  beforeEach(() => {
    useRunStore.setState({ sessions: {} });
  });

  it("tracks lifecycle status from run events", () => {
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
      payload: { attempt: 1 },
      timestamp: "2026-03-13T09:00:01.000Z",
    });
    useRunStore.getState().addEvent("session-a", {
      event_type: "run_completed",
      session_id: "session-a",
      run_id: "run-1",
      payload: {},
      timestamp: "2026-03-13T09:00:02.000Z",
    });

    const session = useRunStore.getState().sessions["session-a"];
    expect(session?.status).toBe("completed");
    expect(session?.currentRunId).toBe("run-1");
    expect(session?.events).toHaveLength(3);
  });

  it("keeps only the most recent run events per session", () => {
    for (let index = 0; index < 120; index += 1) {
      useRunStore.getState().addEvent("session-a", {
        event_type: `event-${index}`,
        session_id: "session-a",
        run_id: "run-1",
        payload: { index },
        timestamp: `2026-03-13T09:00:${String(index % 60).padStart(2, "0")}.000Z`,
      });
    }

    const session = useRunStore.getState().sessions["session-a"];
    expect(session?.events).toHaveLength(100);
    expect(session?.events[0]?.event_type).toBe("event-20");
    expect(session?.events[99]?.event_type).toBe("event-119");
  });
});
