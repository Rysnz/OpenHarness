import type { FlowThinkingItem } from '../../types/flow-chat';
import type { FlowChatContext, FlowTextItem } from './types';

type BufferMap = Map<string, string>;
type ActiveItemMap = Map<string, string>;

interface SessionStreamState {
  contentBuffer: BufferMap;
  activeItems: ActiveItemMap;
}

function ensureSessionStreamState(context: FlowChatContext, sessionId: string): SessionStreamState {
  if (!context.contentBuffers.has(sessionId)) {
    context.contentBuffers.set(sessionId, new Map());
  }
  if (!context.activeTextItems.has(sessionId)) {
    context.activeTextItems.set(sessionId, new Map());
  }

  return {
    contentBuffer: context.contentBuffers.get(sessionId)!,
    activeItems: context.activeTextItems.get(sessionId)!,
  };
}

function appendBufferedContent(buffer: BufferMap, key: string, text: string): string {
  const content = `${buffer.get(key) || ''}${text}`.replace(/\n{3,}/g, '\n\n');
  buffer.set(key, content);
  return content;
}

function newStreamItemId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function thinkingKey(roundId: string): string {
  return `thinking_${roundId}`;
}

function createTextItem(itemId: string, content: string): FlowTextItem {
  return {
    id: itemId,
    type: 'text',
    content,
    isStreaming: true,
    isMarkdown: true,
    timestamp: Date.now(),
    status: 'streaming',
  };
}

function createThinkingItem(itemId: string, content: string, isThinkingEnd: boolean): FlowThinkingItem {
  return {
    id: itemId,
    type: 'thinking',
    content,
    isStreaming: !isThinkingEnd,
    isCollapsed: isThinkingEnd,
    timestamp: Date.now(),
    status: isThinkingEnd ? 'completed' : 'streaming',
  };
}

function clearStreamingKey(state: SessionStreamState, key: string): void {
  state.contentBuffer.delete(key);
  state.activeItems.delete(key);
}

/**
 * Process a normal text chunk without notifying the store.
 */
export function processNormalTextChunkInternal(
  context: FlowChatContext,
  sessionId: string,
  turnId: string,
  roundId: string,
  text: string
): void {
  const streamState = ensureSessionStreamState(context, sessionId);
  const cleanedContent = appendBufferedContent(streamState.contentBuffer, roundId, text);
  const textItemId = streamState.activeItems.get(roundId);

  if (textItemId) {
    context.flowChatStore.updateModelRoundItemSilent(sessionId, turnId, textItemId, {
      content: cleanedContent,
      timestamp: Date.now(),
    } as any);
    return;
  }

  const newItemId = newStreamItemId('text');
  context.flowChatStore.addModelRoundItemSilent(
    sessionId,
    turnId,
    createTextItem(newItemId, cleanedContent),
    roundId
  );
  streamState.activeItems.set(roundId, newItemId);
}

/**
 * Process thinking chunks without notifying the store.
 */
export function processThinkingChunkInternal(
  context: FlowChatContext,
  sessionId: string,
  turnId: string,
  roundId: string,
  text: string,
  isThinkingEnd = false
): void {
  const streamState = ensureSessionStreamState(context, sessionId);
  const key = thinkingKey(roundId);
  const cleanedContent = appendBufferedContent(streamState.contentBuffer, key, text);
  const thinkingItemId = streamState.activeItems.get(key);

  if (!thinkingItemId) {
    const newItemId = newStreamItemId('thinking');
    context.flowChatStore.addModelRoundItemSilent(
      sessionId,
      turnId,
      createThinkingItem(newItemId, cleanedContent, isThinkingEnd),
      roundId
    );
    streamState.activeItems.set(key, newItemId);

    if (isThinkingEnd) {
      clearStreamingKey(streamState, key);
    }
    return;
  }

  context.flowChatStore.updateModelRoundItemSilent(sessionId, turnId, thinkingItemId, {
    content: cleanedContent,
    ...(isThinkingEnd
      ? {
          isStreaming: false,
          isCollapsed: true,
          status: 'completed',
        }
      : {}),
    timestamp: Date.now(),
  } as any);

  if (isThinkingEnd) {
    clearStreamingKey(streamState, key);
  }
}

/**
 * Finalize streaming state for active text items.
 */
export function completeActiveTextItems(
  context: FlowChatContext,
  sessionId: string,
  turnId: string
): void {
  const sessionActiveTextItems = context.activeTextItems.get(sessionId);
  if (!sessionActiveTextItems || sessionActiveTextItems.size === 0) {
    return;
  }

  const batchUpdates = Array.from(sessionActiveTextItems.values()).map((itemId) => ({
    itemId,
    changes: {
      isStreaming: false,
      status: 'completed' as const,
    },
  }));

  context.flowChatStore.batchUpdateModelRoundItems(sessionId, turnId, batchUpdates);
  sessionActiveTextItems.clear();
}

/**
 * Clean up session buffers.
 */
export function cleanupSessionBuffers(context: FlowChatContext, sessionId: string): void {
  if (context.eventBatcher.getBufferSize() > 0) {
    context.eventBatcher.clear();
  }

  const pendingCompletion = context.pendingTurnCompletions.get(sessionId);
  if (pendingCompletion?.timer) {
    clearTimeout(pendingCompletion.timer);
  }
  context.pendingTurnCompletions.delete(sessionId);
  context.contentBuffers.delete(sessionId);
  context.activeTextItems.delete(sessionId);
}

/**
 * Clear all buffers and transient state.
 */
export function clearAllBuffers(context: FlowChatContext): void {
  for (const pendingCompletion of context.pendingTurnCompletions.values()) {
    if (pendingCompletion.timer) {
      clearTimeout(pendingCompletion.timer);
    }
  }
  context.pendingTurnCompletions.clear();

  context.contentBuffers.clear();
  context.activeTextItems.clear();

  for (const timer of context.saveDebouncers.values()) {
    clearTimeout(timer);
  }
  context.saveDebouncers.clear();
  context.lastSaveTimestamps.clear();
  context.lastSaveHashes.clear();
  context.turnSavePending.clear();
  context.turnSaveInFlight.clear();
}
