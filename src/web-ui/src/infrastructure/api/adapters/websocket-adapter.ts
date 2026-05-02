import { ITransportAdapter } from './base';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('WebSocketAdapter');

const DEFAULT_WS_URL = 'ws://localhost:8080/ws';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 1_000;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timeout: ReturnType<typeof setTimeout>;
}

type EventCallback = (data: any) => void;

export class WebSocketTransportAdapter implements ITransportAdapter {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly eventListeners = new Map<string, Set<EventCallback>>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private messageIdCounter = 0;
  private reconnectAttempts = 0;
  private shouldReconnect = true;

  constructor(url?: string) {
    this.url = url || import.meta.env.VITE_WS_URL || DEFAULT_WS_URL;
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        log.info('Connecting', { url: this.url });
        const socket = new WebSocket(this.url);
        this.ws = socket;

        socket.onopen = () => {
          log.info('Connected successfully');
          this.reconnectAttempts = 0;
          this.installMessageHandler(socket);
          resolve();
        };

        socket.onerror = (error) => {
          log.error('Connection error', error);
          reject(new Error('WebSocket connection failed'));
        };

        socket.onclose = () => {
          log.info('Connection closed');
          this.handleDisconnect();
        };
      } catch (error) {
        log.error('Failed to create WebSocket', error);
        reject(error);
      }
    });
  }

  async request<T>(action: string, params?: any): Promise<T> {
    if (!this.isConnected()) {
      throw new Error('WebSocket not connected');
    }

    const messageId = this.nextMessageId();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error(`Request timeout: ${action}`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(messageId, { resolve, reject, timeout });
      this.sendRequest(messageId, action, params, reject, timeout);
    });
  }

  listen<T>(event: string, callback: (data: T) => void): () => void {
    const listeners = this.getEventListeners(event);
    listeners.add(callback as EventCallback);

    return () => {
      this.removeEventListener(event, callback as EventCallback);
    };
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.rejectPendingRequests('WebSocket manually disconnected');
    this.eventListeners.clear();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.reconnectAttempts = 0;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private installMessageHandler(socket: WebSocket): void {
    socket.onmessage = (event) => {
      try {
        this.routeMessage(JSON.parse(event.data));
      } catch (error) {
        log.error('Failed to parse message', { data: event.data, error });
      }
    };
  }

  private routeMessage(message: any): void {
    if (message.id && this.resolvePendingRequest(message)) {
      return;
    }

    if (message.event) {
      this.dispatchEvent(message.event, message.payload);
    }
  }

  private resolvePendingRequest(message: any): boolean {
    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error));
    } else {
      pending.resolve(message.result);
    }

    return true;
  }

  private dispatchEvent(event: string, payload: any): void {
    const listeners = this.eventListeners.get(event);
    if (!listeners || listeners.size === 0) {
      return;
    }

    listeners.forEach((callback) => {
      try {
        callback(payload);
      } catch (error) {
        log.error('Error in event listener', { event, error });
      }
    });
  }

  private handleDisconnect(): void {
    if (!this.shouldReconnect) {
      return;
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log.error('Max reconnection attempts reached');
      this.rejectPendingRequests('WebSocket disconnected');
      return;
    }

    this.reconnectAttempts += 1;
    const delay = RECONNECT_DELAY_MS * this.reconnectAttempts;
    log.info('Reconnecting', {
      delay,
      attempt: this.reconnectAttempts,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
    });

    setTimeout(() => {
      this.connect().catch(error => {
        log.error('Reconnection failed', error);
      });
    }, delay);
  }

  private rejectPendingRequests(message: string): void {
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    });
    this.pendingRequests.clear();
  }

  private sendRequest(
    messageId: string,
    action: string,
    params: any,
    reject: (error: any) => void,
    timeout: ReturnType<typeof setTimeout>
  ): void {
    try {
      this.ws!.send(JSON.stringify({
        id: messageId,
        action,
        params: params || {},
      }));
    } catch (error) {
      clearTimeout(timeout);
      this.pendingRequests.delete(messageId);
      reject(error);
    }
  }

  private getEventListeners(event: string): Set<EventCallback> {
    let listeners = this.eventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(event, listeners);
    }
    return listeners;
  }

  private removeEventListener(event: string, callback: EventCallback): void {
    const listeners = this.eventListeners.get(event);
    if (!listeners) {
      return;
    }

    listeners.delete(callback);
    if (listeners.size === 0) {
      this.eventListeners.delete(event);
    }
  }

  private nextMessageId(): string {
    this.messageIdCounter += 1;
    return `msg_${Date.now()}_${this.messageIdCounter}`;
  }
}
