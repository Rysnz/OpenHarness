import { createContext, useContext } from 'react';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('ToolbarModeContext');
const PROVIDER_MISSING_MESSAGE = 'Provider not found';

export interface ToolbarModeState {
  sessionId: string | null;
  sessionTitle: string | null;
  isProcessing: boolean;
  latestContent: string;
  latestToolName: string | null;
  hasPendingConfirmation: boolean;
  pendingToolId: string | null;
  hasError: boolean;
  todoProgress: ToolbarTodoProgress | null;
}

export interface ToolbarTodoProgress {
  completed: number;
  total: number;
  current: string;
}

export interface ToolbarModeContextType {
  isToolbarMode: boolean;
  isExpanded: boolean;
  isPinned: boolean;
  enableToolbarMode: () => Promise<void>;
  disableToolbarMode: () => Promise<void>;
  toggleToolbarMode: () => Promise<void>;
  toggleExpanded: () => Promise<void>;
  setPinned: (pinned: boolean) => void;
  togglePinned: () => void;
  toolbarState: ToolbarModeState;
  updateToolbarState: (state: Partial<ToolbarModeState>) => void;
}

export interface SavedWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
  isDecorated?: boolean;
}

export const TOOLBAR_COMPACT_SIZE = { width: 700, height: 140 };
export const TOOLBAR_COMPACT_MIN = { width: 400, height: 100 };
export const TOOLBAR_EXPANDED_SIZE = { width: 700, height: 1400 };
export const TOOLBAR_EXPANDED_MIN = { width: 400, height: 500 };

export const ToolbarModeContext = createContext<ToolbarModeContextType | undefined>(undefined);

const defaultToolbarState: ToolbarModeState = {
  sessionId: null,
  sessionTitle: null,
  isProcessing: false,
  latestContent: '',
  latestToolName: null,
  hasPendingConfirmation: false,
  pendingToolId: null,
  hasError: false,
  todoProgress: null,
};

const defaultContextValue: ToolbarModeContextType = {
  isToolbarMode: false,
  isExpanded: false,
  isPinned: false,
  enableToolbarMode: missingAsyncProvider,
  disableToolbarMode: missingAsyncProvider,
  toggleToolbarMode: missingAsyncProvider,
  toggleExpanded: missingAsyncProvider,
  setPinned: missingProvider,
  togglePinned: missingProvider,
  toolbarState: defaultToolbarState,
  updateToolbarState: missingProvider,
};

export const useToolbarModeContext = (): ToolbarModeContextType => {
  const context = useContext(ToolbarModeContext);
  if (context) {
    return context;
  }

  log.warn('useToolbarModeContext called outside of ToolbarModeProvider, using default values');
  return defaultContextValue;
};

function missingProvider(): void {
  log.warn(PROVIDER_MISSING_MESSAGE);
}

async function missingAsyncProvider(): Promise<void> {
  missingProvider();
}

export default ToolbarModeContext;
