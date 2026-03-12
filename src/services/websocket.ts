import { ServerWebSocketMessage, ClientWebSocketMessage } from '../types';

export type MessageHandler = (data: ServerWebSocketMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private isManualClose = false;
  private isConnecting = false;
  private onConnectedCallbacks: Set<() => void> = new Set();
  private onDisconnectedCallbacks: Set<() => void> = new Set();
  private connectionId = 0;
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private mounted = false;

  connect(onConnected?: () => void, onDisconnected?: () => void): () => void {
    const currentConnectionId = ++this.connectionId;
    
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    if (onConnected) this.onConnectedCallbacks.add(onConnected);
    if (onDisconnected) this.onDisconnectedCallbacks.add(onDisconnected);
    
    this.mounted = true;
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      onConnected?.();
    } else if (!this.isConnecting) {
      this.isManualClose = false;
      this.createConnection();
    }
    
    return () => {
      if (onConnected) this.onConnectedCallbacks.delete(onConnected);
      if (onDisconnected) this.onDisconnectedCallbacks.delete(onDisconnected);
      
      if (currentConnectionId === this.connectionId && this.onConnectedCallbacks.size === 0) {
        this.cleanupTimer = setTimeout(() => {
          if (this.onConnectedCallbacks.size === 0) {
            this.mounted = false;
            this.closeConnection();
          }
          this.cleanupTimer = null;
        }, 100);
      }
    };
  }

  private createConnection(): void {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    
    this.isConnecting = true;
    
    try {
      this.ws = new WebSocket('ws://127.0.0.1:8765/ws');

      this.ws.onopen = () => {
        if (!this.mounted) {
          this.ws?.close();
          return;
        }
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        this.onConnectedCallbacks.forEach(cb => cb());
      };

      this.ws.onmessage = (event) => {
        if (!this.mounted) return;
        try {
          const data = JSON.parse(event.data) as ServerWebSocketMessage;
          this.messageHandlers.forEach(handler => handler(data));
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onclose = () => {
        const wasManual = this.isManualClose;
        this.isConnecting = false;
        
        if (!wasManual && this.mounted) {
          console.log('WebSocket disconnected');
          this.onDisconnectedCallbacks.forEach(cb => cb());

          if (this.reconnectAttempts < this.maxReconnectAttempts && this.onConnectedCallbacks.size > 0) {
            this.reconnectAttempts++;
            console.log(`Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts})`);
            this.reconnectTimer = setTimeout(() => {
              if (!this.isManualClose && this.onConnectedCallbacks.size > 0 && this.mounted) {
                this.createConnection();
              }
            }, this.reconnectDelay);
          }
        }
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      this.isConnecting = false;
    }
  }

  private closeConnection(): void {
    this.isManualClose = true;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore errors if already closed
      }
    }
    this.ws = null;
    this.messageHandlers.clear();
    this.onConnectedCallbacks.clear();
    this.onDisconnectedCallbacks.clear();
    this.isConnecting = false;
  }

  send(message: ClientWebSocketMessage): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }

    console.error('WebSocket is not connected');
    return false;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.add(handler);
  }

  offMessage(handler: MessageHandler): void {
    this.messageHandlers.delete(handler);
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  
  dispose(): void {
    this.mounted = false;
    this.closeConnection();
    this.connectionId++;
  }
}

export const wsService = new WebSocketService();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    wsService.dispose();
  });
}
