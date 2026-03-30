import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "./TopBar";
import { useChatStore, useRunStore, useSessionStore, useUIStore, useWorkspaceStore } from "../../stores";

const navigateMock = vi.hoisted(() => vi.fn());
const tokenUsageWidgetMock = vi.hoisted(() => vi.fn<(props: unknown) => unknown>(() => <div>Tokens</div>));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("../common", () => ({
  WSStatusIndicator: () => <div>WS</div>,
  OCRStatusIndicator: () => <div>OCR</div>,
  ModelDisplay: () => <div>Model</div>,
  TokenUsageWidget: (props: unknown) => tokenUsageWidgetMock(props),
}));

describe("TopBar", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    tokenUsageWidgetMock.mockClear();
    useWorkspaceStore.setState((state) => ({
      ...state,
      currentWorkspace: {
        id: "workspace-1",
        name: "Repo",
        path: "/workspace",
        lastOpened: "2026-03-28T12:00:00.000Z",
        createdAt: "2026-03-28T11:00:00.000Z",
      },
    }));
    useSessionStore.setState((state) => ({
      ...state,
      currentSessionId: "session-a",
    }));
    useUIStore.setState((state) => ({
      ...state,
      leftPanelCollapsed: false,
      rightPanelCollapsed: false,
    }));
    useChatStore.setState({
      sessions: {},
    });
    useRunStore.setState({
      sessions: {},
    });
  });

  it("shows the latest compaction badge when a compaction event exists", () => {
    useRunStore.getState().addEvent("session-a", {
      event_type: "session_compaction_completed",
      session_id: "session-a",
      run_id: "run-1",
      payload: {
        strategy: "forced",
      },
      timestamp: "2026-03-28T13:00:00.000Z",
    });

    render(<TopBar />);

    expect(screen.getByText("Compacted")).toBeTruthy();
  });

  it("does not show a compaction badge when no compaction event exists", () => {
    useRunStore.getState().addEvent("session-a", {
      event_type: "run_started",
      session_id: "session-a",
      run_id: "run-1",
      payload: {},
      timestamp: "2026-03-28T13:00:00.000Z",
    });

    render(<TopBar />);

    expect(screen.queryByText("Compacted")).toBeNull();
    expect(screen.queryByText("Compacting")).toBeNull();
    expect(screen.queryByText("Compact failed")).toBeNull();
  });

  it("prefers a newer compaction estimate over the last request usage", () => {
    useChatStore.setState({
      sessions: {
        "session-a": {
          messages: [],
          latestUsage: {
            prompt_tokens: 32000,
            completion_tokens: 512,
            total_tokens: 32512,
            context_length: 128000,
          },
          latestUsageUpdatedAt: "2026-03-28T13:40:00.000Z",
          latestContextEstimate: {
            prompt_tokens: 22000,
            completion_tokens: 0,
            total_tokens: 22000,
            context_length: 128000,
          },
          latestContextEstimateUpdatedAt: "2026-03-28T13:42:30.000Z",
          currentStreamingContent: "",
          currentReasoningContent: "",
          isStreaming: false,
          assistantStatus: "idle",
          currentToolName: undefined,
          pendingToolConfirm: undefined,
          pendingQuestion: undefined,
        },
      },
    });

    render(<TopBar />);

    expect(tokenUsageWidgetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({
          prompt_tokens: 22000,
          context_length: 128000,
        }),
        mode: "context_estimate",
      })
    );
  });
});
