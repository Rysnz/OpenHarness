 

import { useState, useEffect, useCallback } from 'react';
import {
  AIRulesAPI,
  type AIRule,
  RuleLevel,
  type RuleStats,
  type CreateRuleRequest,
  type UpdateRuleRequest,
} from '../api/service-api/AIRulesAPI';
import { useCurrentWorkspace } from '../contexts/WorkspaceContext';
import { createLogger } from '@/shared/utils/logger';
import { useI18n } from '@/infrastructure/i18n';

const log = createLogger('useAIRules');

type RuleMutation<T> = () => Promise<T>;

export interface UseAIRulesReturn {
  rules: AIRule[];
  stats: RuleStats | null;

  isLoading: boolean;
  error: string | null;

  createRule: (rule: CreateRuleRequest) => Promise<AIRule>;
  updateRule: (name: string, rule: UpdateRuleRequest) => Promise<AIRule>;
  deleteRule: (name: string) => Promise<boolean>;
  toggleRule: (name: string) => Promise<AIRule>;
  refresh: () => Promise<void>;
}

export function useAIRules(level: RuleLevel): UseAIRulesReturn {
  const { t } = useI18n('errors');
  const { workspacePath } = useCurrentWorkspace();
  const [rules, setRules] = useState<AIRule[]>([]);
  const [stats, setStats] = useState<RuleStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scopedWorkspacePath = level === RuleLevel.Project ? workspacePath || undefined : undefined;

  const loadRules = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await AIRulesAPI.getRules(level, scopedWorkspacePath);
      setRules(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiRules.loadFailed'));
      log.error('Failed to load rules', err);
    } finally {
      setIsLoading(false);
    }
  }, [level, scopedWorkspacePath, t]);

  const loadStats = useCallback(async () => {
    try {
      const data = await AIRulesAPI.getRulesStats(level, scopedWorkspacePath);
      setStats(data);
    } catch (err) {
      log.error('Failed to load stats', err);
    }
  }, [level, scopedWorkspacePath]);

  const reloadRulesAndStats = useCallback(async () => {
    await loadRules();
    await loadStats();
  }, [loadRules, loadStats]);

  const runMutation = useCallback(async <T,>(
    operation: RuleMutation<T>,
    fallbackError: string,
    logMessage: string,
    shouldReload: (result: T) => boolean = () => true
  ): Promise<T> => {
    try {
      setError(null);
      const result = await operation();
      if (shouldReload(result)) {
        await reloadRulesAndStats();
      }
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackError);
      log.error(logMessage, err);
      throw err;
    }
  }, [reloadRulesAndStats]);

  const createRule = useCallback(
    async (request: CreateRuleRequest) => {
      return runMutation(
        () => AIRulesAPI.createRule(level, request, scopedWorkspacePath),
        t('aiRules.createFailed'),
        'Failed to create rule'
      );
    },
    [level, runMutation, scopedWorkspacePath, t]
  );

  const updateRule = useCallback(
    async (name: string, request: UpdateRuleRequest) => {
      return runMutation(
        () => AIRulesAPI.updateRule(level, name, request, scopedWorkspacePath),
        t('aiRules.updateFailed'),
        'Failed to update rule'
      );
    },
    [level, runMutation, scopedWorkspacePath, t]
  );

  const deleteRule = useCallback(
    async (name: string) => {
      return runMutation(
        () => AIRulesAPI.deleteRule(level, name, scopedWorkspacePath),
        t('aiRules.deleteFailed'),
        'Failed to delete rule',
        Boolean
      );
    },
    [level, runMutation, scopedWorkspacePath, t]
  );

  const toggleRule = useCallback(
    async (name: string) => {
      return runMutation(
        () => AIRulesAPI.toggleRule(level, name, scopedWorkspacePath),
        t('aiRules.toggleFailed'),
        'Failed to toggle rule'
      );
    },
    [level, runMutation, scopedWorkspacePath, t]
  );

  const refresh = useCallback(async () => {
    await AIRulesAPI.reloadRules(level, scopedWorkspacePath);
    await reloadRulesAndStats();
  }, [level, reloadRulesAndStats, scopedWorkspacePath]);

  useEffect(() => {
    reloadRulesAndStats();
  }, [reloadRulesAndStats]);

  return {
    rules,
    stats,
    isLoading,
    error,
    createRule,
    updateRule,
    deleteRule,
    toggleRule,
    refresh,
  };
}
