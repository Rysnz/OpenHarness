/**
 * Tool confirmation/rejection actions for Modern FlowChat.
 */

import { useCallback } from 'react';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { agentService } from '@/shared/services/agent-service';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { stateMachineManager } from '@/flow_chat/state-machine';
import { SessionExecutionEvent } from '@/flow_chat/state-machine/types';
import type { DialogTurn, FlowItem, FlowToolItem, ModelRound } from '@/flow_chat/types/flow-chat';

const log = createLogger('useFlowChatToolActions');

interface ResolvedToolContext {
  sessionId: string | null;
  toolItem: FlowToolItem | null;
  turnId: string | null;
}

function formatToolActionError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isToolTaskNotFound(error: unknown): boolean {
  const message = formatToolActionError(error).toLowerCase();
  return message.includes('tool task not found') || message.includes('tool item') && message.includes('not found');
}

function resolveToolContext(toolId: string): ResolvedToolContext {
  const latestState = flowChatStore.getState();

  let toolItem: FlowToolItem | null = null;
  let turnId: string | null = null;
  let sessionId: string | null = null;

  for (const session of latestState.sessions.values()) {
    for (const turn of session.dialogTurns as DialogTurn[]) {
      for (const modelRound of turn.modelRounds as ModelRound[]) {
        const item = modelRound.items.find((candidate: FlowItem) => (
          candidate.type === 'tool' && candidate.id === toolId
        )) as FlowToolItem | undefined;

        if (item) {
          toolItem = item;
          turnId = turn.id;
          sessionId = session.sessionId;
          break;
        }
      }

      if (toolItem) {
        break;
      }
    }

    if (toolItem) {
      break;
    }
  }

  return {
    sessionId,
    toolItem,
    turnId,
  };
}

export function useFlowChatToolActions() {
  const handleToolConfirm = useCallback(async (toolId: string, updatedInput?: any) => {
    try {
      const { sessionId, toolItem, turnId } = resolveToolContext(toolId);

      if (!sessionId || !toolItem || !turnId) {
        log.warn('Tool confirmation ignored: tool item not found in current session', { toolId });
        return;
      }

      const finalInput = updatedInput || toolItem.toolCall?.input;

      flowChatStore.updateModelRoundItem(sessionId, turnId, toolId, {
        userConfirmed: true,
        status: 'confirmed',
        toolCall: {
          ...toolItem.toolCall,
          input: finalInput,
        },
      } as any);

      await agentService.confirmToolExecution(
        sessionId,
        toolId,
        'confirm',
        finalInput,
      );

      void stateMachineManager
        .transition(sessionId, SessionExecutionEvent.TOOL_CONFIRMED, { toolUseId: toolId })
        .catch(error => log.error('Tool confirmation state transition failed', { toolId, error }));
    } catch (error) {
      if (isToolTaskNotFound(error)) {
        log.warn('Tool confirmation ignored: backend task already cleared', { toolId, error });
        return;
      }
      log.error('Tool confirmation failed', error);
      notificationService.error(`Tool confirmation failed: ${formatToolActionError(error)}`);
    }
  }, []);

  const handleToolReject = useCallback(async (toolId: string) => {
    try {
      const { sessionId, toolItem, turnId } = resolveToolContext(toolId);

      if (!sessionId || !toolItem || !turnId) {
        log.warn('Tool rejection failed: tool item not found', { toolId });
        return;
      }

      flowChatStore.updateModelRoundItem(sessionId, turnId, toolId, {
        userConfirmed: false,
        status: 'rejected',
      } as any);

      await agentService.confirmToolExecution(
        sessionId,
        toolId,
        'reject',
      );

      void stateMachineManager
        .transition(sessionId, SessionExecutionEvent.TOOL_REJECTED, { toolUseId: toolId })
        .catch(error => log.error('Tool rejection state transition failed', { toolId, error }));
    } catch (error) {
      if (isToolTaskNotFound(error)) {
        log.warn('Tool rejection ignored: backend task already cleared', { toolId, error });
        return;
      }
      log.error('Tool rejection failed', error);
      notificationService.error(`Tool rejection failed: ${formatToolActionError(error)}`);
    }
  }, []);

  return {
    handleToolConfirm,
    handleToolReject,
  };
}
