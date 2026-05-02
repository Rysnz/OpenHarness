import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getTerminalService, TerminalService } from '../services';
import { createLogger } from '@/shared/utils/logger';
import type {
  SessionResponse,
  TerminalEvent,
  TerminalEventCallback,
} from '../types';

const log = createLogger('useTerminal');

export interface UseTerminalOptions {
  sessionId: string;
  autoConnect?: boolean;
  onEvent?: TerminalEventCallback;
  onOutput?: (data: string) => void;
  onReady?: () => void;
  onExit?: (exitCode?: number) => void;
  onError?: (message: string) => void;
  onHistoryDims?: (cols: number, rows: number) => void;
}

export interface UseTerminalReturn {
  service: TerminalService;
  session: SessionResponse | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  sendCtrlC: () => Promise<void>;
  close: () => Promise<void>;
  refresh: () => Promise<void>;
}

type CallbackRefs = {
  onEvent: React.MutableRefObject<UseTerminalOptions['onEvent']>;
  onOutput: React.MutableRefObject<UseTerminalOptions['onOutput']>;
  onReady: React.MutableRefObject<UseTerminalOptions['onReady']>;
  onExit: React.MutableRefObject<UseTerminalOptions['onExit']>;
  onError: React.MutableRefObject<UseTerminalOptions['onError']>;
  onHistoryDims: React.MutableRefObject<UseTerminalOptions['onHistoryDims']>;
};

const toErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : 'Connection failed'
);

const disposeSubscription = (unsubscribeRef: React.MutableRefObject<(() => void) | null>): void => {
  unsubscribeRef.current?.();
  unsubscribeRef.current = null;
};

const runTerminalAction = async (
  label: string,
  sessionId: string,
  action: () => Promise<void>,
  extra: Record<string, unknown> = {}
): Promise<void> => {
  try {
    await action();
  } catch (error) {
    log.error(label, { sessionId, ...extra, error });
    throw error;
  }
};

function useTerminalCallbackRefs(options: UseTerminalOptions): CallbackRefs {
  const onEvent = useRef(options.onEvent);
  const onOutput = useRef(options.onOutput);
  const onReady = useRef(options.onReady);
  const onExit = useRef(options.onExit);
  const onError = useRef(options.onError);
  const onHistoryDims = useRef(options.onHistoryDims);
  const refs = useMemo<CallbackRefs>(() => ({
    onEvent,
    onOutput,
    onReady,
    onExit,
    onError,
    onHistoryDims,
  }), []);

  useEffect(() => {
    onEvent.current = options.onEvent;
    onOutput.current = options.onOutput;
    onReady.current = options.onReady;
    onExit.current = options.onExit;
    onError.current = options.onError;
    onHistoryDims.current = options.onHistoryDims;
  }, [options.onEvent, options.onOutput, options.onReady, options.onExit, options.onError, options.onHistoryDims]);

  return refs;
}

async function replayTerminalHistory(
  service: TerminalService,
  sessionId: string,
  refs: CallbackRefs,
  isCancelled: () => boolean
): Promise<void> {
  try {
    const history = await service.getHistory(sessionId);
    if (!isCancelled() && history.data) {
      refs.onHistoryDims.current?.(history.cols, history.rows);
      refs.onOutput.current?.(history.data);
    }
  } catch (error) {
    log.warn('Failed to fetch terminal history', { sessionId, error });
  }
}

export function useTerminal(options: UseTerminalOptions): UseTerminalReturn {
  const { sessionId, autoConnect = true } = options;
  const callbacks = useTerminalCallbackRefs(options);

  const [session, setSession] = useState<SessionResponse | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const serviceRef = useRef<TerminalService>(getTerminalService());
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const handleEvent = useCallback((event: TerminalEvent) => {
    if (event.sessionId !== sessionId) {
      return;
    }

    callbacks.onEvent.current?.(event);

    switch (event.type) {
      case 'output':
        callbacks.onOutput.current?.((event as any).data);
        break;
      case 'ready':
        callbacks.onReady.current?.();
        break;
      case 'exit':
        callbacks.onExit.current?.((event as any).exitCode);
        break;
      case 'error': {
        const message = (event as any).message;
        callbacks.onError.current?.(message);
        setError(message);
        break;
      }
      case 'resize':
        break;
    }
  }, [callbacks, sessionId]);

  useEffect(() => {
    const service = serviceRef.current;
    let cancelled = false;
    const isCancelled = () => cancelled;

    const connect = async () => {
      try {
        setIsLoading(true);
        setError(null);

        if (autoConnect && !service.isConnected()) {
          await service.connect();
        }

        if (cancelled) return;
        setIsConnected(service.isConnected());

        const sessionInfo = await service.getSession(sessionId);
        if (cancelled) return;
        setSession(sessionInfo);

        await replayTerminalHistory(service, sessionId, callbacks, isCancelled);
        if (cancelled) return;

        const unsubscribe = service.onSessionEvent(sessionId, handleEvent);
        if (cancelled) {
          unsubscribe();
        } else {
          unsubscribeRef.current = unsubscribe;
          setIsLoading(false);
        }
      } catch (connectError) {
        if (cancelled) return;
        const message = toErrorMessage(connectError);
        setError(message);
        setIsLoading(false);
        log.error('Failed to connect', { sessionId, error: connectError });
      }
    };

    void connect();

    return () => {
      cancelled = true;
      disposeSubscription(unsubscribeRef);
    };
  }, [sessionId, autoConnect, handleEvent, callbacks]);

  const write = useCallback((data: string) => (
    runTerminalAction('Failed to write', sessionId, () => serviceRef.current.write(sessionId, data))
  ), [sessionId]);

  const resize = useCallback((cols: number, rows: number) => (
    runTerminalAction(
      'Failed to resize',
      sessionId,
      () => serviceRef.current.resize(sessionId, cols, rows),
      { cols, rows }
    )
  ), [sessionId]);

  const sendCtrlC = useCallback(() => (
    runTerminalAction('Failed to send Ctrl+C', sessionId, () => serviceRef.current.sendCtrlC(sessionId))
  ), [sessionId]);

  const close = useCallback(async () => {
    await runTerminalAction(
      'Failed to close session',
      sessionId,
      () => serviceRef.current.closeSession(sessionId)
    );
    setSession(null);
  }, [sessionId]);

  const refresh = useCallback(async () => {
    try {
      setSession(await serviceRef.current.getSession(sessionId));
    } catch (refreshError) {
      log.error('Failed to refresh session', { sessionId, error: refreshError });
      throw refreshError;
    }
  }, [sessionId]);

  return {
    service: serviceRef.current,
    session,
    isConnected,
    isLoading,
    error,
    write,
    resize,
    sendCtrlC,
    close,
    refresh,
  };
}
