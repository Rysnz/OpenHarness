 

import { contextAPI } from '../../api';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('ContextManager');

export type { ContextStats, SessionMetadata, StorageStats } from '../../api/service-api/ContextAPI';
import type { ContextStats, SessionMetadata, StorageStats } from '../../api/service-api/ContextAPI';

type SessionPayload = unknown;

async function runContextOperation<T>(
  failureMessage: string,
  operation: () => Promise<T>,
  logContext?: Record<string, unknown>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    log.error(failureMessage, logContext ? { ...logContext, error } : error);
    throw new Error(`${failureMessage}: ${error}`);
  }
}

export class ContextManager {
  async compressContext(): Promise<string> {
    return runContextOperation('Context compression failed', () => contextAPI.compressContext());
  }

  async getContextStats(): Promise<ContextStats> {
    return runContextOperation('Failed to get context stats', () => contextAPI.getContextStats());
  }

  async clearContext(): Promise<string> {
    return runContextOperation('Context clear failed', () => contextAPI.clearContext());
  }

  async saveSessionData(sessionData: SessionPayload): Promise<string> {
    return runContextOperation('Session save failed', () => contextAPI.saveSessionData(sessionData));
  }

  async loadSessionData(sessionId: string): Promise<SessionPayload> {
    return runContextOperation('Session load failed', () => contextAPI.loadSessionData(sessionId), {
      sessionId,
    });
  }

  async listSessions(includeArchived: boolean = false): Promise<SessionMetadata[]> {
    return runContextOperation(
      'Failed to list sessions',
      () => contextAPI.listSessions(includeArchived),
      { includeArchived },
    );
  }

  async searchSessions(query: string, tags?: string[]): Promise<SessionMetadata[]> {
    return runContextOperation('Failed to search sessions', () => contextAPI.searchSessions(query, tags), {
      query,
      tags,
    });
  }

  async deleteSession(sessionId: string): Promise<string> {
    return runContextOperation('Failed to delete session', () => contextAPI.deleteSession(sessionId), {
      sessionId,
    });
  }

  async archiveSession(sessionId: string): Promise<string> {
    return runContextOperation('Failed to archive session', () => contextAPI.archiveSession(sessionId), {
      sessionId,
    });
  }

  async exportSession(sessionId: string, exportPath: string): Promise<string> {
    return runContextOperation(
      'Failed to export session',
      () => contextAPI.exportSession(sessionId, exportPath),
      { sessionId, exportPath },
    );
  }

  async importSession(importPath: string): Promise<string> {
    return runContextOperation('Failed to import session', () => contextAPI.importSession(importPath), {
      importPath,
    });
  }

  async getStorageStats(): Promise<StorageStats> {
    return runContextOperation('Failed to get storage stats', () => contextAPI.getStorageStats());
  }
}

export const contextManager = new ContextManager();

