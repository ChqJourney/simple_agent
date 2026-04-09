import { useConfigStore } from "../stores/configStore";
import { useRunStore } from "../stores/runStore";
import { useSessionStore } from "../stores/sessionStore";
import { useTaskStore } from "../stores/taskStore";
import { useUIStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useChatStore } from "../stores/chatStore";
import type { LockedModelRef, Workspace } from "../types";

type SessionMetaFixture = {
  session_id: string;
  workspace_path: string;
  created_at: string;
  updated_at: string;
  title?: string;
  locked_model?: LockedModelRef;
};

type ChatSessionFixture = {
  messages: unknown[];
  latestUsage?: unknown;
  latestUsageUpdatedAt?: string;
  latestContextEstimate?: unknown;
  latestContextEstimateUpdatedAt?: string;
  currentStreamingContent: string;
  currentReasoningContent: string;
  isStreaming: boolean;
  assistantStatus: string;
  currentToolName?: string;
  currentToolArgumentCharacters?: number;
  pendingToolConfirm?: unknown;
  pendingQuestion?: unknown;
};

type RunSessionFixture = {
  events: unknown[];
  currentRunId?: string;
  status: "idle" | "running" | "completed" | "failed" | "interrupted";
};

const FRONTEND_TEST_UI_STATE = {
  leftPanelCollapsed: false,
  leftPanelWidth: 256,
  rightPanelCollapsed: false,
  rightPanelWidth: 288,
  rightPanelTab: "filetree" as const,
  theme: "system" as const,
  locale: "en-US" as const,
  baseFontSize: 16,
  isPageLoading: false,
};

export function resetFrontendTestState(): void {
  globalThis.localStorage?.clear?.();
  globalThis.sessionStorage?.clear?.();
  delete (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;

  useConfigStore.setState((state) => ({
    ...state,
    config: null,
  }));
  useWorkspaceStore.setState((state) => ({
    ...state,
    workspaces: [],
    currentWorkspace: null,
    changedFiles: {},
  }));
  useSessionStore.setState((state) => ({
    ...state,
    sessions: [],
    currentSessionId: null,
  }));
  useChatStore.setState({ sessions: {} });
  useRunStore.setState({ sessions: {} });
  useTaskStore.setState({
    tasks: [],
    visibleTaskTabSessionIds: {},
  });
  useUIStore.setState((state) => ({
    ...state,
    ...FRONTEND_TEST_UI_STATE,
  }));
}

export function createWorkspaceFixture(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace-1",
    name: "repo",
    path: "/workspace",
    lastOpened: "2026-03-12T10:00:00.000Z",
    createdAt: "2026-03-12T09:00:00.000Z",
    ...overrides,
  };
}

export function createSessionMetaFixture(overrides: Partial<SessionMetaFixture> = {}): SessionMetaFixture {
  return {
    session_id: "session-a",
    workspace_path: "/workspace",
    created_at: "2026-03-12T10:00:00.000Z",
    updated_at: "2026-03-12T10:00:00.000Z",
    ...overrides,
  };
}

export function createChatSessionFixture(overrides: Partial<ChatSessionFixture> = {}): ChatSessionFixture {
  return {
    messages: [],
    latestUsage: undefined,
    latestUsageUpdatedAt: undefined,
    latestContextEstimate: undefined,
    latestContextEstimateUpdatedAt: undefined,
    currentStreamingContent: "",
    currentReasoningContent: "",
    isStreaming: false,
    assistantStatus: "idle",
    currentToolName: undefined,
    currentToolArgumentCharacters: undefined,
    pendingToolConfirm: undefined,
    pendingQuestion: undefined,
    ...overrides,
  };
}

export function createRunSessionFixture(overrides: Partial<RunSessionFixture> = {}): RunSessionFixture {
  return {
    events: [],
    currentRunId: undefined,
    status: "idle",
    ...overrides,
  };
}
