/**
 * Session state machine type definitions
 * Based on industry best practices: XState, Redux, tokio
 */

/**
 * Session execution state.
 * 
 * Design philosophy:
 * - IDLE: idle, waiting for user input
 * - PROCESSING: running (dialog turn executing, including model thinking, output, tool execution, etc.)
 * - FINISHING: backend has reported completion, but the UI is still draining late data events
 * - ERROR: error state
 * 
 * Cancellation logic:
 * - User clicks cancel → immediately switch to IDLE
 * - UI immediately shows "cancelled"
 * - Asynchronously notify backend, no wait required
 * - No longer accept any events for that dialog turn
 * 
 * Sub-phases stored via context.processingPhase, do not affect main state
 */
export enum SessionExecutionState {
  IDLE = 'idle',
  PROCESSING = 'processing',
  FINISHING = 'finishing',
  ERROR = 'error',
}

/**
 * Processing phase (only valid in PROCESSING state)
 * Used for UI detailed display, does not affect main state logic
 */
export enum ProcessingPhase {
  STARTING = 'starting',
  COMPACTING = 'compacting',
  THINKING = 'thinking',
  STREAMING = 'streaming',
  FINALIZING = 'finalizing',
  TOOL_CALLING = 'tool_calling',
  TOOL_CONFIRMING = 'tool_confirming',
}

/**
 * State transition events
 */
export enum SessionExecutionEvent {
  START = 'start',
  COMPACTION_STARTED = 'compaction_started',
  MODEL_ROUND_START = 'model_round_start',
  TEXT_CHUNK_RECEIVED = 'text_chunk_received',
  TOOL_DETECTED = 'tool_detected',
  TOOL_STARTED = 'tool_started',
  TOOL_COMPLETED = 'tool_completed',
  TOOL_CONFIRMATION_NEEDED = 'tool_confirmation_needed',
  TOOL_CONFIRMED = 'tool_confirmed',
  TOOL_REJECTED = 'tool_rejected',
  BACKEND_STREAM_COMPLETED = 'backend_stream_completed',
  FINISHING_SETTLED = 'finishing_settled',
  USER_CANCEL = 'user_cancel',
  ERROR_OCCURRED = 'error_occurred',
  RESET = 'reset',
}

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export type PlannerContext = {
  todos: TodoItem[];
  isActive: boolean;
} | null;

export interface SessionRuntimeStats {
  startTime: number | null;
  textCharsGenerated: number;
  toolsExecuted: number;
}

export interface SessionErrorRecovery {
  errorCount: number;
  lastErrorTime: number | null;
  errorType: string | null;
  recoverable: boolean;
}

export type SendButtonMode = 'send' | 'cancel' | 'split' | 'confirm' | 'retry';
export type ProgressBarMode = 'indeterminate' | 'determinate' | 'segmented';
export type SessionErrorType = 'network' | 'model' | 'permission' | 'unknown';

/**
 * State machine context (runtime data)
 */
export interface SessionStateMachineContext {
  taskId: string | null;
  currentDialogTurnId: string | null;
  currentModelRoundId: string | null;
  pendingToolConfirmations: Set<string>;
  errorMessage: string | null;
  queuedInput: string | null;
  
  processingPhase: ProcessingPhase | null;
  
  planner: PlannerContext;
  
  stats: SessionRuntimeStats;
  
  version: number;
  lastUpdateTime: number;
  backendSyncedAt: number | null;
  errorRecovery: SessionErrorRecovery;
}

export interface SessionStateMachine {
  sessionId: string;
  currentState: SessionExecutionState;
  context: SessionStateMachineContext;
  transitionHistory: StateTransition[];
}

export interface StateTransition {
  from: SessionExecutionState;
  event: SessionExecutionEvent;
  to: SessionExecutionState;
  timestamp: number;
  payload?: any;
  success: boolean;
}

/**
 * Derived state (for UI components)
 */
export interface SessionDerivedState {
  isInputDisabled: boolean;
  showSendButton: boolean;
  showCancelButton: boolean;
  sendButtonMode: SendButtonMode;
  inputPlaceholder: string;
  
  showPlanner: boolean;
  plannerProgress: number;
  plannerStats: PlannerSummary | null;
  
  showProgressBar: boolean;
  progressBarMode: ProgressBarMode;
  progressBarValue: number;
  progressBarLabel: string;
  progressBarColor: string;
  
  isProcessing: boolean;
  canCancel: boolean;
  canSendNewMessage: boolean;
  hasQueuedInput: boolean;
  queuedInput: string | null;

  hasError: boolean;
  errorType: SessionErrorType | null;
  canRetry: boolean;
}

export interface PlannerSummary {
  completed: number;
  inProgress: number;
  pending: number;
}

export type StateTransitionTable = Record<
  SessionExecutionState,
  Partial<Record<SessionExecutionEvent, SessionExecutionState>>
>;

