import { useCallback, useEffect, useRef, useState } from 'react';

const NAV_PUSH_EVENT = 'nav-push';
const NAV_RESTORE_EVENT = 'nav-restore';

export interface NavEntry {
  key: string;
  [extra: string]: unknown;
}

interface NavHistoryState {
  stack: NavEntry[];
  cursor: number;
}

let historyState: NavHistoryState = { stack: [], cursor: -1 };
const listeners = new Set<() => void>();

export function pushNavEntry(entry: NavEntry): void {
  pushEntry(entry);
}

export function useNavHistory() {
  const [, forceUpdate] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const refresh = () => {
      if (mountedRef.current) {
        forceUpdate((value) => value + 1);
      }
    };

    listeners.add(refresh);
    window.addEventListener(NAV_PUSH_EVENT, handlePushEvent);

    return () => {
      mountedRef.current = false;
      listeners.delete(refresh);
      window.removeEventListener(NAV_PUSH_EVENT, handlePushEvent);
    };
  }, []);

  const goBack = useCallback(() => {
    restoreEntry(moveCursor(-1));
  }, []);

  const goForward = useCallback(() => {
    restoreEntry(moveCursor(1));
  }, []);

  return {
    canGoBack: historyState.cursor > 0,
    canGoForward: historyState.cursor < historyState.stack.length - 1,
    goBack,
    goForward,
  };
}

function handlePushEvent(event: Event): void {
  const entry = (event as CustomEvent<NavEntry>).detail;
  if (entry?.key) {
    pushEntry(entry);
  }
}

function pushEntry(entry: NavEntry): void {
  const stack = historyState.stack.slice(0, historyState.cursor + 1);
  if (stack.at(-1)?.key === entry.key) {
    return;
  }

  historyState = { stack: [...stack, entry], cursor: stack.length };
  notifyListeners();
}

function moveCursor(offset: -1 | 1): NavEntry | undefined {
  const nextCursor = historyState.cursor + offset;
  if (nextCursor < 0 || nextCursor >= historyState.stack.length) {
    return undefined;
  }

  historyState = { ...historyState, cursor: nextCursor };
  notifyListeners();
  return historyState.stack[nextCursor];
}

function restoreEntry(entry?: NavEntry): void {
  if (entry) {
    window.dispatchEvent(new CustomEvent(NAV_RESTORE_EVENT, { detail: entry }));
  }
}

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}
