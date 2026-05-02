/**
 * Simplified processing status manager
 * Manages basic processing status display
 */

import { createLogger } from '@/shared/utils/logger';

const log = createLogger('ProcessingStatusManager');
const COMPLETED_HISTORY_LIMIT = 10;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const STALE_STATUS_TIMEOUT_MS = 5 * 60 * 1000;

export interface ProcessingStatus {
  id: string;
  sessionId: string;
  status: 'thinking' | 'analyzing' | 'processing' | 'executing' | 'generating' | 'completing';
  message: string;
  progress?: number;
  startTime: number;
  metadata?: Record<string, any>;
}

export interface ProcessingStatusListener {
  (statuses: ProcessingStatus[]): void;
}

function isCompletedStatus(status: ProcessingStatus): boolean {
  return status.status === 'completing' ||
    status.message.includes('completed') ||
    status.message.includes('success') ||
    status.metadata?.isCompleted === true;
}

function minDisplayTimeFor(status: ProcessingStatus): number {
  switch (status.status) {
    case 'thinking':
    case 'analyzing':
    case 'generating':
      return 2500;
    case 'processing':
    case 'executing':
      return 3000;
    case 'completing':
      return 1500;
    default:
      return 2000;
  }
}

export class ProcessingStatusManager {
  private statuses: Map<string, ProcessingStatus> = new Map();
  private completedStatuses: ProcessingStatus[] = [];
  private listeners: Set<ProcessingStatusListener> = new Set();
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

  registerStatus(status: Omit<ProcessingStatus, 'id' | 'startTime'>): string {
    const id = this.generateId();
    const fullStatus: ProcessingStatus = {
      ...status,
      id,
      startTime: Date.now()
    };

    this.statuses.set(id, fullStatus);
    this.notifyListeners();
    
    return id;
  }

  updateStatus(id: string, updates: Partial<ProcessingStatus>): void {
    const existing = this.statuses.get(id);
    if (!existing) {
      log.warn('Status ID not found', { id });
      return;
    }

    const updated = { ...existing, ...updates };
    this.statuses.set(id, updated);
    this.notifyListeners();
  }

  removeStatus(id: string): void {
    const status = this.statuses.get(id);
    if (!status) {
      log.warn('Attempted to remove non-existent status', { id });
      return;
    }

    if (isCompletedStatus(status)) {
      this.rememberCompletedStatus(status);
    }

    const minDisplayTime = minDisplayTimeFor(status);
    const elapsedTime = Date.now() - status.startTime;
    
    if (elapsedTime < minDisplayTime) {
      const delay = minDisplayTime - elapsedTime;
      
      this.removeAfterDelay(id, delay);
    } else {
      this.statuses.delete(id);
      this.notifyListeners();
    }
  }

  clearSessionStatus(sessionId: string): void {
    let hasChanges = false;
    for (const [id, status] of this.statuses.entries()) {
      if (status.sessionId === sessionId) {
        this.statuses.delete(id);
        hasChanges = true;
      }
    }
    
    if (hasChanges) {
      this.notifyListeners();
    }
  }

  getAllStatuses(): ProcessingStatus[] {
    return Array.from(this.statuses.values()).sort((a, b) => a.startTime - b.startTime);
  }

  getSessionStatuses(sessionId: string): ProcessingStatus[] {
    return this.getAllStatuses().filter(status => status.sessionId === sessionId);
  }

  hasActiveStatus(): boolean {
    return this.statuses.size > 0;
  }

  getCurrentMainStatus(): ProcessingStatus | null {
    const statuses = this.getAllStatuses();
    return statuses.length > 0 ? statuses[statuses.length - 1] : null;
  }

  addListener(listener: ProcessingStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getAllStatuses());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const statuses = this.getAllStatuses();
    this.listeners.forEach(listener => {
      try {
        listener(statuses);
      } catch (error) {
        log.error('Listener execution error', error);
      }
    });
  }

  private generateId(): string {
    return `status_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private rememberCompletedStatus(status: ProcessingStatus): void {
    this.completedStatuses = [status, ...this.completedStatuses].slice(0, COMPLETED_HISTORY_LIMIT);
  }

  private removeAfterDelay(id: string, delay: number): void {
    setTimeout(() => {
      if (this.statuses.has(id)) {
        this.statuses.delete(id);
        this.notifyListeners();
      }
    }, delay);
  }

  clearAll(): void {
    this.statuses.clear();
    this.notifyListeners();
  }

  getCompletedSteps(): ProcessingStatus[] {
    return [...this.completedStatuses];
  }

  clearCompletedHistory(): void {
    this.completedStatuses = [];
  }

  startCleanupTimer(): void {
    if (this.cleanupIntervalId !== null) return;
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupOldStatuses();
    }, CLEANUP_INTERVAL_MS);
  }

  stopCleanupTimer(): void {
    if (this.cleanupIntervalId !== null) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  cleanupOldStatuses(): void {
    const now = Date.now();
    
    let hasChanges = false;
    for (const [id, status] of this.statuses.entries()) {
      if (now - status.startTime > STALE_STATUS_TIMEOUT_MS) {
        this.statuses.delete(id);
        hasChanges = true;
      }
    }
    
    if (hasChanges) {
      this.notifyListeners();
    }
  }

}

export const processingStatusManager = new ProcessingStatusManager();

processingStatusManager.startCleanupTimer();
