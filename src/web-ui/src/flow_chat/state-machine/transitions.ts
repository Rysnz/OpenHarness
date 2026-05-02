/**
 * State transition table definition
 */

import { SessionExecutionState, SessionExecutionEvent, StateTransitionTable, ProcessingPhase } from './types';

const RUNNING_EVENTS: SessionExecutionEvent[] = [
  SessionExecutionEvent.COMPACTION_STARTED,
  SessionExecutionEvent.MODEL_ROUND_START,
  SessionExecutionEvent.TEXT_CHUNK_RECEIVED,
  SessionExecutionEvent.TOOL_DETECTED,
  SessionExecutionEvent.TOOL_STARTED,
  SessionExecutionEvent.TOOL_COMPLETED,
  SessionExecutionEvent.TOOL_CONFIRMATION_NEEDED,
  SessionExecutionEvent.TOOL_CONFIRMED,
];

function stayInState(state: SessionExecutionState) {
  return Object.fromEntries(
    RUNNING_EVENTS.map((event) => [event, state])
  ) as Partial<Record<SessionExecutionEvent, SessionExecutionState>>;
}

/**
 * State transition table
 * 
 * Design philosophy:
 * - IDLE: idle, can start new task
 * - PROCESSING: running, can be cancelled or error
 * - FINISHING: backend completed, frontend is draining late events before becoming idle
 * - ERROR: error state, can reset or retry
 * 
 * Cancellation logic: USER_CANCEL → immediately switch to IDLE (no backend wait)
 */
export const STATE_TRANSITIONS: StateTransitionTable = {
  [SessionExecutionState.IDLE]: {
    [SessionExecutionEvent.START]: SessionExecutionState.PROCESSING,
  },
  
  [SessionExecutionState.PROCESSING]: {
    [SessionExecutionEvent.USER_CANCEL]: SessionExecutionState.IDLE,
    [SessionExecutionEvent.FINISHING_SETTLED]: SessionExecutionState.IDLE,
    [SessionExecutionEvent.ERROR_OCCURRED]: SessionExecutionState.ERROR,
    [SessionExecutionEvent.BACKEND_STREAM_COMPLETED]: SessionExecutionState.FINISHING,
    [SessionExecutionEvent.TOOL_REJECTED]: SessionExecutionState.IDLE,
    ...stayInState(SessionExecutionState.PROCESSING),
  },

  [SessionExecutionState.FINISHING]: {
    [SessionExecutionEvent.USER_CANCEL]: SessionExecutionState.IDLE,
    [SessionExecutionEvent.ERROR_OCCURRED]: SessionExecutionState.ERROR,
    [SessionExecutionEvent.FINISHING_SETTLED]: SessionExecutionState.IDLE,
    [SessionExecutionEvent.TOOL_REJECTED]: SessionExecutionState.IDLE,
    ...stayInState(SessionExecutionState.FINISHING),
  },
  
  [SessionExecutionState.ERROR]: {
    [SessionExecutionEvent.RESET]: SessionExecutionState.IDLE,
    [SessionExecutionEvent.START]: SessionExecutionState.PROCESSING,
  },
};

/**
 * Processing phase transitions (only valid in PROCESSING state)
 * Does not trigger main state change, only updates context.processingPhase
 */
export const PHASE_TRANSITIONS: Record<SessionExecutionEvent, ProcessingPhase | null> = {
  [SessionExecutionEvent.START]: ProcessingPhase.STARTING,
  [SessionExecutionEvent.COMPACTION_STARTED]: ProcessingPhase.COMPACTING,
  [SessionExecutionEvent.MODEL_ROUND_START]: ProcessingPhase.THINKING,
  [SessionExecutionEvent.TEXT_CHUNK_RECEIVED]: ProcessingPhase.STREAMING,
  [SessionExecutionEvent.TOOL_DETECTED]: ProcessingPhase.TOOL_CALLING,
  [SessionExecutionEvent.TOOL_STARTED]: ProcessingPhase.TOOL_CALLING,
  [SessionExecutionEvent.TOOL_COMPLETED]: null,
  [SessionExecutionEvent.TOOL_CONFIRMATION_NEEDED]: ProcessingPhase.TOOL_CONFIRMING,
  [SessionExecutionEvent.TOOL_CONFIRMED]: ProcessingPhase.TOOL_CALLING,
  [SessionExecutionEvent.TOOL_REJECTED]: null,
  [SessionExecutionEvent.BACKEND_STREAM_COMPLETED]: ProcessingPhase.FINALIZING,
  [SessionExecutionEvent.FINISHING_SETTLED]: null,
  [SessionExecutionEvent.USER_CANCEL]: null,
  [SessionExecutionEvent.ERROR_OCCURRED]: null,
  [SessionExecutionEvent.RESET]: null,
};

export function canTransition(
  from: SessionExecutionState,
  event: SessionExecutionEvent
): boolean {
  return STATE_TRANSITIONS[from]?.[event] !== undefined;
}

export function getNextState(
  from: SessionExecutionState,
  event: SessionExecutionEvent
): SessionExecutionState | null {
  return STATE_TRANSITIONS[from]?.[event] || null;
}

export function getPossibleEvents(
  state: SessionExecutionState
): SessionExecutionEvent[] {
  const transitions = STATE_TRANSITIONS[state];
  return transitions ? Object.keys(transitions) as SessionExecutionEvent[] : [];
}

