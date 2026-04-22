import type { FlowItem, FlowToolItem } from '../types/flow-chat';

/**
 * Collapsible explorer tools (only these 5).
 * They are auto-collapsed during streaming to reduce visual noise.
 */
export const COLLAPSIBLE_TOOL_NAMES = new Set([
  'Read', 'LS', 'Grep', 'Glob', 'WebSearch'
]);

/** Read tools (counted in readCount). */
export const READ_TOOL_NAMES = new Set(['Read', 'LS']);

/** Search tools (counted in searchCount). */
export const SEARCH_TOOL_NAMES = new Set(['Grep', 'Glob', 'WebSearch']);

/** Check whether a tool is collapsible. */
export function isCollapsibleTool(toolName: string): boolean {
  return COLLAPSIBLE_TOOL_NAMES.has(toolName);
}

/**
 * Check whether a FlowItem is collapsible (no context).
 * - Subagent items are never collapsed.
 * - Text needs context (use isCollapsibleItemWithContext).
 * - Thinking can be collapsed with explorer tools.
 * - Only the 5 explorer tools are collapsible.
 */
export function isCollapsibleItem(item: FlowItem): boolean {
  if ((item as any).isSubagentItem) return false;
  if (item.type === 'text') return false;
  if (item.type === 'thinking') return true;

  if (item.type === 'tool') {
    return isCollapsibleTool((item as FlowToolItem).toolName);
  }

  return false;
}

/**
 * Check whether a FlowItem is collapsible with context.
 */
export function isCollapsibleItemWithContext(
  item: FlowItem,
  nextItem: FlowItem | undefined,
  isLast: boolean
): boolean {
  if ((item as any).isSubagentItem) return false;

  if (item.type === 'text' || item.type === 'thinking') {
    if (isLast || !nextItem) return false;

    if (nextItem.type === 'tool') {
      return isCollapsibleTool((nextItem as FlowToolItem).toolName);
    }

    if (nextItem.type === 'text' || nextItem.type === 'thinking') {
      return true;
    }

    return false;
  }

  if (item.type === 'tool') {
    return isCollapsibleTool((item as FlowToolItem).toolName);
  }

  return false;
}
