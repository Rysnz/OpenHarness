/**
 * Terminal service that wraps Tauri backend calls.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { createLogger } from '@/shared/utils/logger';
import type {
  CreateSessionRequest,
  SessionResponse,
  ShellInfo,
  WriteRequest,
  ResizeRequest,
  CloseSessionRequest,
  SignalRequest,
  AcknowledgeRequest,
  ExecuteCommandRequest,
  ExecuteCommandResponse,
  SendCommandRequest,
  GetHistoryResponse,
  TerminalEvent,
  TerminalEventCallback,
  UnsubscribeFunction,
} from '../types';

const log = createLogger('TerminalService');
const TERMINAL_EVENT_CHANNEL = 'terminal_event';
const TERMINAL_SESSION_DESTROYED_EVENT = 'terminal-session-destroyed';

type RawTerminalEvent = {
  type: string;
  payload?: Record<string, any>;
};

type NormalizedTerminalEvent = {
  event?: TerminalEvent;
  sessionId?: string;
  isSessionDestroyed?: boolean;
  ignored?: boolean;
  unknownType?: string;
};

const normalizeTerminalEvent = (rawEvent: RawTerminalEvent): NormalizedTerminalEvent => {
  const eventType = rawEvent.type;
  const payload = rawEvent.payload || {};
  const sessionId = payload.session_id;

  switch (eventType) {
    case 'Data':
      return { event: { type: 'output', sessionId, data: payload.data }, sessionId };
    case 'Ready':
    case 'SessionCreated':
      return { event: { type: 'ready', sessionId }, sessionId };
    case 'Exit':
      return { event: { type: 'exit', sessionId, exitCode: payload.exit_code }, sessionId };
    case 'SessionDestroyed':
      return {
        event: { type: 'exit', sessionId, exitCode: undefined },
        sessionId,
        isSessionDestroyed: true,
      };
    case 'Error':
      return { event: { type: 'error', sessionId, message: payload.message || payload.error }, sessionId };
    case 'CwdChanged':
      return { event: { type: 'cwd', sessionId, cwd: payload.cwd }, sessionId };
    case 'TitleChanged':
      return { event: { type: 'title', sessionId, title: payload.title }, sessionId };
    case 'Resized':
      return { event: { type: 'resize', sessionId, cols: payload.cols, rows: payload.rows }, sessionId };
    case 'CommandStarted':
    case 'CommandFinished':
      return { ignored: true };
    default:
      return { unknownType: eventType };
  }
};

const notifyTerminalCallbacks = (
  callbacks: Iterable<TerminalEventCallback>,
  event: TerminalEvent,
  label: string
) => {
  for (const callback of callbacks) {
    try {
      callback(event);
    } catch (error) {
      log.error(label, error);
    }
  }
};

const dispatchTerminalDestroyed = (sessionId: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(TERMINAL_SESSION_DESTROYED_EVENT, { detail: { sessionId } })
  );
};

/**
 * Singleton wrapper for terminal-related Tauri API calls.
 */
export class TerminalService {
  private static instance: TerminalService | null = null;
  
  private eventListeners: Map<string, Set<TerminalEventCallback>> = new Map();
  
  private globalListeners: Set<TerminalEventCallback> = new Set();
  
  private unlistenFn: UnlistenFn | null = null;

  private connected: boolean = false;

  private connectingPromise: Promise<void> | null = null;

  private constructor() {
  }

  static getInstance(): TerminalService {
    if (!TerminalService.instance) {
      TerminalService.instance = new TerminalService();
    }
    return TerminalService.instance;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connectingPromise) return this.connectingPromise;

    this.connectingPromise = (async () => {
      try {
        this.unlistenFn = await listen<TerminalEvent>(TERMINAL_EVENT_CHANNEL, (event) => {
          this.handleTerminalEvent(event.payload);
        });
        this.connected = true;
        log.debug('Connected to terminal event stream');
      } catch (error) {
        log.error('Failed to connect', error);
        throw error;
      } finally {
        this.connectingPromise = null;
      }
    })();

    return this.connectingPromise;
  }

  async disconnect(): Promise<void> {
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }
    this.connected = false;
    this.eventListeners.clear();
    this.globalListeners.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Handle backend terminal events.
   * Backend format: { type, payload: { session_id, ... } }
   * Frontend format: { type, sessionId, ... }
   */
  private handleTerminalEvent(rawEvent: RawTerminalEvent): void {
    const normalized = normalizeTerminalEvent(rawEvent);

    if (normalized.ignored) return;
    if (normalized.unknownType) {
      log.warn('Unknown event type', { eventType: normalized.unknownType });
      return;
    }
    if (!normalized.event) return;

    const { event, sessionId, isSessionDestroyed } = normalized;
    const sessionListeners = sessionId ? this.eventListeners.get(sessionId) : undefined;
    if (sessionListeners) {
      notifyTerminalCallbacks(sessionListeners, event, 'Event callback error');
    }

    notifyTerminalCallbacks(this.globalListeners, event, 'Global callback error');

    if (isSessionDestroyed && sessionId) {
      dispatchTerminalDestroyed(sessionId);
      this.eventListeners.delete(sessionId);
    }
  }

  onSessionEvent(sessionId: string, callback: TerminalEventCallback): UnsubscribeFunction {
    let listeners = this.eventListeners.get(sessionId);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(sessionId, listeners);
    }
    listeners.add(callback);

    return () => {
      listeners?.delete(callback);
      if (listeners?.size === 0) {
        this.eventListeners.delete(sessionId);
      }
    };
  }

  onEvent(callback: TerminalEventCallback): UnsubscribeFunction {
    this.globalListeners.add(callback);
    return () => {
      this.globalListeners.delete(callback);
    };
  }

  async getAvailableShells(): Promise<ShellInfo[]> {
    try {
      const shells = await invoke<ShellInfo[]>('terminal_get_shells');
      return shells;
    } catch (error) {
      log.error('Failed to get available shells', error);
      throw error;
    }
  }

  async createSession(request: CreateSessionRequest): Promise<SessionResponse> {
    try {
      const session = await invoke<SessionResponse>('terminal_create', { request });
      log.debug('Session created', { sessionId: session.id });
      return session;
    } catch (error) {
      log.error('Failed to create session', error);
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<SessionResponse> {
    try {
      const session = await invoke<SessionResponse>('terminal_get', { sessionId });
      return session;
    } catch (error) {
      log.error('Failed to get session', { sessionId, error });
      throw error;
    }
  }

  async listSessions(): Promise<SessionResponse[]> {
    try {
      const sessions = await invoke<SessionResponse[]>('terminal_list');
      return sessions;
    } catch (error) {
      log.error('Failed to list sessions', error);
      throw error;
    }
  }

  async closeSession(sessionId: string, immediate: boolean = false): Promise<void> {
    try {
      const request: CloseSessionRequest = { sessionId, immediate };
      await invoke('terminal_close', { request });
      log.debug('Session closed', { sessionId });
      
      this.eventListeners.delete(sessionId);
    } catch (error) {
      log.error('Failed to close session', error);
      throw error;
    }
  }

  async shutdownAll(): Promise<void> {
    try {
      await invoke('terminal_shutdown_all');
      log.debug('All sessions closed');
      this.eventListeners.clear();
    } catch (error) {
      log.error('Failed to shutdown all sessions', error);
      throw error;
    }
  }

  async getHistory(sessionId: string): Promise<GetHistoryResponse> {
    try {
      const history = await invoke<GetHistoryResponse>('terminal_get_history', { sessionId });
      return history;
    } catch (error) {
      log.error('Failed to get history', error);
      throw error;
    }
  }

  async write(sessionId: string, data: string): Promise<void> {
    try {
      const request: WriteRequest = { sessionId, data };
      await invoke('terminal_write', { request });
    } catch (error) {
      log.error('Failed to write to session', { sessionId, error });
      throw error;
    }
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    try {
      const request: ResizeRequest = { sessionId, cols, rows };
      await invoke('terminal_resize', { request });
    } catch (error) {
      log.error('Failed to resize session', { sessionId, cols, rows, error });
      throw error;
    }
  }

  async signal(sessionId: string, signal: string): Promise<void> {
    try {
      const request: SignalRequest = { sessionId, signal };
      await invoke('terminal_signal', { request });
    } catch (error) {
      log.error('Failed to send signal', { sessionId, signal, error });
      throw error;
    }
  }

  async acknowledge(sessionId: string, charCount: number): Promise<void> {
    try {
      const request: AcknowledgeRequest = { sessionId, charCount };
      await invoke('terminal_ack', { request });
    } catch (error) {
      log.error('Failed to acknowledge data', { sessionId, charCount, error });
      throw error;
    }
  }

  async executeCommand(
    sessionId: string,
    command: string,
    options?: { timeoutMs?: number; preventHistory?: boolean }
  ): Promise<ExecuteCommandResponse> {
    try {
      const request: ExecuteCommandRequest = {
        sessionId,
        command,
        timeoutMs: options?.timeoutMs,
        preventHistory: options?.preventHistory,
      };
      const response = await invoke<ExecuteCommandResponse>('terminal_execute', { request });
      return response;
    } catch (error) {
      log.error('Failed to execute command', { sessionId, command, error });
      throw error;
    }
  }

  /**
   * Send a command without waiting for completion or shell integration.
   */
  async sendCommand(sessionId: string, command: string): Promise<void> {
    try {
      const request: SendCommandRequest = {
        sessionId,
        command,
      };
      await invoke('terminal_send_command', { request });
    } catch (error) {
      log.error('Failed to send command', { sessionId, command, error });
      throw error;
    }
  }

  async hasShellIntegration(sessionId: string): Promise<boolean> {
    try {
      const result = await invoke<boolean>('terminal_has_shell_integration', { sessionId });
      return result;
    } catch (error) {
      log.error('Failed to check shell integration', { sessionId, error });
      return false;
    }
  }

  async sendCtrlC(sessionId: string): Promise<void> {
    await this.signal(sessionId, 'SIGINT');
  }

  async sendCtrlD(sessionId: string): Promise<void> {
    await this.write(sessionId, '\x04');
  }

  async sendCtrlZ(sessionId: string): Promise<void> {
    await this.signal(sessionId, 'SIGTSTP');
  }
}

export function getTerminalService(): TerminalService {
  return TerminalService.getInstance();
}

