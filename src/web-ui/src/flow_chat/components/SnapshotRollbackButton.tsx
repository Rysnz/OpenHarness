import React, { useCallback, useState } from 'react';
import { AlertCircle, Check, Loader2, RotateCcw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { createLogger } from '@/shared/utils/logger';
import './SnapshotRollbackButton.scss';

const log = createLogger('SnapshotRollbackButton');
const SUCCESS_RESET_MS = 3000;
const ERROR_RESET_MS = 5000;

type RollbackStatus = 'idle' | 'success' | 'error';

export interface SnapshotRollbackButtonProps {
  sessionId: string;
  turnIndex: number;
  turnId: string;
  isCurrentTurn?: boolean;
  onRollbackSuccess?: () => void;
  onRollbackError?: (error: string) => void;
}

export const SnapshotRollbackButton: React.FC<SnapshotRollbackButtonProps> = ({
  sessionId,
  turnIndex,
  turnId,
  isCurrentTurn = false,
  onRollbackSuccess,
  onRollbackError,
}) => {
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [rollbackStatus, setRollbackStatus] = useState<RollbackStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const resetRollbackStatus = useCallback(() => {
    setRollbackStatus('idle');
    setErrorMessage('');
  }, []);

  const scheduleStatusReset = useCallback(
    (delay: number) => {
      setTimeout(resetRollbackStatus, delay);
    },
    [resetRollbackStatus],
  );

  const handleRollback = useCallback(async () => {
    if (isRollingBack || isCurrentTurn) return;

    try {
      beginRollback(setIsRollingBack, resetRollbackStatus);
      log.debug('Starting rollback', { sessionId, turnIndex, turnId });

      await invoke('rollback_to_turn', {
        sessionId,
        turnIndex,
      });

      setRollbackStatus('success');
      onRollbackSuccess?.();
      scheduleStatusReset(SUCCESS_RESET_MS);
    } catch (error) {
      log.error('Rollback failed', { sessionId, turnIndex, turnId, error });
      const errorMsg = errorToMessage(error);
      setErrorMessage(errorMsg);
      setRollbackStatus('error');
      onRollbackError?.(errorMsg);
      scheduleStatusReset(ERROR_RESET_MS);
    } finally {
      setIsRollingBack(false);
    }
  }, [
    isCurrentTurn,
    isRollingBack,
    onRollbackError,
    onRollbackSuccess,
    resetRollbackStatus,
    scheduleStatusReset,
    sessionId,
    turnId,
    turnIndex,
  ]);

  if (isCurrentTurn) {
    return <RollbackStateLabel className="snapshot-rollback-button--current" icon={<Check size={14} />} label="Current code state" />;
  }

  if (rollbackStatus === 'success') {
    return (
      <RollbackStateLabel
        className="snapshot-rollback-button--success"
        icon={<Check size={14} />}
        label="Rolled back to this turn"
      />
    );
  }

  if (rollbackStatus === 'error') {
    return (
      <RollbackStateLabel
        className="snapshot-rollback-button--error"
        icon={<AlertCircle size={14} />}
        label="Rollback failed"
        title={errorMessage}
      />
    );
  }

  return (
    <button
      className={`snapshot-rollback-button ${isRollingBack ? 'snapshot-rollback-button--loading' : ''}`}
      onClick={handleRollback}
      disabled={isRollingBack}
      title={`Rollback to code state at turn ${turnIndex + 1}`}
    >
      <RollbackButtonContent isRollingBack={isRollingBack} />
    </button>
  );
};

interface RollbackStateLabelProps {
  className: string;
  icon: React.ReactNode;
  label: string;
  title?: string;
}

const RollbackStateLabel: React.FC<RollbackStateLabelProps> = ({
  className,
  icon,
  label,
  title,
}) => (
  <div className={`snapshot-rollback-button ${className}`} title={title}>
    {icon}
    <span>{label}</span>
  </div>
);

const RollbackButtonContent: React.FC<{ isRollingBack: boolean }> = ({ isRollingBack }) =>
  isRollingBack ? (
    <>
      <Loader2 size={14} className="snapshot-rollback-button__spinner" />
      <span>Rolling back...</span>
    </>
  ) : (
    <>
      <RotateCcw size={14} />
      <span>Rollback to this turn</span>
    </>
  );

function beginRollback(
  setIsRollingBack: React.Dispatch<React.SetStateAction<boolean>>,
  resetRollbackStatus: () => void,
): void {
  setIsRollingBack(true);
  resetRollbackStatus();
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
