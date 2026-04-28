 

import { createLogger } from '@/shared/utils/logger';

const log = createLogger('EventManager');

export type EventCallback<T = any> = (data: T) => void | Promise<void>;
export type EventListener<T = any> = {
  callback: EventCallback<T>;
  once: boolean;
  priority: number;
  maxExecutions?: number;
};

export interface EventManagerInterface {
  on<T = any>(event: string, callback: EventCallback<T>, options?: EventListenerOptions): () => void;
  once<T = any>(event: string, callback: EventCallback<T>, options?: EventListenerOptions): () => void;
  emit<T = any>(event: string, data?: T): Promise<void>;
  off(event: string, callback?: EventCallback): void;
  removeAllListeners(event?: string): void;
  listenerCount(event: string): number;
  hasListeners(event: string): boolean;
}

export interface EventListenerOptions {
  priority?: number; 
  maxExecutions?: number; 
  timeout?: number; 
}

 
export class EventManager implements EventManagerInterface {
  private listeners: Map<string, EventListener[]> = new Map();
  private executionCounts: Map<string, Map<EventCallback, number>> = new Map();
  private readonly debugMode: boolean;

  constructor(debugMode: boolean = false) {
    this.debugMode = debugMode;
  }

   
  on<T = any>(event: string, callback: EventCallback<T>, options: EventListenerOptions = {}): () => void {
    if (this.debugMode) {
      log.debug('Registering event listener', { event });
    }

    this.registerListener(event, this.createListener(callback, false, options));
    return () => this.off(event, callback);
  }

   
  once<T = any>(event: string, callback: EventCallback<T>, options: EventListenerOptions = {}): () => void {
    this.registerListener(event, this.createListener(callback, true, options));
    return () => this.off(event, callback);
  }

   
  async emit<T = any>(event: string, data?: T): Promise<void> {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners || eventListeners.length === 0) {
      return;
    }

    if (this.debugMode) {
      log.debug('Emitting event', { event, listenerCount: eventListeners.length });
    }

    const expiredListeners: EventListener[] = [];
    const pendingCallbacks: Promise<void>[] = [];

    for (const listener of eventListeners) {
      try {
        if (this.hasReachedExecutionLimit(event, listener)) {
          expiredListeners.push(listener);
          continue;
        }

        const result = listener.callback(data);
        if (result instanceof Promise) {
          pendingCallbacks.push(result);
        }

        if (listener.once) {
          expiredListeners.push(listener);
        }
      } catch (error) {
        log.error('Error in event listener', { event, error });
      }
    }

    if (pendingCallbacks.length > 0) {
      try {
        await Promise.allSettled(pendingCallbacks);
      } catch (error) {
        log.error('Error in async event listeners', { event, error });
      }
    }

    if (expiredListeners.length > 0) {
      this.removeListeners(event, expiredListeners);
    }
  }

   
  off(event: string, callback?: EventCallback): void {
    if (!callback) {
      
      this.listeners.delete(event);
      this.executionCounts.delete(event);
      return;
    }

    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return;

    const filteredListeners = eventListeners.filter(l => l.callback !== callback);
    this.listeners.set(event, filteredListeners);

    
    const eventExecutionCounts = this.executionCounts.get(event);
    if (eventExecutionCounts) {
      eventExecutionCounts.delete(callback);
    }
  }

   
  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
      this.executionCounts.delete(event);
    } else {
      this.listeners.clear();
      this.executionCounts.clear();
    }
  }

   
  listenerCount(event: string): number {
    const eventListeners = this.listeners.get(event);
    return eventListeners ? eventListeners.length : 0;
  }

   
  hasListeners(event: string): boolean {
    return this.listenerCount(event) > 0;
  }

   
  getEventNames(): string[] {
    return Array.from(this.listeners.keys());
  }

   
  getDebugInfo(): { [event: string]: number } {
    const info: { [event: string]: number } = {};
    for (const [event, listeners] of this.listeners.entries()) {
      info[event] = listeners.length;
    }
    return info;
  }

  private createListener<T>(
    callback: EventCallback<T>,
    once: boolean,
    options: EventListenerOptions
  ): EventListener<T> {
    return {
      callback,
      once,
      priority: options.priority ?? 0,
      maxExecutions: options.maxExecutions,
    };
  }

  private registerListener(event: string, listener: EventListener): void {
    const eventListeners = this.getOrCreateListenerList(event);
    eventListeners.push(listener);
    eventListeners.sort((a, b) => b.priority - a.priority);

    if (listener.maxExecutions) {
      this.getOrCreateExecutionCounts(event).set(listener.callback, 0);
    }
  }

  private getOrCreateListenerList(event: string): EventListener[] {
    let eventListeners = this.listeners.get(event);
    if (!eventListeners) {
      eventListeners = [];
      this.listeners.set(event, eventListeners);
    }
    return eventListeners;
  }

  private getOrCreateExecutionCounts(event: string): Map<EventCallback, number> {
    let counts = this.executionCounts.get(event);
    if (!counts) {
      counts = new Map();
      this.executionCounts.set(event, counts);
    }
    return counts;
  }

  private hasReachedExecutionLimit(event: string, listener: EventListener): boolean {
    if (!listener.maxExecutions) {
      return false;
    }

    const counts = this.getOrCreateExecutionCounts(event);
    const currentCount = counts.get(listener.callback) ?? 0;
    if (currentCount >= listener.maxExecutions) {
      return true;
    }

    counts.set(listener.callback, currentCount + 1);
    return false;
  }

  private removeListeners(event: string, listenersToRemove: EventListener[]): void {
    const currentListeners = this.listeners.get(event);
    if (!currentListeners) {
      return;
    }

    const nextListeners = currentListeners.filter(listener => !listenersToRemove.includes(listener));
    this.listeners.set(event, nextListeners);

    const counts = this.executionCounts.get(event);
    if (counts) {
      for (const listener of listenersToRemove) {
        counts.delete(listener.callback);
      }
    }
  }
}
export const EventTypes = {
  SESSION_START: 'session:start',
  SESSION_END: 'session:end',
  SESSION_ERROR: 'session:error',
  SESSION_STATE_CHANGE: 'session:state_change',
  TOOL_CALL_REQUEST: 'tool:call_request',
  TOOL_CALL_RESPONSE: 'tool:call_response',
  TOOL_EXECUTION_START: 'tool:execution_start',
  TOOL_EXECUTION_UPDATE: 'tool:execution_update',
  TOOL_EXECUTION_COMPLETE: 'tool:execution_complete',
  TOOL_EXECUTION_ERROR: 'tool:execution_error',
  TOOL_BATCH_START: 'tool:batch_start',
  TOOL_BATCH_UPDATE: 'tool:batch_update',
  TOOL_BATCH_COMPLETE: 'tool:batch_complete',
  WORKSPACE_OPENED: 'workspace:opened',
  WORKSPACE_CLOSED: 'workspace:closed',
  WORKSPACE_SWITCHED: 'workspace:switched',
  WORKSPACE_UPDATED: 'workspace:updated',
  WORKSPACE_ERROR: 'workspace:error',
  MESSAGE_ADD: 'message:add',
  MESSAGE_UPDATE: 'message:update',
  MESSAGE_DELETE: 'message:delete',
  MESSAGE_STREAM_START: 'message:stream_start',
  MESSAGE_STREAM_CHUNK: 'message:stream_chunk',
  MESSAGE_STREAM_END: 'message:stream_end',
  CONFIG_CHANGE: 'config:change',
  MODEL_CHANGE: 'model:change',
  THEME_CHANGE: 'theme:change',
} as const;


export interface SessionEventData {
  sessionId: string;
  timestamp: number;
  data?: any;
}

export interface ToolEventData {
  toolId: string;
  toolName: string;
  status: string;
  timestamp: number;
  data?: any;
}

export interface WorkspaceEventData {
  workspaceId: string;
  workspacePath: string;
  timestamp: number;
  data?: any;
}

export interface MessageEventData {
  messageId: string;
  content: string;
  role: string;
  timestamp: number;
  data?: any;
}


export const globalEventManager = new EventManager(
  process.env.NODE_ENV === 'development'
);


export class EventEmitter {
  constructor(private eventManager: EventManager = globalEventManager) {}

  protected emit<T = any>(event: string, data?: T): Promise<void> {
    return this.eventManager.emit(event, data);
  }

  protected on<T = any>(event: string, callback: EventCallback<T>, options?: EventListenerOptions): () => void {
    return this.eventManager.on(event, callback, options);
  }

  protected once<T = any>(event: string, callback: EventCallback<T>, options?: EventListenerOptions): () => void {
    return this.eventManager.once(event, callback, options);
  }

  protected off(event: string, callback?: EventCallback): void {
    this.eventManager.off(event, callback);
  }
}


export class TypedEventManager<EventMap extends Record<string, any>> {
  constructor(private eventManager: EventManager = globalEventManager) {}

  on<K extends keyof EventMap>(
    event: K,
    callback: EventCallback<EventMap[K]>,
    options?: EventListenerOptions
  ): () => void {
    return this.eventManager.on(event as string, callback, options);
  }

  once<K extends keyof EventMap>(
    event: K,
    callback: EventCallback<EventMap[K]>,
    options?: EventListenerOptions
  ): () => void {
    return this.eventManager.once(event as string, callback, options);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): Promise<void> {
    return this.eventManager.emit(event as string, data);
  }

  off<K extends keyof EventMap>(event: K, callback?: EventCallback<EventMap[K]>): void {
    this.eventManager.off(event as string, callback);
  }
}
