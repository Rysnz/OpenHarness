/**
 * FlowChat Cards Component Library
 * Specialized components for displaying tool execution processes and results in FlowChat
 */

import { i18nService } from '@/infrastructure/i18n';

export { BaseToolCard } from './BaseToolCard';
export type { BaseToolCardProps } from './BaseToolCard';

export { SnapshotCard } from './SnapshotCard';
export type { SnapshotCardProps } from './SnapshotCard';

export { SearchCard } from './SearchCard';
export type { SearchCardProps } from './SearchCard';

export { TaskCard } from './TaskCard';
export type { TaskCardProps } from './TaskCard';

export { TodoCard } from './TodoCard';
export type { TodoCardProps, TodoItem } from './TodoCard';

export { WebSearchCard } from './WebSearchCard';
export type { WebSearchCardProps, WebSearchResult } from './WebSearchCard';

export { ContextCompressionCard } from './ContextCompressionCard';
export type { ContextCompressionCardProps } from './ContextCompressionCard';

export interface ToolCardConfig {
  toolName: string;
  displayName: string;
  icon: string;
  requiresConfirmation: boolean;
  resultDisplayType: 'summary' | 'detailed' | 'hidden';
  description: string;
  displayMode: 'compact' | 'standard' | 'detailed' | 'terminal';
  primaryColor: string;
}

type ToolCardPreset = Pick<
  ToolCardConfig,
  'icon' | 'requiresConfirmation' | 'resultDisplayType' | 'displayMode' | 'primaryColor'
>;

function makeToolCardConfig(
  toolName: string,
  translationKey: string,
  preset: ToolCardPreset
): ToolCardConfig {
  const translationRoot = `components:flowChatCards.toolConfig.${translationKey}`;

  return {
    toolName,
    displayName: i18nService.t(`${translationRoot}.displayName`),
    description: i18nService.t(`${translationRoot}.description`),
    ...preset,
  };
}

export const FLOWCHAT_CARD_CONFIGS: Record<string, ToolCardConfig> = {
  'Read': makeToolCardConfig('Read', 'read', {
    icon: 'R',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    displayMode: 'compact',
    primaryColor: '#3b82f6'
  }),
  'Write': makeToolCardConfig('Write', 'write', {
    icon: 'W',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    displayMode: 'standard',
    primaryColor: '#22c55e'
  }),
  'Edit': makeToolCardConfig('Edit', 'edit', {
    icon: 'E',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    displayMode: 'standard',
    primaryColor: '#f59e0b'
  }),
  'Delete': makeToolCardConfig('Delete', 'delete', {
    icon: 'D',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    displayMode: 'detailed',
    primaryColor: '#ef4444'
  }),

  'Grep': makeToolCardConfig('Grep', 'grep', {
    icon: 'G',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    displayMode: 'compact',
    primaryColor: '#8b5cf6'
  }),
  'Glob': makeToolCardConfig('Glob', 'glob', {
    icon: 'F',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    displayMode: 'compact',
    primaryColor: '#06b6d4'
  }),

  'WebSearch': makeToolCardConfig('WebSearch', 'webSearch', {
    icon: 'WS',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    displayMode: 'compact',
    primaryColor: '#0ea5e9'
  }),
  'WebFetch': makeToolCardConfig('WebFetch', 'webFetch', {
    icon: 'WF',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    displayMode: 'standard',
    primaryColor: '#0ea5e9'
  }),

  'Task': makeToolCardConfig('Task', 'task', {
    icon: 'AI',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    displayMode: 'detailed',
    primaryColor: '#7c3aed'
  }),
  'TodoWrite': makeToolCardConfig('TodoWrite', 'todoWrite', {
    icon: 'T',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    displayMode: 'standard',
    primaryColor: '#0d9488'
  }),
  'ContextCompression': makeToolCardConfig('ContextCompression', 'contextCompression', {
    icon: 'CC',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    displayMode: 'standard',
    primaryColor: '#a855f7'
  }),
};

export function getFlowChatCardConfig(toolName: string): ToolCardConfig {
  return FLOWCHAT_CARD_CONFIGS[toolName] || {
    toolName,
    displayName: toolName,
    icon: '•',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: i18nService.t('components:flowChatCards.toolConfig.default.description', { toolName }),
    displayMode: 'standard',
    primaryColor: '#6b7280'
  };
}

export function requiresConfirmation(toolName: string): boolean {
  const config = getFlowChatCardConfig(toolName);
  return config.requiresConfirmation;
}

export function getAllFlowChatCardToolNames(): string[] {
  return Object.keys(FLOWCHAT_CARD_CONFIGS);
}
