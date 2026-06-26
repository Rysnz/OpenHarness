import { api } from './ApiClient';
import { createTauriCommandError } from '@/infrastructure/api/errors/TauriCommandError';

export interface MemorySearchResult {
  id: string;
  tier: string;
  content: string;
  importance: number;
  score: number;
  sessionId: string;
  agentName: string;
  createdAt: string;
  tags: string[];
}

export interface MemorySearchResponse {
  results: MemorySearchResult[];
  count: number;
}

export interface MemorySessionSummary {
  sessionId: string;
  agentName: string;
  summary: string;
  totalTools: number;
  files: string[];
  toolsUsed: string[];
  startedAt: string;
  endedAt: string;
}

export interface MemoryStatsResponse {
  workingCount: number;
  episodicCount: number;
  semanticCount: number;
  proceduralCount: number;
  sessionCount: number;
}

export class MemoryAPI {
  async search(
    workspacePath: string,
    query: string,
    topK?: number
  ): Promise<MemorySearchResponse> {
    try {
      return await api.invoke('memory_search', {
        request: { workspace_path: workspacePath, query, top_k: topK },
      });
    } catch (error) {
      throw createTauriCommandError('memory_search', error);
    }
  }

  async save(
    workspacePath: string,
    content: string,
    importance?: number,
    tags?: string[]
  ): Promise<{ success: boolean; id: string }> {
    try {
      return await api.invoke('memory_save', {
        request: {
          workspace_path: workspacePath,
          content,
          importance,
          tags,
        },
      });
    } catch (error) {
      throw createTauriCommandError('memory_save', error);
    }
  }

  async sessions(workspacePath: string): Promise<MemorySessionSummary[]> {
    try {
      return await api.invoke('memory_sessions', {
        workspace_path: workspacePath,
      });
    } catch (error) {
      throw createTauriCommandError('memory_sessions', error);
    }
  }

  async stats(workspacePath: string): Promise<MemoryStatsResponse> {
    try {
      return await api.invoke('memory_stats', {
        workspace_path: workspacePath,
      });
    } catch (error) {
      throw createTauriCommandError('memory_stats', error);
    }
  }

  async delete(
    workspacePath: string,
    entryId: string,
    tier: string
  ): Promise<boolean> {
    try {
      return await api.invoke('memory_delete', {
        request: {
          workspace_path: workspacePath,
          entry_id: entryId,
          tier,
        },
      });
    } catch (error) {
      throw createTauriCommandError('memory_delete', error);
    }
  }
}

export const memoryAPI = new MemoryAPI();
