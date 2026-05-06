import { SnapshotEventBus, SNAPSHOT_EVENTS } from './SnapshotEventBus';
import { SnapshotStateManager } from './SnapshotStateManager';
import { DiffDisplayEngine } from './DiffDisplayEngine';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('SnapshotInitializer');

interface SnapshotSystemStatus {
  initialized: boolean;
  activeSessions: number;
  totalEvents: number;
  lastActivity: number | null;
}

const NOT_INITIALIZED_STATUS: SnapshotSystemStatus = {
  initialized: false,
  activeSessions: 0,
  totalEvents: 0,
  lastActivity: null
};

export class SnapshotInitializer {
  private static initialized = false;
  private static eventBus: SnapshotEventBus;
  private static stateManager: SnapshotStateManager;
  private static diffEngine: DiffDisplayEngine;

  public static async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.eventBus = SnapshotEventBus.getInstance();
      this.stateManager = SnapshotStateManager.getInstance();
      this.diffEngine = new DiffDisplayEngine();

      this.setupSystemEventListeners();
      this.emitInitializedEvent();

      this.initialized = true;
      log.info('Snapshot system initialized');
    } catch (error) {
      log.error('Failed to initialize snapshot system', error);
      throw error;
    }
  }

  private static setupSystemEventListeners(): void {
    this.eventBus.on(SNAPSHOT_EVENTS.SESSION_COMPLETED, (event) => {
      if (event.sessionId) {
        this.stateManager.clearSession(event.sessionId);
      }
    });
  }

  private static emitInitializedEvent(): void {
    this.eventBus.emit(SNAPSHOT_EVENTS.SNAPSHOT_INITIALIZED, {
      timestamp: Date.now(),
      version: '2.0.0'
    });
  }

  private static assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('Snapshot system is not initialized. Call initialize() first.');
    }
  }

  public static isInitialized(): boolean {
    return this.initialized;
  }

  public static getEventBus(): SnapshotEventBus {
    this.assertInitialized();
    return this.eventBus;
  }

  public static getStateManager(): SnapshotStateManager {
    this.assertInitialized();
    return this.stateManager;
  }

  public static getDiffEngine(): DiffDisplayEngine {
    this.assertInitialized();
    return this.diffEngine;
  }

  public static reset(): void {
    if (this.eventBus) {
      this.eventBus.off();
      this.eventBus.clearHistory();
    }

    this.initialized = false;
    log.info('Snapshot system reset');
  }

  public static getSystemStatus(): SnapshotSystemStatus {
    if (!this.initialized) {
      return NOT_INITIALIZED_STATUS;
    }

    const activeSessions = this.stateManager.getActiveSessions();
    const eventHistory = this.eventBus.getEventHistory();
    const lastEvent = eventHistory[eventHistory.length - 1];

    return {
      initialized: true,
      activeSessions: activeSessions.length,
      totalEvents: eventHistory.length,
      lastActivity: lastEvent?.timestamp || null
    };
  }
}
