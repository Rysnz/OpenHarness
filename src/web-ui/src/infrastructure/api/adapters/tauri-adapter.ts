import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ITransportAdapter } from './base';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('TauriAdapter');

type InvokeFunction = (action: string, params?: any) => Promise<any>;

export class TauriTransportAdapter implements ITransportAdapter {
  private unlistenFunctions: UnlistenFn[] = [];
  private connected = false;
  private invokeFn: InvokeFunction | null = null;
  private initPromise: Promise<void> | null = null;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async request<T>(action: string, params?: any): Promise<T> {
    await this.ensureConnected();
    await this.ensureInitialized();

    try {
      return (await this.invoke(action, params)) as T;
    } catch (error) {
      log.error('Request failed', { action, error });
      throw error;
    }
  }

  listen<T>(event: string, callback: (data: T) => void): () => void {
    let unlistenFn: UnlistenFn | null = null;
    let isUnlistened = false;

    void listen<T>(event, (payloadEvent) => {
      if (!isUnlistened) {
        this.safeRunEventCallback(event, callback, payloadEvent.payload);
      }
    })
      .then((fn) => {
        if (isUnlistened) {
          fn();
          return;
        }

        unlistenFn = fn;
        this.unlistenFunctions.push(fn);
      })
      .catch((error) => {
        log.error('Failed to listen event', { event, error });
      });

    return () => {
      isUnlistened = true;
      if (unlistenFn) {
        this.unregisterListener(unlistenFn);
      }
    };
  }

  async disconnect(): Promise<void> {
    this.unlistenFunctions.forEach((fn) => this.safeUnlisten(fn));
    this.unlistenFunctions = [];
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.invokeFn) {
      return;
    }

    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }

    await this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      if (!isTauriRuntime()) {
        log.warn('Tauri API not available, running in non-Tauri environment');
        this.invokeFn = createUnavailableInvoke();
        return;
      }

      const tauriApi = await import('@tauri-apps/api/core');
      this.invokeFn = tauriApi.invoke;
      log.debug('Tauri API initialized successfully');
    } catch (error) {
      log.error('Failed to load Tauri API', error);
      this.invokeFn = createFailedInvoke(error);
    }
  }

  private async invoke(action: string, params?: any): Promise<any> {
    if (!this.invokeFn) {
      throw new Error('Tauri invoke function not initialized');
    }

    return params !== undefined ? this.invokeFn(action, params) : this.invokeFn(action);
  }

  private safeRunEventCallback<T>(
    event: string,
    callback: (data: T) => void,
    payload: T,
  ): void {
    try {
      callback(payload);
    } catch (error) {
      log.error('Error in event listener callback', { event, error });
    }
  }

  private unregisterListener(unlistenFn: UnlistenFn): void {
    this.safeUnlisten(unlistenFn);
    this.unlistenFunctions = this.unlistenFunctions.filter((fn) => fn !== unlistenFn);
  }

  private safeUnlisten(unlistenFn: UnlistenFn): void {
    try {
      unlistenFn();
    } catch (error) {
      log.error('Error while unlistening', error);
    }
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

function createUnavailableInvoke(): InvokeFunction {
  return async () => {
    throw new Error('Tauri API is not available. Make sure you are running in a Tauri environment.');
  };
}

function createFailedInvoke(error: unknown): InvokeFunction {
  return async () => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to load Tauri API: ${message}`);
  };
}
