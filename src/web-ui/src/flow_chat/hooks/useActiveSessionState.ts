import { useState, useEffect } from 'react';
import { flowChatStore } from '../store/FlowChatStore';
import { stateMachineManager } from '../state-machine';
import { ProcessingPhase } from '../state-machine/types';
import type { Session } from '../types/flow-chat';

export interface ActiveSessionState {
  sessionId: string | null;
  isProcessing: boolean;
  processingPhase: ProcessingPhase | null;
  error: string | null;
  status: 'active' | 'idle' | 'error';
}

const buildActiveSessionState = (session: Session | null | undefined): ActiveSessionState => {
  const machine = session ? stateMachineManager.get(session.sessionId) : null;

  return {
    sessionId: session?.sessionId || null,
    isProcessing: machine?.getCurrentState() === 'processing',
    processingPhase: machine?.getContext().processingPhase || null,
    error: session?.error || null,
    status: session?.status || 'idle'
  };
};

const isSameSessionState = (left: ActiveSessionState, right: ActiveSessionState): boolean =>
  left.sessionId === right.sessionId &&
  left.isProcessing === right.isProcessing &&
  left.processingPhase === right.processingPhase &&
  left.error === right.error &&
  left.status === right.status;

export const useActiveSessionState = (): ActiveSessionState => {
  const [sessionState, setSessionState] = useState<ActiveSessionState>(() =>
    buildActiveSessionState(flowChatStore.getActiveSession())
  );

  useEffect(() => {
    const unsubscribeStore = flowChatStore.subscribe((newState) => {
      const session = newState.sessions.get(newState.activeSessionId || '');
      const nextState = buildActiveSessionState(session);
      setSessionState((prev) => (isSameSessionState(prev, nextState) ? prev : nextState));
    });

    const unsubscribeMachine = stateMachineManager.subscribeGlobal((sessionId, machineSnapshot) => {
      const currentSession = flowChatStore.getActiveSession();
      if (currentSession?.sessionId !== sessionId) {
        return;
      }

      const isProcessing = machineSnapshot.currentState === 'processing';
      const processingPhase = machineSnapshot.context.processingPhase;
      setSessionState((prev) =>
        prev.isProcessing === isProcessing && prev.processingPhase === processingPhase
          ? prev
          : { ...prev, isProcessing, processingPhase }
      );
    });

    return () => {
      unsubscribeStore();
      unsubscribeMachine();
    };
  }, []);

  return sessionState;
};

