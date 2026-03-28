import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketService } from './websocket';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  send(): void {}

  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  emitError(): void {
    this.onerror?.();
  }
}

describe('WebSocketService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ignores stale socket callbacks after a reconnect starts', () => {
    const service = new WebSocketService();
    const cleanup = service.connect(() => {});

    expect(MockWebSocket.instances).toHaveLength(1);

    const firstSocket = MockWebSocket.instances[0];
    firstSocket.emitClose();

    vi.advanceTimersByTime(3000);

    expect(MockWebSocket.instances).toHaveLength(2);

    const secondSocket = MockWebSocket.instances[1];
    expect(secondSocket.readyState).toBe(MockWebSocket.CONNECTING);

    firstSocket.emitError();
    service.connect();

    expect(MockWebSocket.instances).toHaveLength(2);

    cleanup();
    service.dispose();
  });
});
