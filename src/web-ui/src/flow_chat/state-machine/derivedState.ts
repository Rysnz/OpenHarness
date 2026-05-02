import {
  SessionExecutionState,
  ProcessingPhase,
  SessionStateMachine,
  SessionDerivedState,
} from './types';

type SessionContext = SessionStateMachine['context'];
type PlannerStats = NonNullable<SessionDerivedState['plannerStats']>;

export type DeriveSessionOptions = {
  /** Live draft while a message is processing, used to keep send mode in split state. */
  processingInputDraftTrimmed?: string;
};

const STREAMING_PROGRESS_ESTIMATE = 500;
const STREAMING_PROGRESS_CAP = 90;
const ACTIVE_MESSAGE_STATES = new Set<SessionExecutionState>([
  SessionExecutionState.PROCESSING,
  SessionExecutionState.FINISHING,
  SessionExecutionState.ERROR
]);

const normalizeDraft = (
  state: SessionExecutionState,
  options?: DeriveSessionOptions
): string => {
  if (!ACTIVE_MESSAGE_STATES.has(state)) {
    return '';
  }

  return options?.processingInputDraftTrimmed?.trim() ?? '';
};

const hasText = (value: string | null | undefined): boolean => (
  (value?.trim()?.length ?? 0) > 0
);

const calculatePlannerStats = (context: SessionContext): PlannerStats | null => {
  const todos = context.planner?.todos ?? [];
  if (todos.length === 0) {
    return null;
  }

  return todos.reduce<PlannerStats>(
    (stats, todo) => {
      if (todo.status === 'completed') {
        stats.completed += 1;
      } else if (todo.status === 'in_progress') {
        stats.inProgress += 1;
      } else {
        stats.pending += 1;
      }

      return stats;
    },
    { completed: 0, inProgress: 0, pending: 0 }
  );
};

const calculatePlannerProgress = (stats: PlannerStats | null): number => {
  if (!stats) {
    return 0;
  }

  const total = stats.completed + stats.inProgress + stats.pending;
  return total > 0 ? (stats.completed / total) * 100 : 0;
};

const shouldShowPlanner = (context: SessionContext, isProcessing: boolean): boolean => {
  const planner = context.planner;
  return Boolean(
    isProcessing &&
    planner &&
    planner.isActive &&
    planner.todos.length > 0
  );
};

export function deriveSessionState(
  machine: SessionStateMachine,
  options?: DeriveSessionOptions
): SessionDerivedState {
  const { currentState, context } = machine;
  const { processingPhase } = context;
  const draftTrimmed = normalizeDraft(currentState, options);
  const plannerStats = calculatePlannerStats(context);
  const isProcessing =
    currentState === SessionExecutionState.PROCESSING ||
    currentState === SessionExecutionState.FINISHING;
  const isError = currentState === SessionExecutionState.ERROR;
  const isIdle = currentState === SessionExecutionState.IDLE;
  const canCancel = currentState === SessionExecutionState.PROCESSING;
  const hasQueuedInput = hasText(context.queuedInput) || draftTrimmed.length > 0;

  return {
    isInputDisabled: false,
    showSendButton: !isProcessing,
    showCancelButton: canCancel,
    sendButtonMode: getSendButtonMode(
      currentState,
      processingPhase,
      context.queuedInput,
      context.pendingToolConfirmations.size > 0,
      draftTrimmed
    ),
    inputPlaceholder: 'How can I help you...',
    showPlanner: shouldShowPlanner(context, isProcessing),
    plannerProgress: calculatePlannerProgress(plannerStats),
    plannerStats,
    showProgressBar: isProcessing,
    progressBarMode: getProgressBarMode(processingPhase),
    progressBarValue: getProgressBarValue(processingPhase, context),
    progressBarLabel: getProgressBarLabel(processingPhase, context),
    progressBarColor: getProgressBarColor(processingPhase),
    isProcessing,
    canCancel,
    canSendNewMessage: isIdle || isError,
    hasQueuedInput,
    queuedInput: context.queuedInput ?? null,
    hasError: isError,
    errorType: context.errorMessage ? detectErrorType(context.errorMessage) : null,
    canRetry: isError,
  };
}

function getSendButtonMode(
  state: SessionExecutionState,
  phase: ProcessingPhase | null,
  queuedInput: string | null,
  hasPendingConfirmations: boolean,
  processingDraftTrimmed: string
): SessionDerivedState['sendButtonMode'] {
  if (state === SessionExecutionState.ERROR) {
    return hasText(queuedInput) || processingDraftTrimmed.length > 0 ? 'split' : 'retry';
  }

  if (state === SessionExecutionState.PROCESSING || state === SessionExecutionState.FINISHING) {
    if (phase === ProcessingPhase.TOOL_CONFIRMING || hasPendingConfirmations) {
      return 'confirm';
    }

    if (state === SessionExecutionState.FINISHING) {
      return 'send';
    }

    return hasText(queuedInput) || processingDraftTrimmed.length > 0 ? 'split' : 'cancel';
  }

  return 'send';
}

function getProgressBarMode(phase: ProcessingPhase | null): SessionDerivedState['progressBarMode'] {
  const determinatePhases = new Set<ProcessingPhase>([ProcessingPhase.STREAMING]);
  const segmentedPhases = new Set<ProcessingPhase>([ProcessingPhase.TOOL_CALLING]);

  if (phase && determinatePhases.has(phase)) {
    return 'determinate';
  }

  if (phase && segmentedPhases.has(phase)) {
    return 'segmented';
  }

  return 'indeterminate';
}

function getProgressBarValue(
  phase: ProcessingPhase | null,
  context: SessionContext
): number {
  if (phase === ProcessingPhase.STREAMING) {
    const current = context.stats.textCharsGenerated;
    const estimatedProgress = (current / STREAMING_PROGRESS_ESTIMATE) * 100;
    return Math.min(estimatedProgress, STREAMING_PROGRESS_CAP);
  }

  if (phase === ProcessingPhase.TOOL_CALLING) {
    return calculatePlannerProgress(calculatePlannerStats(context));
  }

  return 0;
}

function getProgressBarLabel(
  phase: ProcessingPhase | null,
  context: SessionContext
): string {
  const labels: Partial<Record<ProcessingPhase, string>> = {
    [ProcessingPhase.COMPACTING]: 'Compressing session context...',
    [ProcessingPhase.STARTING]: 'Connecting to AI...',
    [ProcessingPhase.THINKING]: 'Thinking...',
    [ProcessingPhase.FINALIZING]: 'Finalizing response...',
    [ProcessingPhase.TOOL_CONFIRMING]: 'Waiting for tool confirmation...'
  };

  if (phase === ProcessingPhase.STREAMING) {
    const chars = context.stats.textCharsGenerated;
    const duration = context.stats.startTime
      ? ((Date.now() - context.stats.startTime) / 1000).toFixed(1)
      : '0';
    return `Generating response (${chars} chars) - ${duration}s`;
  }

  if (phase === ProcessingPhase.TOOL_CALLING) {
    return `Executing tools... (${context.stats.toolsExecuted} completed)`;
  }

  return phase ? labels[phase] ?? '' : '';
}

function getProgressBarColor(phase: ProcessingPhase | null): string {
  const colorByPhase: Partial<Record<ProcessingPhase, string>> = {
    [ProcessingPhase.COMPACTING]: '#0f766e',
    [ProcessingPhase.STARTING]: '#3b82f6',
    [ProcessingPhase.THINKING]: '#3b82f6',
    [ProcessingPhase.STREAMING]: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
    [ProcessingPhase.TOOL_CALLING]: '#8b5cf6',
    [ProcessingPhase.TOOL_CONFIRMING]: '#f59e0b'
  };

  return phase ? colorByPhase[phase] ?? '#3b82f6' : '#3b82f6';
}

function detectErrorType(errorMessage: string): SessionDerivedState['errorType'] {
  const message = errorMessage.toLowerCase();

  if (message.includes('network') || message.includes('timeout')) {
    return 'network';
  }

  if (message.includes('model') || message.includes('overload')) {
    return 'model';
  }

  if (
    message.includes('permission') ||
    message.includes('api key') ||
    message.includes('401') ||
    message.includes('403')
  ) {
    return 'permission';
  }

  return 'unknown';
}
