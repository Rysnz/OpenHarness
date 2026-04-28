/**
 * Snapshot system data hook.
 */

import { useState, useCallback } from 'react';
import { snapshotAPI } from '../../infrastructure/api';
import { createLogger } from '@/shared/utils/logger';
import { useI18n } from '@/infrastructure/i18n';
import { useCurrentWorkspace } from '@/infrastructure/contexts/WorkspaceContext';

const log = createLogger('useSnapshot');

// Data types
export interface AgentInfo {
  agent_type: string;
  model_name: string;
  description?: string;
}

export interface SnapshotSession {
  session_id: string;
  agent_info: AgentInfo;
  start_time: string;
  operations: FileOperation[];
  status: 'Active' | 'Reviewed' | 'PartiallyAccepted' | 'FullyAccepted' | 'RolledBack' | 'Completed';
}

export interface FileOperation {
  operation_id: string;
  operation_type: 'create' | 'modify' | 'delete' | 'rename';
  file_path: string;
  tool_name: string;
  status: 'applied' | 'accepted' | 'rejected';
  timestamp: string;
  diff_summary?: {
    lines_added: number;
    lines_removed: number;
    blocks_changed: number;
  };
}

export interface SnapshotStats {
  git_isolated: boolean;
  total_sessions: number;
  active_sessions: number;
  storage_stats: {
    total_snapshots: number;
    total_size_mb: number;
    oldest_snapshot: string;
  };
}

export interface UseSnapshotReturn {
  // Data state
  sessions: SnapshotSession[];
  operations: FileOperation[];
  stats: SnapshotStats | null;
  
  // Loading state
  loading: boolean;
  error: string | null;
  
  // Actions
  updateSnapshotSession: (session: SnapshotSession) => void;  // Update snapshot session info (called on backend create)
  loadStats: () => Promise<void>;  // Manually refresh stats
  loadSessions: () => Promise<void>;  // Manually refresh sessions
  loadSessionOperations: (sessionId: string) => Promise<FileOperation[]>;
  getOperationDiff: (sessionId: string, filePath: string) => Promise<any>;
  acceptOperation: (sessionId: string, operationId: string) => Promise<void>;
  rejectOperation: (sessionId: string, operationId: string) => Promise<void>;
  rollbackSession: (sessionId: string) => Promise<void>;
  cleanupExpiredData: (maxAgeDays?: number) => Promise<void>;
  
  // Utilities
  clearError: () => void;
}

export const useSnapshot = (): UseSnapshotReturn => {
  const { t } = useI18n('errors');
  const { workspacePath } = useCurrentWorkspace();
  const [sessions, setSessions] = useState<SnapshotSession[]>([]);
  const [operations, setOperations] = useState<FileOperation[]>([]);
  const [stats, setStats] = useState<SnapshotStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workspaceScope = workspacePath || undefined;

  const reportSnapshotError = useCallback((message: string, err: unknown, translationKey: string) => {
    log.error(message, err);
    setError(t(translationKey));
  }, [t]);

  const loadStats = useCallback(async () => {
    try {
      setError(null);
      const statsData = await snapshotAPI.getSnapshotStats(workspaceScope);
      setStats(statsData);
    } catch (err) {
      reportSnapshotError('Failed to load snapshot stats', err, 'snapshot.loadStatsFailed');
      setStats(null);
    }
  }, [reportSnapshotError, workspaceScope]);

  const loadSessions = useCallback(async () => {
    try {
      setError(null);
      const sessionsData = await snapshotAPI.getSnapshotSessions(workspaceScope);
      setSessions(sessionsData || []);
    } catch (err) {
      reportSnapshotError('Failed to load snapshot sessions', err, 'snapshot.loadSessionsFailed');
      setSessions([]);
    }
  }, [reportSnapshotError, workspaceScope]);

  const loadSessionOperations = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      setOperations([]);
      return [];
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const operationsData = await snapshotAPI.getSessionOperations(sessionId, workspaceScope);
      const operations = operationsData || [];
      setOperations(operations);
      return operations;
    } catch (err) {
      reportSnapshotError('Failed to load session operations', err, 'snapshot.loadOperationsFailed');
      setOperations([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [reportSnapshotError, workspaceScope]);

  const reloadAfterMutation = useCallback(async (sessionId?: string) => {
    const refreshes: Promise<unknown>[] = [loadStats(), loadSessions()];

    if (sessionId) {
      refreshes.unshift(loadSessionOperations(sessionId));
    }

    await Promise.all(refreshes);
  }, [loadSessionOperations, loadStats, loadSessions]);

  const getOperationDiff = useCallback(async (sessionId: string, filePath: string) => {
    try {
      setError(null);
      return await snapshotAPI.getOperationDiff(sessionId, filePath, undefined, workspaceScope);
    } catch (err) {
      reportSnapshotError('Failed to get operation diff', err, 'snapshot.getDiffFailed');
      throw err;
    }
  }, [reportSnapshotError, workspaceScope]);

  const runOperationMutation = useCallback(async (
    sessionId: string,
    operation: () => Promise<unknown>,
    logMessage: string,
    errorKey: string
  ) => {
    try {
      setError(null);
      await operation();
      await reloadAfterMutation(sessionId);
    } catch (err) {
      reportSnapshotError(logMessage, err, errorKey);
    }
  }, [reloadAfterMutation, reportSnapshotError]);

  const acceptOperation = useCallback(async (sessionId: string, operationId: string) => {
    await runOperationMutation(
      sessionId,
      () => snapshotAPI.acceptOperation(sessionId, operationId, workspaceScope),
      'Failed to accept operation',
      'snapshot.acceptOperationFailed'
    );
  }, [runOperationMutation, workspaceScope]);

  const rejectOperation = useCallback(async (sessionId: string, operationId: string) => {
    await runOperationMutation(
      sessionId,
      () => snapshotAPI.rejectOperation(sessionId, operationId, workspaceScope),
      'Failed to reject operation',
      'snapshot.rejectOperationFailed'
    );
  }, [runOperationMutation, workspaceScope]);

  const rollbackSession = useCallback(async (sessionId: string) => {
    await runOperationMutation(
      sessionId,
      () => snapshotAPI.rollbackSession(sessionId, workspaceScope),
      'Failed to rollback session',
      'snapshot.rollbackSessionFailed'
    );
  }, [runOperationMutation, workspaceScope]);

  const cleanupExpiredData = useCallback(async (maxAgeDays: number = 30) => {
    try {
      setError(null);
      await snapshotAPI.cleanupSnapshotData(maxAgeDays, workspaceScope);
      await reloadAfterMutation();
    } catch (err) {
      reportSnapshotError('Failed to cleanup expired data', err, 'snapshot.cleanupFailed');
    }
  }, [reloadAfterMutation, reportSnapshotError, workspaceScope]);

  const updateSnapshotSession = useCallback((session: SnapshotSession) => {
    setSessions(prevSessions => {
      const existingIndex = prevSessions.findIndex(s => s.session_id === session.session_id);
      if (existingIndex >= 0) {
        const newSessions = [...prevSessions];
        newSessions[existingIndex] = session;
        return newSessions;
      }

      return [...prevSessions, session];
    });
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Note: snapshot info is returned by the backend on session creation.
  // Call loadStats() and loadSessions() to refresh manually.

  return {
    // Data state
    sessions,
    operations,
    stats,
    
    // Loading state
    loading,
    error,
    
    // Actions
    updateSnapshotSession,  // Use backend snapshot session payload
    loadStats,  // Manual stats refresh
    loadSessions,  // Manual session list refresh
    loadSessionOperations,
    getOperationDiff,
    acceptOperation,
    rejectOperation,
    rollbackSession,
    cleanupExpiredData,
    
    // Utilities
    clearError
  };
};
