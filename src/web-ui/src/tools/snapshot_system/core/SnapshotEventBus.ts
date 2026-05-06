import { createLogger } from '@/shared/utils/logger';

const log = createLogger('SnapshotEventBus');
const DEFAULT_HISTORY_LIMIT = 100;

export interface SnapshotEvent {
  type: string;
  payload: any;
  timestamp: number;
  sessionId?: string;
  filePath?: string;
}

export interface SnapshotEventListener {
  (event: SnapshotEvent): void;
}

export class SnapshotEventBus {
  private static instance: SnapshotEventBus;
  private listeners: Map<string, Set<SnapshotEventListener>> = new Map();
  private eventHistory: SnapshotEvent[] = [];
  private maxHistorySize = DEFAULT_HISTORY_LIMIT;

  private constructor() {}

  public static getInstance(): SnapshotEventBus {
    if (!SnapshotEventBus.instance) {
      SnapshotEventBus.instance = new SnapshotEventBus();
    }
    return SnapshotEventBus.instance;
  }

  on(eventType: string, listener: SnapshotEventListener): () => void {
    const listeners = this.listenersFor(eventType);
    listeners.add(listener);

    return () => this.removeListener(eventType, listener);
  }

  emit(eventType: string, payload: any, sessionId?: string, filePath?: string): void {
    const event = this.createEvent(eventType, payload, sessionId, filePath);
    this.recordEvent(event);
    this.dispatch(eventType, event);
  }

  once(eventType: string, listener: SnapshotEventListener): void {
    const unsubscribe = this.on(eventType, (event) => {
      unsubscribe();
      listener(event);
    });
  }

  off(eventType?: string): void {
    if (eventType) {
      this.listeners.delete(eventType);
      return;
    }

    this.listeners.clear();
  }

  getEventHistory(eventType?: string, sessionId?: string): SnapshotEvent[] {
    return this.eventHistory.filter((event) =>
      this.matchesHistoryFilter(event, eventType, sessionId),
    );
  }

  clearHistory(): void {
    this.eventHistory = [];
  }

  private listenersFor(eventType: string): Set<SnapshotEventListener> {
    let listeners = this.listeners.get(eventType);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(eventType, listeners);
    }
    return listeners;
  }

  private removeListener(eventType: string, listener: SnapshotEventListener): void {
    const listeners = this.listeners.get(eventType);
    if (!listeners) {
      return;
    }

    listeners.delete(listener);
    if (listeners.size === 0) {
      this.listeners.delete(eventType);
    }
  }

  private dispatch(eventType: string, event: SnapshotEvent): void {
    const listeners = this.listeners.get(eventType);
    if (!listeners) {
      return;
    }

    listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        log.error('Event listener execution failed', { eventType, error });
      }
    });
  }

  private createEvent(
    type: string,
    payload: any,
    sessionId?: string,
    filePath?: string,
  ): SnapshotEvent {
    return {
      type,
      payload,
      timestamp: Date.now(),
      sessionId,
      filePath,
    };
  }

  private recordEvent(event: SnapshotEvent): void {
    this.eventHistory.push(event);
    while (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  private matchesHistoryFilter(
    event: SnapshotEvent,
    eventType?: string,
    sessionId?: string,
  ): boolean {
    return (!eventType || event.type === eventType) && (!sessionId || event.sessionId === sessionId);
  }
}

export const SNAPSHOT_EVENTS = {
  FILE_MODIFIED: 'file_modified',
  FILE_OPERATION_COMPLETED: 'file_operation_completed',
  SESSION_STATE_CHANGED: 'session_state_changed',
  FILE_STATE_CHANGED: 'file_state_changed',
  BLOCK_STATE_CHANGED: 'block_state_changed',
  USER_ACCEPT_FILE: 'user_accept_file',
  USER_REJECT_FILE: 'user_reject_file',
  USER_ACCEPT_BLOCK: 'user_accept_block',
  USER_REJECT_BLOCK: 'user_reject_block',
  USER_ACCEPT_SESSION: 'user_accept_session',
  USER_REJECT_SESSION: 'user_reject_session',
  CONFLICT_DETECTED: 'conflict_detected',
  CONFLICT_RESOLVED: 'conflict_resolved',
  SNAPSHOT_INITIALIZED: 'snapshot_initialized',
  SESSION_CREATED: 'session_created',
  SESSION_COMPLETED: 'session_completed'
} as const;

export type SnapshotEventType = typeof SNAPSHOT_EVENTS[keyof typeof SNAPSHOT_EVENTS];
