import { createLogger } from '@/shared/utils/logger';
import { FlowChatStore } from '../../store/FlowChatStore';
import type { FlowThinkingItem } from '../../types/flow-chat';
import type { ToolEventData } from '../EventBatcher';
import { processToolEvent } from './ToolEventModule';
import type { FlowChatContext, FlowTextItem, SubagentTextChunkData, SubagentToolEventData } from './types';

const log = createLogger('SubagentModule');

type SubagentRenderableItem = FlowTextItem | FlowThinkingItem;

interface ParentToolLocation {
  turnId: string;
  timestamp: number;
}

function findParentTurnId(parentSessionId: string, parentToolId: string, reason: string): string | null {
  const store = FlowChatStore.getInstance();
  const parentSession = store.getState().sessions.get(parentSessionId);

  if (!parentSession) {
    log.debug(`Parent session not found (${reason})`, { parentSessionId });
    return null;
  }

  for (const turn of parentSession.dialogTurns) {
    const hasParentTool = turn.modelRounds.some((round) =>
      round.items.some((item) => item.id === parentToolId)
    );
    if (hasParentTool) {
      return turn.id;
    }
  }

  log.debug('Parent tool DialogTurn not found', { parentSessionId, parentToolId });
  return null;
}

function resolveParentToolLocation(
  parentSessionId: string,
  parentToolId: string,
  reason: string
): ParentToolLocation | null {
  const store = FlowChatStore.getInstance();
  const turnId = findParentTurnId(parentSessionId, parentToolId, reason);
  if (!turnId) {
    return null;
  }

  return {
    turnId,
    timestamp: store.findToolItem(parentSessionId, turnId, parentToolId)?.timestamp || Date.now(),
  };
}

function subagentItemId(parentToolId: string, data: SubagentTextChunkData): string {
  const itemPrefix = data.contentType === 'thinking' ? 'subagent-thinking' : 'subagent-text';
  return `${itemPrefix}-${parentToolId}-${data.sessionId}-${data.roundId}`;
}

function findExistingSubagentItem(
  parentSessionId: string,
  parentTurnId: string,
  itemId: string
): SubagentRenderableItem | null {
  const store = FlowChatStore.getInstance();
  const parentTurn = store
    .getState()
    .sessions
    .get(parentSessionId)
    ?.dialogTurns
    .find((turn) => turn.id === parentTurnId);

  if (!parentTurn) {
    return null;
  }

  for (const round of parentTurn.modelRounds) {
    const found = round.items.find((item) => item.id === itemId);
    if (found) {
      return found as SubagentRenderableItem;
    }
  }

  return null;
}

function updateExistingTextItem(
  parentSessionId: string,
  parentTurnId: string,
  itemId: string,
  existingItem: SubagentRenderableItem,
  data: SubagentTextChunkData
): void {
  const isThinkingEnd = data.contentType === 'thinking' && !!data.isThinkingEnd;
  const update = isThinkingEnd
    ? {
        content: existingItem.content + data.text,
        isStreaming: false,
        isCollapsed: true,
        status: 'completed',
        timestamp: Date.now(),
      }
    : {
        content: existingItem.content + data.text,
        timestamp: Date.now(),
      };

  FlowChatStore.getInstance().updateModelRoundItem(parentSessionId, parentTurnId, itemId, update as any);
}

function createThinkingItem(
  itemId: string,
  data: SubagentTextChunkData,
  timestamp: number
): FlowThinkingItem {
  const isThinkingEnd = !!data.isThinkingEnd;

  return {
    id: itemId,
    type: 'thinking',
    content: data.text,
    timestamp,
    isStreaming: !isThinkingEnd,
    isCollapsed: isThinkingEnd,
    status: isThinkingEnd ? 'completed' : 'streaming',
    isSubagentItem: true,
    parentTaskToolId: '',
    subagentSessionId: data.sessionId,
  } as any;
}

function createTextItem(itemId: string, data: SubagentTextChunkData, timestamp: number): FlowTextItem {
  return {
    id: itemId,
    type: 'text',
    content: data.text,
    timestamp,
    isStreaming: true,
    status: 'streaming',
    isMarkdown: true,
    isSubagentItem: true,
    parentTaskToolId: '',
    subagentSessionId: data.sessionId,
  };
}

function createSubagentItem(
  parentToolId: string,
  itemId: string,
  data: SubagentTextChunkData,
  parentTimestamp: number
): SubagentRenderableItem {
  const item = data.contentType === 'thinking'
    ? createThinkingItem(itemId, data, parentTimestamp + 1)
    : createTextItem(itemId, data, parentTimestamp + 1);

  return {
    ...item,
    parentTaskToolId: parentToolId,
  } as SubagentRenderableItem;
}

/**
 * Route subagent text chunks to the parent tool card.
 * Supports "text" and "thinking" content types.
 */
export function routeTextChunkToToolCard(
  _context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  data: SubagentTextChunkData
): void {
  const parentLocation = resolveParentToolLocation(parentSessionId, parentToolId, 'Subagent TextChunk');
  if (!parentLocation) {
    return;
  }

  const itemId = subagentItemId(parentToolId, data);
  const existingItem = findExistingSubagentItem(parentSessionId, parentLocation.turnId, itemId);

  if (existingItem) {
    updateExistingTextItem(parentSessionId, parentLocation.turnId, itemId, existingItem, data);
    return;
  }

  FlowChatStore.getInstance().insertModelRoundItemAfterTool(
    parentSessionId,
    parentLocation.turnId,
    parentToolId,
    createSubagentItem(parentToolId, itemId, data, parentLocation.timestamp)
  );
}

/**
 * Route subagent tool events to the parent tool card.
 */
export function routeToolEventToToolCard(
  context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  data: SubagentToolEventData,
  onTodoWriteResult?: (sessionId: string, turnId: string, result: any) => void
): void {
  const parentLocation = resolveParentToolLocation(parentSessionId, parentToolId, 'Subagent ToolEvent');
  if (!parentLocation) {
    return;
  }

  processToolEvent(context, parentSessionId, parentLocation.turnId, data.toolEvent, {
    isSubagent: true,
    parentToolId,
    subagentSessionId: data.sessionId,
    parentTimestamp: parentLocation.timestamp,
  }, onTodoWriteResult);
}

/**
 * Internal TextChunk routing for batch processing.
 */
export function routeTextChunkToToolCardInternal(
  context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  chunkData: {
    sessionId: string;
    turnId: string;
    roundId: string;
    text: string;
    contentType: string;
    isThinkingEnd?: boolean;
  }
): void {
  routeTextChunkToToolCard(context, parentSessionId, parentToolId, chunkData);
}

/**
 * Internal ToolEvent routing for batch processing.
 */
export function routeToolEventToToolCardInternal(
  context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  eventData: ToolEventData,
  onTodoWriteResult?: (sessionId: string, turnId: string, result: any) => void
): void {
  routeToolEventToToolCard(context, parentSessionId, parentToolId, eventData, onTodoWriteResult);
}
