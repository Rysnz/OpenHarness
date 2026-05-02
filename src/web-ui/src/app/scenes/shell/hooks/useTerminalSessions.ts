import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTerminalService } from '@/tools/terminal';
import type { TerminalService } from '@/tools/terminal';
import type { SessionResponse, TerminalEvent } from '@/tools/terminal/types/session';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import type { TerminalConfig } from '@/infrastructure/config/types';
import { createLogger } from '@/shared/utils/logger';
import {
  isSessionRunning,
  MANUAL_SOURCE,
  type ShellEntry,
} from './shellEntryTypes';

const log = createLogger('useTerminalSessions');
const STARTUP_COMMAND_DELAY_MS = 800;

interface UseTerminalSessionsOptions {
  workspacePath?: string;
  isRemote: boolean;
  currentConnectionId: string | null;
}

interface UseTerminalSessionsReturn {
  sessions: SessionResponse[];
  sessionMap: Map<string, SessionResponse>;
  refreshSessions: () => Promise<void>;
  startEntrySession: (entry: ShellEntry) => Promise<boolean>;
  createManualSession: (shellType?: string) => Promise<SessionResponse | null>;
  stopEntrySession: (entry: ShellEntry) => Promise<void>;
  closeSessionIfPresent: (sessionId: string) => Promise<void>;
  renameSessionLocally: (sessionId: string, newName: string) => void;
  hasSession: (sessionId: string) => boolean;
}

type TerminalNotification =
  | { name: 'terminal-session-destroyed'; detail: { sessionId: string } }
  | { name: 'terminal-session-renamed'; detail: { sessionId: string; newName: string } };

async function getDefaultShellType(): Promise<string | undefined> {
  try {
    const config = await configManager.getConfig<TerminalConfig>('terminal');
    return config?.default_shell || undefined;
  } catch {
    return undefined;
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function dispatchTerminalNotification(notification: TerminalNotification): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(notification.name, { detail: notification.detail }));
}

function shouldIncludeSession(
  session: SessionResponse,
  isRemote: boolean,
  currentConnectionId: string | null,
): boolean {
  const isRemoteSession = session.shellType === 'Remote';
  return isRemote
    ? isRemoteSession && session.connectionId === currentConnectionId
    : !isRemoteSession;
}

async function runStartupCommand(
  service: TerminalService,
  entry: ShellEntry,
): Promise<void> {
  const command = entry.startupCommand?.trim();
  if (!command) {
    return;
  }

  await wait(STARTUP_COMMAND_DELAY_MS);
  try {
    await service.sendCommand(entry.sessionId, command);
  } catch (error) {
    log.error('Failed to run startup command', { sessionId: entry.sessionId, error });
  }
}

function manualSessionName(sessions: SessionResponse[]): string {
  const nextIndex = sessions.filter((session) => session.source === MANUAL_SOURCE).length + 1;
  return `Shell ${nextIndex}`;
}

export function useTerminalSessions(
  options: UseTerminalSessionsOptions,
): UseTerminalSessionsReturn {
  const { workspacePath, isRemote, currentConnectionId } = options;
  const [sessions, setSessions] = useState<SessionResponse[]>([]);
  const serviceRef = useRef<TerminalService | null>(null);

  const sessionMap = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );

  const refreshSessions = useCallback(async () => {
    const service = serviceRef.current;
    if (!service) return;

    try {
      const allSessions = await service.listSessions();
      setSessions(
        allSessions.filter((session) => shouldIncludeSession(session, isRemote, currentConnectionId))
      );
    } catch (error) {
      log.error('Failed to list sessions', error);
    }
  }, [currentConnectionId, isRemote]);

  useEffect(() => {
    const service = getTerminalService();
    serviceRef.current = service;

    void (async () => {
      try {
        await service.connect();
        await refreshSessions();
      } catch (error) {
        log.error('Failed to connect terminal service', error);
      }
    })();

    const unsubscribe = service.onEvent((event: TerminalEvent) => {
      if (event.type === 'ready' || event.type === 'exit') {
        void refreshSessions();
      }
    });

    return () => unsubscribe();
  }, [refreshSessions]);

  const closeSessionIfPresent = useCallback(async (sessionId: string) => {
    const service = serviceRef.current;
    if (!service || !sessionMap.has(sessionId)) {
      return;
    }

    try {
      await service.closeSession(sessionId);
      dispatchTerminalNotification({
        name: 'terminal-session-destroyed',
        detail: { sessionId }
      });
    } catch (error) {
      log.error('Failed to close terminal session', { sessionId, error });
    }
  }, [sessionMap]);

  const startEntrySession = useCallback(async (entry: ShellEntry): Promise<boolean> => {
    const service = serviceRef.current;
    if (!service) {
      return false;
    }

    try {
      const existingSession = sessionMap.get(entry.sessionId);
      if (existingSession && !isSessionRunning(existingSession)) {
        await service.closeSession(entry.sessionId);
      }

      await service.createSession({
        sessionId: entry.sessionId,
        workingDirectory: entry.workingDirectory ?? entry.cwd ?? workspacePath,
        name: entry.name,
        shellType: entry.shellType ?? await getDefaultShellType(),
        source: entry.source,
      });

      await runStartupCommand(service, entry);
      await refreshSessions();
      return true;
    } catch (error) {
      log.error('Failed to start terminal entry', { entry, error });
      return false;
    }
  }, [refreshSessions, sessionMap, workspacePath]);

  const createManualSession = useCallback(async (
    shellTypeOverride?: string
  ): Promise<SessionResponse | null> => {
    const service = serviceRef.current;
    if (!service) {
      return null;
    }

    try {
      const session = await service.createSession({
        workingDirectory: workspacePath,
        name: manualSessionName(sessions),
        shellType: shellTypeOverride ?? await getDefaultShellType(),
        source: MANUAL_SOURCE,
      });

      await refreshSessions();
      return session;
    } catch (error) {
      log.error('Failed to create manual terminal', error);
      return null;
    }
  }, [refreshSessions, sessions, workspacePath]);

  const stopEntrySession = useCallback(async (entry: ShellEntry) => {
    const session = sessionMap.get(entry.sessionId);
    if (!session || !isSessionRunning(session)) {
      return;
    }

    await closeSessionIfPresent(entry.sessionId);
    await refreshSessions();
  }, [closeSessionIfPresent, refreshSessions, sessionMap]);

  const renameSessionLocally = useCallback((sessionId: string, newName: string) => {
    if (!sessionMap.has(sessionId)) {
      return;
    }

    setSessions((currentSessions) =>
      currentSessions.map((session) =>
        session.id === sessionId ? { ...session, name: newName } : session
      ),
    );
    dispatchTerminalNotification({
      name: 'terminal-session-renamed',
      detail: { sessionId, newName }
    });
  }, [sessionMap]);

  const hasSession = useCallback((sessionId: string) => sessionMap.has(sessionId), [sessionMap]);

  return {
    sessions,
    sessionMap,
    refreshSessions,
    startEntrySession,
    createManualSession,
    stopEntrySession,
    closeSessionIfPresent,
    renameSessionLocally,
    hasSession,
  };
}
