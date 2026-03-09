import { ServerWebSocketMessage, ClientWebSocketMessage } from '../types';

export type MessageHandler = (data: ServerWebSocketMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private messageHandler: MessageHandler | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private isManualClose = false;

  connect(onConnected?: () => void, onDisconnected?: () => void): void {
    this.isManualClose = false;
    this.createConnection(onConnected, onDisconnected);
  }

  private createConnection(onConnected?: () => void, onDisconnected?: () => void): void {
    try {
      this.ws = new WebSocket('ws://127.0.0.1:8765/ws');

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        onConnected?.();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ServerWebSocketMessage;
          this.messageHandler?.(data);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        onDisconnected?.();

        if (!this.isManualClose && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts})`);
          setTimeout(() => {
            this.createConnection(onConnected, onDisconnected);
          }, this.reconnectDelay);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
    }
  }

  disconnect(): void {
    this.isManualClose = true;
    this.ws?.close();
    this.ws = null;
  }

  send(message: ClientWebSocketMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket is not connected');
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsService = new WebSocketService();