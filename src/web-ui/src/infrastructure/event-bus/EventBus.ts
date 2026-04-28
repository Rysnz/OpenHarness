/**
 * Event bus.
 *
 * Provides a pub/sub mechanism for cross-module communication.
 */

import { createLogger } from '@/shared/utils/logger';

const log = createLogger('EventBus');
const HANDLER_ERROR_EVENT = 'event:handler:error';

export type EventHandler<T = any> = (data: T) => void;
export type EventUnsubscriber = () => void;

export interface EventBusOptions {
  /** Maximum number of handlers per event. */
  maxListeners?: number;
  /** Enable debug logging for emit/on/off operations. */
  enableLogging?: boolean;
  /** Default timeout (ms) for waitFor(). */
  timeout?: number;
}

export interface EventMetadata {
  /** Event name. */
  name: string;
  /** Emitted timestamp. */
  timestamp: Date;
  /** Optional sender identifier. */
  sender?: string;
  /** Payload data. */
  data?: any;
}

export class EventBus {
  private listeners = new Map<string, Set<EventHandler>>();
  private onceListeners = new Map<string, Set<EventHandler>>();
  private options: Required<EventBusOptions>;
  private eventHistory: EventMetadata[] = [];
  private readonly MAX_HISTORY = 1000;

  constructor(options: EventBusOptions = {}) {
    this.options = {
      maxListeners: options.maxListeners ?? 100,
      enableLogging: options.enableLogging ?? false,
      timeout: options.timeout ?? 5000
    };
  }

  /**
   * Subscribe to an event.
   */
  on<T = any>(event: string, handler: EventHandler<T>): EventUnsubscriber {
    this.validateEventName(event);
    this.validateHandler(handler);

    const handlers = this.addHandler(this.listeners, event, handler);

    if (this.options.enableLogging) {
      log.debug('Added listener', { event, totalListeners: handlers.size });
    }

    // Return the unsubscribe function.
    return () => this.off(event, handler);
  }

  /**
   * Subscribe to an event once.
   */
  once<T = any>(event: string, handler: EventHandler<T>): EventUnsubscriber {
    this.validateEventName(event);
    this.validateHandler(handler);

    const handlers = this.addHandler(this.onceListeners, event, handler, false);

    if (this.options.enableLogging) {
      log.debug('Added once listener', { event });
    }

    // Return the unsubscribe function.
    return () => {
      handlers.delete(handler);
    };
  }

  /**
   * Unsubscribe from an event.
   */
  off<T = any>(event: string, handler: EventHandler<T>): void {
    this.validateEventName(event);

    this.removeHandler(this.listeners, event, handler);
    this.removeHandler(this.onceListeners, event, handler);

    if (this.options.enableLogging) {
      log.debug('Removed listener', { event });
    }
  }

  /**
   * Emit an event.
   */
  emit<T = any>(event: string, data?: T, sender?: string): boolean {
    this.validateEventName(event);

    this.recordEvent(this.createMetadata(event, data, sender));

    if (this.options.enableLogging) {
      log.debug('Emitting event', { event, data });
    }

    const dispatchedRegular = this.dispatchStoredHandlers(this.listeners, event, data);
    const dispatchedOnce = this.dispatchStoredHandlers(this.onceListeners, event, data, true);
    return dispatchedRegular || dispatchedOnce;
  }

  /**
   * Wait for the next occurrence of an event.
   */
  async waitFor<T = any>(event: string, timeout?: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutMs = timeout ?? this.options.timeout;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = this.once(event, (data: T) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve(data);
      });

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for event '${event}' after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /**
   * Remove listeners.
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
      if (this.options.enableLogging) {
        log.debug('Removed all listeners for event', { event });
      }
    } else {
      this.listeners.clear();
      this.onceListeners.clear();
      if (this.options.enableLogging) {
        log.debug('Removed all listeners');
      }
    }
  }

  /**
   * Get listener count for an event.
   */
  listenerCount(event: string): number {
    const regularCount = this.listeners.get(event)?.size ?? 0;
    const onceCount = this.onceListeners.get(event)?.size ?? 0;
    return regularCount + onceCount;
  }

  /**
   * Get all registered event names.
   */
  eventNames(): string[] {
    const events = new Set<string>();
    this.addEventNames(events, this.listeners);
    this.addEventNames(events, this.onceListeners);
    return Array.from(events);
  }

  /**
   * Get event history (in-memory).
   */
  getEventHistory(eventName?: string, limit?: number): EventMetadata[] {
    let history = this.eventHistory;
    
    if (eventName) {
      history = history.filter(event => event.name === eventName);
    }
    
    if (limit) {
      history = history.slice(-limit);
    }
    
    return [...history];
  }

  /**
   * Clear event history (in-memory).
   */
  clearEventHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Destroy the event bus (clears all listeners and history).
   */
  destroy(): void {
    this.removeAllListeners();
    this.clearEventHistory();

    if (this.options.enableLogging) {
      log.debug('Destroyed');
    }
  }

  private validateEventName(event: string): void {
    if (!event || typeof event !== 'string') {
      throw new Error('Event name must be a non-empty string');
    }
  }

  private validateHandler(handler: EventHandler): void {
    if (typeof handler !== 'function') {
      throw new Error('Event handler must be a function');
    }
  }

  private createMetadata<T>(event: string, data?: T, sender?: string): EventMetadata {
    return {
      name: event,
      timestamp: new Date(),
      sender,
      data
    };
  }

  private addHandler<T>(
    registry: Map<string, Set<EventHandler>>,
    event: string,
    handler: EventHandler<T>,
    enforceLimit = true
  ): Set<EventHandler> {
    const handlers = this.getOrCreateHandlers(registry, event);

    if (enforceLimit && handlers.size >= this.options.maxListeners) {
      throw new Error(`Too many listeners for event '${event}'. Maximum is ${this.options.maxListeners}`);
    }

    handlers.add(handler);
    return handlers;
  }

  private getOrCreateHandlers(
    registry: Map<string, Set<EventHandler>>,
    event: string
  ): Set<EventHandler> {
    let handlers = registry.get(event);
    if (!handlers) {
      handlers = new Set();
      registry.set(event, handlers);
    }
    return handlers;
  }

  private removeHandler<T>(
    registry: Map<string, Set<EventHandler>>,
    event: string,
    handler: EventHandler<T>
  ): void {
    const handlers = registry.get(event);
    if (!handlers) {
      return;
    }

    handlers.delete(handler);
    if (handlers.size === 0) {
      registry.delete(event);
    }
  }

  private dispatchStoredHandlers<T>(
    registry: Map<string, Set<EventHandler>>,
    event: string,
    data: T | undefined,
    clearAfterDispatch = false
  ): boolean {
    const handlers = registry.get(event);
    if (!handlers || handlers.size === 0) {
      return false;
    }

    this.executeHandlers(Array.from(handlers), data, event);
    if (clearAfterDispatch) {
      registry.delete(event);
    }
    return true;
  }

  private executeHandlers(handlers: EventHandler[], data: any, event: string): void {
    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        log.error('Error in event handler', { event, error });
        this.emit(HANDLER_ERROR_EVENT, {
          event,
          error,
          handler: handler.toString()
        }, 'EventBus');
      }
    });
  }

  private addEventNames(events: Set<string>, registry: Map<string, Set<EventHandler>>): void {
    registry.forEach((_, event) => events.add(event));
  }

  private recordEvent(metadata: EventMetadata): void {
    this.eventHistory.push(metadata);
    if (this.eventHistory.length > this.MAX_HISTORY) {
      this.eventHistory = this.eventHistory.slice(-this.MAX_HISTORY);
    }
  }
}

// Global event bus instance
export const globalEventBus = new EventBus({
  enableLogging: process.env.NODE_ENV === 'development',
  maxListeners: 200
});

// Common event name constants
export const EVENT_NAMES = {
  // App lifecycle
  APP_READY: 'app:ready',
  APP_SHUTDOWN: 'app:shutdown',
  
  // Workspace
  WORKSPACE_OPENED: 'workspace:opened',
  WORKSPACE_CLOSED: 'workspace:closed',
  WORKSPACE_CHANGED: 'workspace:changed',
  
  // Files
  FILE_OPENED: 'file:opened',
  FILE_CLOSED: 'file:closed',
  FILE_SAVED: 'file:saved',
  FILE_CHANGED: 'file:changed',
  
  // Agent
  AGENT_STARTED: 'agent:started',
  AGENT_STOPPED: 'agent:stopped',
  AGENT_MESSAGE: 'agent:message',
  AGENT_ERROR: 'agent:error',
  
  // Plugins
  PLUGIN_REGISTERED: 'plugin:registered',
  PLUGIN_ACTIVATED: 'plugin:activated',
  PLUGIN_DEACTIVATED: 'plugin:deactivated',
  PLUGIN_ERROR: 'plugin:error',
  
  // UI
  THEME_CHANGED: 'ui:theme:changed',
  NOTIFICATION: 'ui:notification',
  MODAL_OPENED: 'ui:modal:opened',
  MODAL_CLOSED: 'ui:modal:closed'
} as const;
