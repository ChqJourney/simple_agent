import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "../types";
import { useChatStore } from "../stores/chatStore";
import { useRunStore } from "../stores/runStore";
import { useConfigStore } from "../stores/configStore";
import { useSessionStore } from "../stores/sessionStore";
import { useTaskStore } from "../stores/taskStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { resetBackendAuthTokenCache } from "../utils/backendAuth";
import { WebSocketProvider, useWebSocket } from "./WebSocketContext";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

const websocketMockState = vi.hoisted(() => {
  const statusListeners = new Set<(status: ConnectionStatus) => void>();

  return {
    statusListeners,
    connectionStatus: "connecting" as ConnectionStatus,
    sendSucceeded: false,
    messageHandler: undefined as ((message: any) => void) | undefined,
    onConnected: undefined as (() => void) | undefined,
    onDisconnected: undefined as (() => void) | undefined,
    connectMock: vi.fn((connected?: () => void, disconnected?: () => void) => {
      websocketMockState.onConnected = connected;
      websocketMockState.onDisconnected = disconnected;

      return () => {
        websocketMockState.onConnected = undefined;
        websocketMockState.onDisconnected = undefined;
      };
    }),
    sendMock: vi.fn(() => websocketMockState.sendSucceeded),
    onMessageMock: vi.fn((handler: (message: any) => void) => {
      websocketMockState.messageHandler = handler;
    }),
    offMessageMock: vi.fn(),
    isConnectedMock: vi.fn(() => websocketMockState.connectionStatus === "connected"),
    getConnectionStatusMock: vi.fn(() => websocketMockState.connectionStatus),
    onStatusChangeMock: vi.fn((listener: (status: ConnectionStatus) => void) => {
      websocketMockState.statusListeners.add(listener);
      return () => websocketMockState.statusListeners.delete(listener);
    }),
  };
});

vi.mock("../services/websocket", () => ({
  wsService: {
    connect: websocketMockState.connectMock,
    send: websocketMockState.sendMock,
    onMessage: websocketMockState.onMessageMock,
    offMessage: websocketMockState.offMessageMock,
    isConnected: websocketMockState.isConnectedMock,
    getConnectionStatus: websocketMockState.getConnectionStatusMock,
    onStatusChange: websocketMockState.onStatusChangeMock,
  },
}));

function emitStatus(nextStatus: ConnectionStatus) {
  websocketMockState.connectionStatus = nextStatus;
  websocketMockState.statusListeners.forEach((listener) => listener(nextStatus));
}

function Probe() {
  const context = useWebSocket() as ReturnType<typeof useWebSocket> & {
    connectionStatus?: ConnectionStatus;
    setExecutionMode?: (sessionId: string, mode: "regular" | "free") => void;
    sendMessage?: (sessionId: string, content: string, attachments?: unknown[], workspacePath?: string) => void;
    sendWorkspace?: (workspacePath: string) => void;
  };

  return (
    <>
      <button type="button" onClick={() => context.sendConfig()} aria-label="sync config">
        sync
      </button>
      <button
        type="button"
        onClick={() => context.answerQuestion("question-1", "continue")}
        aria-label="answer question"
      >
        answer
      </button>
      <button
        type="button"
        onClick={() => context.setExecutionMode?.("session-a", "free")}
        aria-label="set execution mode"
      >
        mode
      </button>
      <button
        type="button"
        onClick={() => context.sendMessage?.("session-a", "hello", undefined, "/workspace-a")}
        aria-label="send workspace message"
      >
        send
      </button>
      <button
        type="button"
        onClick={() => context.sendWorkspace?.("/workspace-b")}
        aria-label="bind workspace b"
      >
        bind-b
      </button>
      <div data-testid="status">{context.connectionStatus ?? ""}</div>
    </>
  );
}

const testConfig: ProviderConfig = {
  provider: "openai",
  model: "gpt-4o",
  api_key: "test-key",
  base_url: "https://api.openai.com/v1",
  enable_reasoning: false,
  input_type: "text",
};

describe("WebSocketProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetBackendAuthTokenCache();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    globalThis.localStorage?.clear?.();
    websocketMockState.statusListeners.clear();
    websocketMockState.connectionStatus = "connecting";
    websocketMockState.sendSucceeded = false;
    websocketMockState.messageHandler = undefined;
    websocketMockState.onConnected = undefined;
    websocketMockState.onDisconnected = undefined;
    websocketMockState.connectMock.mockClear();
    websocketMockState.sendMock.mockClear();
    websocketMockState.onMessageMock.mockClear();
    websocketMockState.offMessageMock.mockClear();
    websocketMockState.isConnectedMock.mockClear();
    websocketMockState.getConnectionStatusMock.mockClear();
    websocketMockState.onStatusChangeMock.mockClear();
    resetBackendAuthTokenCache();
    useConfigStore.setState((state) => ({
      ...state,
      config: testConfig,
    }));
    useTaskStore.setState({ tasks: [] });
    useWorkspaceStore.setState((state) => ({
      ...state,
      changedFiles: {},
    }));
    useSessionStore.setState((state) => ({
      ...state,
      sessions: [],
      currentSessionId: null,
    }));
    useChatStore.setState({ sessions: {} });
    globalThis.fetch = vi.fn();
  });

  it("exposes websocket connection status transitions", async () => {
    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    expect(screen.getByTestId("status").textContent).toBe("connecting");

    emitStatus("connected");
    websocketMockState.onConnected?.();

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });

    emitStatus("disconnected");
    websocketMockState.onDisconnected?.();

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("disconnected");
    });
  });

  it("re-sends config after reconnect when the offline save did not actually send", async () => {
    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "sync config" }));

    expect(websocketMockState.sendMock).toHaveBeenCalledTimes(1);

    websocketMockState.sendSucceeded = true;
    emitStatus("connected");
    websocketMockState.onConnected?.();

    await waitFor(() => {
      expect(websocketMockState.sendMock).toHaveBeenCalledTimes(2);
    });
  });

  it("finalizes partial streaming state when the provider unmounts", () => {
    const { unmount } = render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    useChatStore.setState({
      sessions: {
        "session-a": {
          messages: [],
          latestUsage: undefined,
          currentStreamingContent: "partial answer",
          currentReasoningContent: "partial reasoning",
          isStreaming: true,
          assistantStatus: "streaming",
          currentToolName: undefined,
          pendingToolConfirm: undefined,
          pendingQuestion: undefined,
        },
      },
    });

    unmount();

    expect(useChatStore.getState().sessions["session-a"]?.messages).toEqual([
      {
        id: expect.any(String),
        role: "reasoning",
        content: "partial reasoning",
        status: "completed",
      },
      {
        id: expect.any(String),
        role: "assistant",
        content: "partial answer",
        status: "completed",
      },
    ]);
    expect(useChatStore.getState().sessions["session-a"]?.isStreaming).toBe(false);
    expect(useChatStore.getState().sessions["session-a"]?.assistantStatus).toBe("idle");
  });

  it("forwards run_event messages into chat state", async () => {
    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    websocketMockState.messageHandler?.({
      type: "run_event",
      session_id: "session-a",
      event: {
        event_type: "run_started",
        session_id: "session-a",
        run_id: "run-1",
        payload: {
          source: "backend",
        },
        timestamp: "2026-03-13T09:00:00.000Z",
      },
    });

    await waitFor(async () => {
      expect(useRunStore.getState().sessions["session-a"]?.events).toHaveLength(1);
    });
  });

  it("applies todo_task tool results into the task store", async () => {
    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    websocketMockState.messageHandler?.({
      type: "tool_result",
      session_id: "session-a",
      tool_call_id: "todo-1",
      tool_name: "todo_task",
      success: true,
      output: {
        event: "todo_task",
        action: "create",
        task: {
          id: "task-1",
          content: "Ship Task 5",
          status: "in_progress",
          subTasks: [
            {
              id: "sub-1",
              content: "Wire frontend",
              status: "pending",
            },
          ],
        },
      },
    });

    await waitFor(() => {
      const tasks = useTaskStore.getState().getTasksBySession("session-a");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.content).toBe("Ship Task 5");
      expect(tasks[0]?.subTasks?.[0]?.content).toBe("Wire frontend");
    });
  });

  it("falls back to pending status for invalid todo_task statuses", async () => {
    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    websocketMockState.messageHandler?.({
      type: "tool_result",
      session_id: "session-a",
      tool_call_id: "todo-2",
      tool_name: "todo_task",
      success: true,
      output: {
        event: "todo_task",
        action: "create",
        task: {
          id: "task-invalid",
          content: "Ship Task 6",
          status: "blocked",
          subTasks: [
            {
              id: "sub-invalid",
              content: "Invalid sub status",
              status: 123,
            },
          ],
        },
      },
    });

    await waitFor(() => {
      const tasks = useTaskStore.getState().getTasksBySession("session-a");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.status).toBe("pending");
      expect(tasks[0]?.subTasks?.[0]?.status).toBe("pending");
    });
  });

  it("tracks file_write tool results for file tree highlights", async () => {
    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    websocketMockState.messageHandler?.({
      type: "tool_result",
      session_id: "session-a",
      tool_call_id: "write-1",
      tool_name: "file_write",
      success: true,
      output: {
        event: "file_write",
        path: "C:/repo/new-file.ts",
        change: "created",
      },
    });

    await waitFor(() => {
      expect(useWorkspaceStore.getState().changedFiles["C:/repo/new-file.ts"]).toBe("created");
    });
  });

  it("stores ask_question tool results as pending questions", async () => {
    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    websocketMockState.messageHandler?.({
      type: "question_request",
      session_id: "session-a",
      tool_call_id: "question-1",
      tool_name: "ask_question",
      question: "Continue deployment?",
      details: "Traffic is low right now.",
      options: ["continue", "wait"],
    });

    await waitFor(async () => {
      const { useChatStore } = await import("../stores/chatStore");
      expect(useChatStore.getState().sessions["session-a"]?.pendingQuestion?.question).toBe(
        "Continue deployment?"
      );
    });
  });

  it("updates session titles from backend session metadata events", async () => {
    useSessionStore.getState().addSession({
      session_id: "session-a",
      workspace_path: "/workspace-a",
      created_at: "2026-03-12T10:00:00.000Z",
      updated_at: "2026-03-12T10:00:00.000Z",
    });

    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    websocketMockState.messageHandler?.({
      type: "session_title_updated",
      session_id: "session-a",
      title: "Investigate runtime contracts",
    });

    await waitFor(() => {
      expect(useSessionStore.getState().sessions[0]?.title).toBe("Investigate runtime contracts");
    });
  });

  it("updates locked model metadata from backend session lock events", async () => {
    useSessionStore.getState().addSession({
      session_id: "session-a",
      workspace_path: "/workspace-a",
      created_at: "2026-03-12T10:00:00.000Z",
      updated_at: "2026-03-12T10:00:00.000Z",
    });

    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    websocketMockState.messageHandler?.({
      type: "session_lock_updated",
      session_id: "session-a",
      locked_model: {
        profile_name: "secondary",
        provider: "openai",
        model: "gpt-4o-mini",
      },
    });

    await waitFor(() => {
      expect(useSessionStore.getState().sessions[0]?.locked_model?.profile_name).toBe("secondary");
      expect(useSessionStore.getState().sessions[0]?.locked_model?.model).toBe("gpt-4o-mini");
    });
  });

  it("stores the latest usage snapshot when a run completes", async () => {
    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    websocketMockState.messageHandler?.({
      type: "started",
      session_id: "session-a",
    });

    websocketMockState.messageHandler?.({
      type: "completed",
      session_id: "session-a",
      usage: {
        prompt_tokens: 4096,
        completion_tokens: 256,
        total_tokens: 4352,
        context_length: 128000,
      },
    });

    await waitFor(async () => {
      const { useChatStore } = await import("../stores/chatStore");
      expect(useChatStore.getState().sessions["session-a"]?.latestUsage?.prompt_tokens).toBe(4096);
      expect(useChatStore.getState().sessions["session-a"]?.latestUsage?.context_length).toBe(128000);
    });
  });

  it("sends structured question responses", async () => {
    websocketMockState.sendSucceeded = true;

    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "answer question" }));

    expect(websocketMockState.sendMock).toHaveBeenCalledWith({
      type: "question_response",
      tool_call_id: "question-1",
      answer: "continue",
      action: "submit",
    });
  });

  it("sends execution mode updates", async () => {
    websocketMockState.sendSucceeded = true;

    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    websocketMockState.messageHandler?.({
      type: "config_updated",
      provider: "openai",
      model: "gpt-4o",
    });

    fireEvent.click(screen.getByRole("button", { name: "set execution mode" }));

    expect(websocketMockState.sendMock).toHaveBeenCalledWith({
      type: "set_execution_mode",
      session_id: "session-a",
      execution_mode: "free",
    });
  });

  it("does not silently downgrade auth when /auth-token returns 404", async () => {
    vi.stubEnv("MODE", "development");
    websocketMockState.sendSucceeded = true;
    vi.mocked(globalThis.fetch).mockResolvedValue({
      status: 404,
      ok: false,
      json: vi.fn(),
    } as unknown as Response);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "sync config" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    expect(websocketMockState.sendMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Backend auth handshake failed.",
      expect.stringContaining("/auth-token")
    );
  });

  it("stops sending execution mode updates when backend reports unsupported message type", async () => {
    websocketMockState.sendSucceeded = true;

    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    websocketMockState.messageHandler?.({
      type: "error",
      error: "Unknown message type: set_execution_mode",
      session_id: "session-a",
    });

    fireEvent.click(screen.getByRole("button", { name: "set execution mode" }));

    expect(websocketMockState.sendMock).not.toHaveBeenCalled();
  });

  it("queues workspace messages until config and workspace handshake completes", async () => {
    websocketMockState.sendSucceeded = true;

    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "send workspace message" }));
    expect(websocketMockState.sendMock).not.toHaveBeenCalled();

    websocketMockState.messageHandler?.({
      type: "config_updated",
      provider: "openai",
      model: "gpt-4o",
    });
    expect(websocketMockState.sendMock).toHaveBeenNthCalledWith(1, {
      type: "set_workspace",
      workspace_path: "/workspace-a",
    });

    websocketMockState.messageHandler?.({
      type: "workspace_updated",
      workspace_path: "/workspace-a",
    });
    expect(websocketMockState.sendMock).toHaveBeenNthCalledWith(2, {
      type: "message",
      session_id: "session-a",
      content: "hello",
      workspace_path: "/workspace-a",
    });
  });

  it("flushes queued execution mode only after auth, before the queued message runs", async () => {
    websocketMockState.sendSucceeded = true;

    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "set execution mode" }));
    fireEvent.click(screen.getByRole("button", { name: "send workspace message" }));

    expect(websocketMockState.sendMock).not.toHaveBeenCalled();

    websocketMockState.messageHandler?.({
      type: "config_updated",
      provider: "openai",
      model: "gpt-4o",
    });

    expect(websocketMockState.sendMock).toHaveBeenNthCalledWith(1, {
      type: "set_execution_mode",
      session_id: "session-a",
      execution_mode: "free",
    });
    expect(websocketMockState.sendMock).toHaveBeenNthCalledWith(2, {
      type: "set_workspace",
      workspace_path: "/workspace-a",
    });

    websocketMockState.messageHandler?.({
      type: "workspace_updated",
      workspace_path: "/workspace-a",
    });

    expect(websocketMockState.sendMock).toHaveBeenNthCalledWith(3, {
      type: "message",
      session_id: "session-a",
      content: "hello",
      workspace_path: "/workspace-a",
    });
  });

  it("only flushes queued messages for the workspace that was actually acknowledged", async () => {
    websocketMockState.sendSucceeded = true;

    render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "send workspace message" }));

    websocketMockState.messageHandler?.({
      type: "config_updated",
      provider: "openai",
      model: "gpt-4o",
    });

    expect(websocketMockState.sendMock).toHaveBeenNthCalledWith(1, {
      type: "set_workspace",
      workspace_path: "/workspace-a",
    });

    fireEvent.click(screen.getByRole("button", { name: "bind workspace b" }));

    expect(websocketMockState.sendMock).toHaveBeenNthCalledWith(2, {
      type: "set_workspace",
      workspace_path: "/workspace-b",
    });

    websocketMockState.messageHandler?.({
      type: "workspace_updated",
      workspace_path: "/workspace-b",
    });

    expect(websocketMockState.sendMock).toHaveBeenCalledTimes(2);

    websocketMockState.messageHandler?.({
      type: "workspace_updated",
      workspace_path: "/workspace-a",
    });

    expect(websocketMockState.sendMock).toHaveBeenNthCalledWith(3, {
      type: "message",
      session_id: "session-a",
      content: "hello",
      workspace_path: "/workspace-a",
    });
  });
});
