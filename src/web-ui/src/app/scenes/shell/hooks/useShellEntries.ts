import { useCallback, useMemo, useState } from 'react';
import { useCurrentWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { openShellSessionTarget } from '@/shared/services/openShellSessionTarget';
import {
  AGENT_SOURCE,
  compareShellEntries,
  createManualProfileEntry,
  createSessionEntry,
  MANUAL_SOURCE,
  type SaveShellEntryInput,
  type ShellEntry,
} from './shellEntryTypes';
import { useManualTerminalProfiles } from './useManualTerminalProfiles';
import { useTerminalSessions } from './useTerminalSessions';

interface EditingTerminalState {
  entry: ShellEntry;
}

type TerminalSession = ReturnType<typeof useTerminalSessions>['sessions'][number];
type TerminalProfile = ReturnType<typeof useManualTerminalProfiles>['profiles'][number];

export interface UseShellEntriesReturn {
  manualEntries: ShellEntry[];
  agentEntries: ShellEntry[];
  editModalOpen: boolean;
  editingTerminal: EditingTerminalState | null;
  closeEditModal: () => void;
  refresh: () => Promise<void>;
  createManualTerminal: (shellType?: string) => Promise<void>;
  openEntry: (entry: ShellEntry) => Promise<void>;
  startEntry: (entry: ShellEntry) => Promise<boolean>;
  stopEntry: (entry: ShellEntry) => Promise<void>;
  deleteEntry: (entry: ShellEntry) => Promise<void>;
  openEditModal: (entry: ShellEntry) => void;
  saveEdit: (input: SaveShellEntryInput) => void;
}

function buildManualEntries(
  profiles: TerminalProfile[],
  sessions: TerminalSession[],
  sessionMap: Map<string, TerminalSession>,
  profilesBySessionId: Map<string, TerminalProfile>
): ShellEntry[] {
  const profileEntries = profiles.map((profile) =>
    createManualProfileEntry(profile, sessionMap.get(profile.sessionId))
  );
  const ephemeralEntries = sessions
    .filter((session) => session.source === MANUAL_SOURCE && !profilesBySessionId.has(session.id))
    .map((session) => createSessionEntry(session, 'manual-session'));

  return [...profileEntries, ...ephemeralEntries].sort(compareShellEntries);
}

function buildAgentEntries(sessions: TerminalSession[]): ShellEntry[] {
  return sessions
    .filter((session) => session.source === AGENT_SOURCE)
    .map((session) => createSessionEntry(session, 'agent-session'))
    .sort(compareShellEntries);
}

function resolveWorkingDirectory(
  input: SaveShellEntryInput,
  entry: ShellEntry,
  workspacePath: string
): string {
  return input.workingDirectory ?? entry.workingDirectory ?? entry.cwd ?? workspacePath;
}

export function useShellEntries(): UseShellEntriesReturn {
  const { workspacePath, workspace } = useCurrentWorkspace();
  const isRemote = workspace?.workspaceKind === 'remote';
  const currentConnectionId = workspace?.connectionId ?? null;

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingTerminal, setEditingTerminal] = useState<EditingTerminalState | null>(null);

  const {
    profiles,
    profilesBySessionId,
    refreshProfiles,
    saveProfile,
    removeProfile,
    getProfileById,
    getProfileBySessionId,
  } = useManualTerminalProfiles(workspacePath);
  const {
    sessions,
    sessionMap,
    refreshSessions,
    startEntrySession,
    createManualSession,
    stopEntrySession,
    closeSessionIfPresent,
    renameSessionLocally,
    hasSession,
  } = useTerminalSessions({
    workspacePath,
    isRemote,
    currentConnectionId,
  });

  const manualEntries = useMemo<ShellEntry[]>(
    () => buildManualEntries(profiles, sessions, sessionMap, profilesBySessionId),
    [profiles, profilesBySessionId, sessionMap, sessions]
  );

  const agentEntries = useMemo<ShellEntry[]>(
    () => buildAgentEntries(sessions),
    [sessions]
  );

  const refresh = useCallback(async () => {
    await refreshSessions();
    refreshProfiles();
  }, [refreshProfiles, refreshSessions]);

  const openShellSession = useCallback((sessionId: string, sessionName: string) => {
    openShellSessionTarget({ sessionId, sessionName });
  }, []);

  const startEntry = useCallback(
    (entry: ShellEntry) => startEntrySession(entry),
    [startEntrySession],
  );

  const openEntry = useCallback(async (entry: ShellEntry) => {
    if (!entry.isRunning) {
      const started = await startEntry(entry);
      if (!started) {
        return;
      }
    }

    openShellSession(entry.sessionId, entry.name);
  }, [openShellSession, startEntry]);

  const createManualTerminal = useCallback(async (shellType?: string) => {
    const session = await createManualSession(shellType);
    if (session) {
      openShellSession(session.id, session.name);
    }
  }, [createManualSession, openShellSession]);

  const stopEntry = useCallback(async (entry: ShellEntry) => {
    await stopEntrySession(entry);
  }, [stopEntrySession]);

  const deleteEntry = useCallback(async (entry: ShellEntry) => {
    if (entry.profileId) {
      removeProfile(entry.profileId);
    }

    if (hasSession(entry.sessionId)) {
      await closeSessionIfPresent(entry.sessionId);
    }

    await refreshSessions();
  }, [closeSessionIfPresent, hasSession, refreshSessions, removeProfile]);

  const openEditModal = useCallback((entry: ShellEntry) => {
    setEditingTerminal({ entry });
    setEditModalOpen(true);
  }, []);

  const closeEditModal = useCallback(() => {
    setEditModalOpen(false);
    setEditingTerminal(null);
  }, []);

  const saveEdit = useCallback((input: SaveShellEntryInput) => {
    if (!editingTerminal || !workspacePath) {
      return;
    }

    const entry = editingTerminal.entry;
    const existingProfile = entry.profileId
      ? getProfileById(entry.profileId)
      : getProfileBySessionId(entry.sessionId);

    saveProfile({
      id: existingProfile?.id,
      sessionId: entry.sessionId,
      name: input.name,
      workingDirectory: resolveWorkingDirectory(input, entry, workspacePath),
      startupCommand: input.startupCommand,
      shellType: entry.shellType,
    });

    if (hasSession(entry.sessionId)) {
      renameSessionLocally(entry.sessionId, input.name);
    }

    closeEditModal();
  }, [closeEditModal, editingTerminal, getProfileById, getProfileBySessionId, hasSession, renameSessionLocally, saveProfile, workspacePath]);

  return {
    manualEntries,
    agentEntries,
    editModalOpen,
    editingTerminal,
    closeEditModal,
    refresh,
    createManualTerminal,
    openEntry,
    startEntry,
    stopEntry,
    deleteEntry,
    openEditModal,
    saveEdit,
  };
}
