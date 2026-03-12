import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "../types";
import { useConfigStore } from "../stores/configStore";
import { WebSocketProvider, useWebSocket } from "./WebSocketContext";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

const websocketMockState = vi.hoisted(() => {
  const statusListeners = new Set<(status: ConnectionStatus) => void>();

  return {
    statusListeners,
    connectionStatus: "connecting" as ConnectionStatus,
    sendSucceeded: false,
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
    onMessageMock: vi.fn(),
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
  };

  return (
    <>
      <button type="button" onClick={() => context.sendConfig()} aria-label="sync config">
        sync
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
  beforeEach(() => {
    localStorage.clear();
    websocketMockState.statusListeners.clear();
    websocketMockState.connectionStatus = "connecting";
    websocketMockState.sendSucceeded = false;
    websocketMockState.onConnected = undefined;
    websocketMockState.onDisconnected = undefined;
    websocketMockState.connectMock.mockClear();
    websocketMockState.sendMock.mockClear();
    websocketMockState.onMessageMock.mockClear();
    websocketMockState.offMessageMock.mockClear();
    websocketMockState.isConnectedMock.mockClear();
    websocketMockState.getConnectionStatusMock.mockClear();
    websocketMockState.onStatusChangeMock.mockClear();
    useConfigStore.setState((state) => ({
      ...state,
      config: testConfig,
    }));
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
});
