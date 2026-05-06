import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { snapshotAPI } from '@/infrastructure/api';
import type { TurnSnapshot } from '@/infrastructure/api/service-api/SnapshotAPI';
import { TurnRollbackButton } from './TurnRollbackButton';
import { createLogger } from '@/shared/utils/logger';
import './TurnHistoryPanel.scss';

const log = createLogger('TurnHistoryPanel');
const PREVIEW_FILE_LIMIT = 3;

interface TurnHistoryPanelProps {
  sessionId: string;
}

export const TurnHistoryPanel: React.FC<TurnHistoryPanelProps> = ({ sessionId }) => {
  const [turns, setTurns] = useState<TurnSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentTurnIndex, setCurrentTurnIndex] = useState<number>(-1);

  const loadTurns = useCallback(async () => {
    if (!sessionId) return;

    setLoading(true);
    try {
      const turnList = await snapshotAPI.getSessionTurnSnapshots(sessionId);
      setTurns(turnList);
      setCurrentTurnIndex(turnList.length > 0 ? turnList.length - 1 : -1);
    } catch (error) {
      log.error('Failed to load turn snapshots', { sessionId, error });
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadTurns();
  }, [loadTurns]);

  const handleRollbackComplete = useCallback(() => {
    void loadTurns();
  }, [loadTurns]);

  const currentTurnKey = useMemo(
    () => {
      const currentTurn = turns[currentTurnIndex];
      return currentTurn ? turnKey(currentTurn) : null;
    },
    [currentTurnIndex, turns],
  );

  if (loading) {
    return <div className="turn-history-panel-loading">Loading...</div>;
  }

  if (turns.length === 0) {
    return (
      <div className="turn-history-panel-empty">
        <p>No turn history available.</p>
        <p className="hint">A snapshot is created after each AI response.</p>
      </div>
    );
  }

  return (
    <div className="turn-history-panel">
      <div className="turn-history-header">
        <h3>Session history</h3>
        <span className="turn-count">{turns.length} turns</span>
      </div>

      <div className="turn-history-list">
        {turns.map((turn, index) => {
          const isCurrent = turnKey(turn) === currentTurnKey;
          return (
            <TurnHistoryItem
              key={turnKey(turn)}
              turn={turn}
              displayIndex={index + 1}
              isCurrent={isCurrent}
              onRollbackComplete={handleRollbackComplete}
            />
          );
        })}
      </div>
    </div>
  );
};

interface TurnHistoryItemProps {
  turn: TurnSnapshot;
  displayIndex: number;
  isCurrent: boolean;
  onRollbackComplete: () => void;
}

const TurnHistoryItem: React.FC<TurnHistoryItemProps> = ({
  turn,
  displayIndex,
  isCurrent,
  onRollbackComplete,
}) => (
  <div className={`turn-history-item ${isCurrent ? 'current' : ''}`}>
    <div className="turn-item-header">
      <span className="turn-index">Turn {displayIndex}</span>
      <TurnRollbackButton
        sessionId={turn.sessionId}
        turnIndex={turn.turnIndex}
        isCurrent={isCurrent}
        onRollbackComplete={onRollbackComplete}
      />
    </div>

    {turn.modifiedFiles.length > 0 && <ModifiedFilesPreview files={turn.modifiedFiles} />}

    <div className="turn-item-time">{formatTurnTimestamp(turn.timestamp)}</div>
  </div>
);

const ModifiedFilesPreview: React.FC<{ files: string[] }> = ({ files }) => {
  const visibleFiles = files.slice(0, PREVIEW_FILE_LIMIT);
  const hiddenFileCount = files.length - visibleFiles.length;

  return (
    <div className="turn-item-files">
      <span className="files-label">Modified files:</span>
      <ul className="files-list">
        {visibleFiles.map((file, index) => (
          <li key={`${file}-${index}`} className="file-item">
            {file}
          </li>
        ))}
        {hiddenFileCount > 0 && <li className="file-item-more">{hiddenFileCount} more files...</li>}
      </ul>
    </div>
  );
};

function turnKey(turn: TurnSnapshot): string {
  return `${turn.sessionId}-${turn.turnIndex}`;
}

function formatTurnTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}
