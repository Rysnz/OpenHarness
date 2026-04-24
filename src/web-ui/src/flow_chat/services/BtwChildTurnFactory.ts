import type { DialogTurn, FlowTextItem, ModelRound } from '../types/flow-chat';

export interface BtwChildTurnDraft {
  childTurnId: string;
  childRoundId: string;
  childTextId: string;
  childTurn: DialogTurn;
}

export function buildStreamingBtwChildTurn(params: {
  childSessionId: string;
  requestId: string;
  question: string;
  timestamp?: number;
}): BtwChildTurnDraft {
  const childNow = params.timestamp ?? Date.now();
  const childTurnId = `btw-turn-${params.requestId}`;
  const childRoundId = `btw-round-${params.requestId}`;
  const childTextId = `btw-text-${params.requestId}`;

  const textItem: FlowTextItem = {
    id: childTextId,
    type: 'text',
    content: '',
    isStreaming: true,
    isMarkdown: true,
    timestamp: childNow,
    status: 'streaming',
  };

  const round: ModelRound = {
    id: childRoundId,
    index: 0,
    items: [textItem],
    isStreaming: true,
    isComplete: false,
    status: 'streaming',
    startTime: childNow,
  };

  const childTurn: DialogTurn = {
    id: childTurnId,
    sessionId: params.childSessionId,
    userMessage: {
      id: `btw-user-${params.requestId}`,
      content: params.question,
      timestamp: childNow,
    },
    modelRounds: [round],
    status: 'processing',
    startTime: childNow,
    backendTurnIndex: 0,
  };

  return {
    childTurnId,
    childRoundId,
    childTextId,
    childTurn,
  };
}
