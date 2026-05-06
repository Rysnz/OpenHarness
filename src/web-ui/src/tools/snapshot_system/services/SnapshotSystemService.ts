import { snapshotAPI } from '../../../infrastructure/api';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('SnapshotSystemService');

const FILE_OPERATION_TOOLS = ['Write', 'Edit', 'Delete'] as const;

interface SessionStats {
  session_id: string;
  total_files: number;
  total_turns: number;
  total_changes: number;
}

interface OperationDiff {
  originalCode: string;
  modifiedCode: string;
  filePath: string;
}

export class SnapshotSystemService {
  private static instance: SnapshotSystemService;

  private constructor() {}

  public static getInstance(): SnapshotSystemService {
    if (!SnapshotSystemService.instance) {
      SnapshotSystemService.instance = new SnapshotSystemService();
    }
    return SnapshotSystemService.instance;
  }

  async getSessionStats(sessionId: string): Promise<SessionStats> {
    return this.withSnapshotLog('Failed to get session stats', { sessionId }, () =>
      snapshotAPI.getSessionStats(sessionId),
    );
  }

  async getOperationDiff(sessionId: string, filePath: string): Promise<OperationDiff> {
    return this.withSnapshotLog('Failed to get operation diff', { sessionId, filePath }, async () => {
      const result = await snapshotAPI.getOperationDiff(sessionId, filePath);
      return {
        originalCode: result.originalContent || '',
        modifiedCode: result.modifiedContent || '',
        filePath: result.filePath || filePath,
      };
    });
  }

  async acceptSessionModifications(sessionId: string): Promise<void> {
    return this.withSnapshotLog('Failed to accept session modifications', { sessionId }, () =>
      snapshotAPI.acceptSessionModifications(sessionId),
    );
  }

  async rejectSessionModifications(sessionId: string): Promise<void> {
    return this.withSnapshotLog('Failed to reject session modifications', { sessionId }, () =>
      snapshotAPI.rejectSessionModifications(sessionId),
    );
  }

  async acceptFileModifications(sessionId: string, filePath: string): Promise<void> {
    return this.withSnapshotLog('Failed to accept file modifications', { sessionId, filePath }, () =>
      snapshotAPI.acceptFileModifications(sessionId, filePath),
    );
  }

  async rejectFileModifications(sessionId: string, filePath: string): Promise<void> {
    return this.withSnapshotLog('Failed to reject file modifications', { sessionId, filePath }, () =>
      snapshotAPI.rejectFileModifications(sessionId, filePath),
    );
  }

  async acceptDiffBlock(sessionId: string, filePath: string, blockId: string): Promise<void> {
    return this.withSnapshotLog('Failed to accept diff block', { sessionId, filePath, blockId }, () =>
      snapshotAPI.acceptDiffBlock(sessionId, filePath, parseBlockId(blockId)),
    );
  }

  async rejectDiffBlock(sessionId: string, filePath: string, blockId: string): Promise<void> {
    return this.withSnapshotLog('Failed to reject diff block', { sessionId, filePath, blockId }, () =>
      snapshotAPI.rejectDiffBlock(sessionId, filePath, parseBlockId(blockId)),
    );
  }

  isFileOperationTool(toolName: string): boolean {
    return (FILE_OPERATION_TOOLS as readonly string[]).includes(toolName);
  }

  private async withSnapshotLog<T>(
    message: string,
    context: Record<string, unknown>,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      log.error(message, { ...context, error });
      throw error;
    }
  }
}

function parseBlockId(blockId: string): number {
  return parseInt(blockId, 10);
}
