import { SnapshotFile, DiffBlock } from './SnapshotStateManager';

const STRUCTURAL_KEYWORDS = [
  'function',
  'class',
  'interface',
  'import',
  'export',
  'const',
  'let',
  'var',
  'if',
  'for',
  'while',
];

type ChangeSummary = CompactDiffResult['summary'];

interface FileStats {
  totalBlocks: number;
  criticalBlocks: number;
  pendingBlocks: number;
  acceptedBlocks: number;
  rejectedBlocks: number;
}

export interface CompactDiffResult {
  filePath: string;
  criticalBlocks: DiffBlock[];
  totalBlocks: number;
  summary: {
    additions: number;
    deletions: number;
    modifications: number;
  };
}

export interface FullDiffResult {
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  diffBlocks: DiffBlock[];
  contextLines: string[];
  navigation: BlockNavigation[];
}

export interface BlockNavigation {
  blockId: string;
  type: 'added' | 'removed' | 'modified';
  status: 'pending' | 'accepted' | 'rejected';
  lineNumber: number;
  description: string;
}

function changedLineCount(block: DiffBlock): number {
  return Math.abs(block.originalEndLine - block.originalStartLine + 1);
}

function hasAnyKeyword(content: string, keywords: string[]): boolean {
  const normalizedContent = content.toLowerCase();
  return keywords.some(keyword => normalizedContent.includes(keyword));
}

export class BlockPriorityAnalyzer {
  filterCriticalBlocks(blocks: DiffBlock[]): DiffBlock[] {
    return blocks.filter(block => this.shouldPromoteBlock(block));
  }

  analyzePriority(block: DiffBlock): 'critical' | 'important' | 'minor' {
    if (hasAnyKeyword(block.modifiedContent, ['function', 'class', 'interface'])) {
      return 'critical';
    }

    if (hasAnyKeyword(block.modifiedContent, ['import', 'export', 'if', 'for', 'while'])) {
      return 'important';
    }

    if (changedLineCount(block) > 10) {
      return 'important';
    }

    return 'minor';
  }

  private shouldPromoteBlock(block: DiffBlock): boolean {
    if (block.priority === 'critical' || block.priority === 'important') {
      return true;
    }

    return changedLineCount(block) > 5 || hasAnyKeyword(block.modifiedContent, STRUCTURAL_KEYWORDS);
  }
}

export class DiffDisplayEngine {
  private readonly blockPriorityAnalyzer: BlockPriorityAnalyzer;

  constructor() {
    this.blockPriorityAnalyzer = new BlockPriorityAnalyzer();
  }

  generateCompactDiff(file: SnapshotFile): CompactDiffResult {
    const diffBlocks = file.diffBlocks || [];
    const criticalBlocks = this.blockPriorityAnalyzer.filterCriticalBlocks(diffBlocks);
    
    const summary = this.calculateSummary(diffBlocks);

    return {
      filePath: file.filePath,
      criticalBlocks,
      totalBlocks: diffBlocks.length,
      summary,
    };
  }

  generateFullDiff(file: SnapshotFile): FullDiffResult {
    const diffBlocks = file.diffBlocks || [];
    const contextLines = this.generateContextLines(file);
    const navigation = this.generateBlockNavigation(diffBlocks);

    return {
      filePath: file.filePath,
      originalContent: file.originalContent,
      modifiedContent: file.modifiedContent,
      diffBlocks,
      contextLines,
      navigation,
    };
  }

  private calculateSummary(blocks: DiffBlock[]): ChangeSummary {
    return blocks.reduce<ChangeSummary>((summary, block) => {
      switch (block.type) {
        case 'added':
          summary.additions += block.modifiedEndLine - block.modifiedStartLine + 1;
          break;
        case 'removed':
          summary.deletions += block.originalEndLine - block.originalStartLine + 1;
          break;
        case 'modified':
          summary.modifications += Math.max(
            block.originalEndLine - block.originalStartLine + 1,
            block.modifiedEndLine - block.modifiedStartLine + 1
          );
          break;
      }
      return summary;
    }, { additions: 0, deletions: 0, modifications: 0 });
  }

  private generateContextLines(file: SnapshotFile): string[] {
    // treat original file lines as "context".
    return file.originalContent.split('\n');
  }

  private generateBlockNavigation(blocks: DiffBlock[]): BlockNavigation[] {
    return blocks.map(block => ({
      blockId: block.id,
      type: block.type,
      status: block.status,
      lineNumber: block.originalStartLine,
      description: this.generateBlockDescription(block),
    }));
  }

  private generateBlockDescription(block: DiffBlock): string {
    const actionByType: Record<DiffBlock['type'], string> = {
      added: 'Added',
      removed: 'Removed',
      modified: 'Modified',
    };
    return `${actionByType[block.type] ?? 'Changed'} ${changedLineCount(block)} lines`;
  }

  generateDiffForMode(file: SnapshotFile, mode: 'compact' | 'full'): CompactDiffResult | FullDiffResult {
    return mode === 'compact'
      ? this.generateCompactDiff(file)
      : this.generateFullDiff(file);
  }

  hasCriticalChanges(file: SnapshotFile): boolean {
    const diffBlocks = file.diffBlocks || [];
    const criticalBlocks = this.blockPriorityAnalyzer.filterCriticalBlocks(diffBlocks);
    return criticalBlocks.length > 0;
  }

  getFileStats(file: SnapshotFile): FileStats {
    const diffBlocks = file.diffBlocks || [];
    const criticalBlocks = this.blockPriorityAnalyzer.filterCriticalBlocks(diffBlocks);
    const countByStatus = (status: DiffBlock['status']) =>
      diffBlocks.filter(block => block.status === status).length;

    const stats: FileStats = {
      totalBlocks: diffBlocks.length,
      criticalBlocks: criticalBlocks.length,
      pendingBlocks: countByStatus('pending'),
      acceptedBlocks: countByStatus('accepted'),
      rejectedBlocks: countByStatus('rejected'),
    };
    return stats;
  }
}
