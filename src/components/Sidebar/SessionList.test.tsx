import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionList } from "./SessionList";
import { useSessionStore } from "../../stores/sessionStore";

vi.mock("../../hooks/useSession", () => ({
  useSession: () => ({
    createSession: vi.fn(),
    switchSession: vi.fn(),
    deleteSession: vi.fn(),
  }),
}));

describe("SessionList", () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          session_id: "session-a",
          workspace_path: "/workspace-a",
          created_at: "2026-03-12T10:00:00.000Z",
          updated_at: "2026-03-12T10:00:00.000Z",
          title: "Investigate runtime contracts",
        },
        {
          session_id: "session-c",
          workspace_path: "/workspace-a",
          created_at: "2026-03-12T09:00:00.000Z",
          updated_at: "2026-03-12T12:00:00.000Z",
          title: "Most recent workspace session",
        },
        {
          session_id: "session-b",
          workspace_path: "/workspace-b",
          created_at: "2026-03-12T11:00:00.000Z",
          updated_at: "2026-03-12T11:00:00.000Z",
          title: "Other workspace session",
        },
      ],
      currentSessionId: "session-a",
    }));
  });

  it("renders the session title when one is available", () => {
    render(<SessionList workspacePath="/workspace-a" />);

    expect(screen.getByText("Investigate runtime contracts")).toBeTruthy();
  });

  it("filters sessions by workspace and renders a dedicated scroll container", () => {
    render(<SessionList workspacePath="/workspace-a" />);

    expect(screen.queryByText("Other workspace session")).toBeNull();
    expect(screen.getByTestId("session-list-scroll")).toBeTruthy();
  });

  it("sorts workspace sessions by the most recent update first", () => {
    render(<SessionList workspacePath="/workspace-a" />);

    const listText = screen.getByTestId("session-list-scroll").textContent || "";
    expect(listText.indexOf("Most recent workspace session")).toBeGreaterThanOrEqual(0);
    expect(listText.indexOf("Investigate runtime contracts")).toBeGreaterThanOrEqual(0);
    expect(listText.indexOf("Most recent workspace session")).toBeLessThan(
      listText.indexOf("Investigate runtime contracts")
    );
  });
});
