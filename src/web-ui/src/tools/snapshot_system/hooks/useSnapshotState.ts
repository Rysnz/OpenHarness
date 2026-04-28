import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SnapshotStateManager, SessionState, SnapshotFile } from '../core/SnapshotStateManager';
import { SnapshotEventBus, SNAPSHOT_EVENTS } from '../core/SnapshotEventBus';
import { DiffDisplayEngine, CompactDiffResult, FullDiffResult } from '../core/DiffDisplayEngine';
import SnapshotLazyLoader from '../core/SnapshotLazyLoader';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('useSnapshotState');

type SnapshotActionKind = 'accept' | 'reject';

interface UseSnapshotStateReturn {
  sessionState: SessionState | null;
  files: SnapshotFile[];
  loading: boolean;
  error: string | null;

  refreshSession: () => Promise<void>;
  acceptFile: (filePath: string) => Promise<void>;
  rejectFile: (filePath: string) => Promise<void>;
  acceptSession: () => Promise<void>;
  rejectSession: () => Promise<void>;
  acceptBlock: (filePath: string, blockId: string) => Promise<void>;
  rejectBlock: (filePath: string, blockId: string) => Promise<void>;
  
  getCompactDiff: (filePath: string) => CompactDiffResult | null;
  getFullDiff: (filePath: string) => FullDiffResult | null;
  
  clearError: () => void;
}

function mergeFileState(files: SnapshotFile[], file: SnapshotFile): SnapshotFile[] {
  const index = files.findIndex(candidate => candidate.filePath === file.filePath);

  if (index < 0) {
    return [...files, file];
  }

  const nextFiles = [...files];
  nextFiles[index] = file;
  return nextFiles;
}

export const useSnapshotState = (sessionId?: string): UseSnapshotStateReturn => {
  const { t } = useTranslation('flow-chat');
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [files, setFiles] = useState<SnapshotFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the active session to avoid applying stale events after session switches.
  const activeSessionIdRef = useRef<string | undefined>(sessionId);

  const stateManager = SnapshotStateManager.getInstance();
  const eventBus = SnapshotEventBus.getInstance();
  const diffEngine = useMemo(() => new DiffDisplayEngine(), []);

  const applySessionState = useCallback(() => {
    if (!sessionId) {
      return;
    }

    setSessionState(stateManager.getSessionState(sessionId));
    setFiles(stateManager.getSessionFiles(sessionId));
  }, [sessionId, stateManager]);

  const runSnapshotAction = useCallback(async (
    eventType: string,
    payload: Record<string, unknown>,
    execute: () => Promise<void>,
    logMessage: string,
    errorKey: string,
    filePath?: string
  ) => {
    if (!sessionId) {
      return;
    }

    try {
      setError(null);
      await SnapshotLazyLoader.ensureInitialized();
      eventBus.emit(eventType, payload, sessionId, filePath);
      await execute();
    } catch (err) {
      log.error(logMessage, { sessionId, filePath, error: err, payload });
      setError(t(errorKey));
      throw err;
    }
  }, [eventBus, sessionId, t]);

  const handleFileAction = useCallback(async (filePath: string, action: SnapshotActionKind) => {
    await runSnapshotAction(
      action === 'accept' ? SNAPSHOT_EVENTS.USER_ACCEPT_FILE : SNAPSHOT_EVENTS.USER_REJECT_FILE,
      { filePath },
      () => stateManager.handleUserFileAction(sessionId!, filePath, action),
      `Failed to ${action} file`,
      `snapshotSystem.errors.${action}FileFailed`,
      filePath
    );
  }, [runSnapshotAction, sessionId, stateManager]);

  const handleSessionAction = useCallback(async (action: SnapshotActionKind) => {
    await runSnapshotAction(
      action === 'accept' ? SNAPSHOT_EVENTS.USER_ACCEPT_SESSION : SNAPSHOT_EVENTS.USER_REJECT_SESSION,
      {},
      () => stateManager.handleUserSessionAction(sessionId!, action),
      `Failed to ${action} session`,
      `snapshotSystem.errors.${action}SessionFailed`
    );
  }, [runSnapshotAction, sessionId, stateManager]);

  const handleBlockAction = useCallback(async (
    filePath: string,
    blockId: string,
    action: SnapshotActionKind
  ) => {
    await runSnapshotAction(
      action === 'accept' ? SNAPSHOT_EVENTS.USER_ACCEPT_BLOCK : SNAPSHOT_EVENTS.USER_REJECT_BLOCK,
      { filePath, blockId },
      () => stateManager.handleUserBlockAction(sessionId!, filePath, blockId, action),
      `Failed to ${action} block`,
      `snapshotSystem.errors.${action}BlockFailed`,
      filePath
    );
  }, [runSnapshotAction, sessionId, stateManager]);

  const refreshSession = useCallback(async () => {
    if (!sessionId) return;

    setLoading(true);
    setError(null);
    
    try {
      await SnapshotLazyLoader.ensureInitialized();
      
      await stateManager.refreshSessionState(sessionId);
      applySessionState();
    } catch (err) {
      log.error('Failed to refresh session state', { sessionId, error: err });
      setError(t('snapshotSystem.errors.refreshSessionFailed'));
    } finally {
      setLoading(false);
    }
  }, [applySessionState, sessionId, stateManager, t]);

  const acceptFile = useCallback(async (filePath: string) => {
    await handleFileAction(filePath, 'accept');
  }, [handleFileAction]);

  const rejectFile = useCallback(async (filePath: string) => {
    await handleFileAction(filePath, 'reject');
  }, [handleFileAction]);

  const acceptSession = useCallback(async () => {
    await handleSessionAction('accept');
  }, [handleSessionAction]);

  const rejectSession = useCallback(async () => {
    await handleSessionAction('reject');
  }, [handleSessionAction]);

  const acceptBlock = useCallback(async (filePath: string, blockId: string) => {
    await handleBlockAction(filePath, blockId, 'accept');
  }, [handleBlockAction]);

  const rejectBlock = useCallback(async (filePath: string, blockId: string) => {
    await handleBlockAction(filePath, blockId, 'reject');
  }, [handleBlockAction]);

  const getCompactDiff = useCallback((filePath: string): CompactDiffResult | null => {
    const file = stateManager.getFileState(filePath);
    if (!file) return null;
    
    return diffEngine.generateCompactDiff(file);
  }, [stateManager, diffEngine]);

  const getFullDiff = useCallback((filePath: string): FullDiffResult | null => {
    const file = stateManager.getFileState(filePath);
    if (!file) return null;
    
    return diffEngine.generateFullDiff(file);
  }, [stateManager, diffEngine]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setFiles([]);
      setSessionState(null);
      activeSessionIdRef.current = undefined;
      return;
    }

    activeSessionIdRef.current = sessionId;
    setFiles([]);
    setSessionState(null);

    const unsubscribeSession = stateManager.onSessionStateChange((newSessionState) => {
      if (newSessionState.sessionId === activeSessionIdRef.current) {
        setSessionState(newSessionState);
        setFiles(Array.from(newSessionState.files.values()));
      } else {
        log.debug('Ignoring session state change for different session', { eventSessionId: newSessionState.sessionId, currentSessionId: activeSessionIdRef.current });
      }
    });

    const unsubscribeFile = stateManager.onFileStateChange((file) => {
      if (file.sessionId === activeSessionIdRef.current) {
        setFiles(prev => mergeFileState(prev, file));
      } else {
        log.debug('Ignoring file event for different session', { eventSessionId: file.sessionId, currentSessionId: activeSessionIdRef.current });
      }
    });

    refreshSession();

    return () => {
      unsubscribeSession();
      unsubscribeFile();
    };
  }, [sessionId, stateManager, refreshSession]);

  return {
    sessionState,
    files,
    loading,
    error,
    refreshSession,
    acceptFile,
    rejectFile,
    acceptSession,
    rejectSession,
    acceptBlock,
    rejectBlock,
    getCompactDiff,
    getFullDiff,
    clearError
  };
};
