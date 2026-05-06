import type { Session } from '../types/flow-chat';
import { isSamePath, normalizeRemoteWorkspacePath } from '@/shared/utils/pathUtils';

const SSH_CONNECTION_PATTERN = /^ssh-[^@]+@(.+):(\d+)$/;

function hostFromSshConnectionId(connectionId: string): string | null {
  const match = connectionId.trim().match(SSH_CONNECTION_PATTERN);
  return match?.[1].trim().toLowerCase() || null;
}

function effectiveWorkspaceSshHost(
  remoteSshHost?: string | null,
  remoteConnectionId?: string | null
): string {
  const explicitHost = remoteSshHost?.trim().toLowerCase() ?? '';
  return explicitHost || hostFromSshConnectionId(remoteConnectionId ?? '') || '';
}

export function sessionBelongsToWorkspaceNavRow(
  session: Pick<Session, 'workspacePath' | 'remoteConnectionId' | 'remoteSshHost'>,
  workspacePath: string,
  remoteConnectionId?: string | null,
  remoteSshHost?: string | null
): boolean {
  const sessionRoot = session.workspacePath || workspacePath;
  const pathsMatch =
    isSamePath(sessionRoot, workspacePath) ||
    normalizeRemoteWorkspacePath(sessionRoot) === normalizeRemoteWorkspacePath(workspacePath);

  const workspaceConnection = remoteConnectionId?.trim() ?? '';
  const sessionConnection = session.remoteConnectionId?.trim() ?? '';
  const workspaceHost = effectiveWorkspaceSshHost(remoteSshHost, remoteConnectionId);
  const sessionHost = session.remoteSshHost?.trim().toLowerCase() ?? '';
  const sessionConnectionHost = hostFromSshConnectionId(sessionConnection);
  const workspaceConnectionHost = hostFromSshConnectionId(workspaceConnection);

  if (workspaceHost.length > 0) {
    if (sessionHost === workspaceHost && pathsMatch) {
      return true;
    }

    if (sessionConnectionHost === workspaceHost && pathsMatch) {
      return true;
    }

    if (sessionConnectionHost && workspaceConnectionHost && sessionConnectionHost === workspaceConnectionHost) {
      return pathsMatch;
    }
  }

  if (!pathsMatch) {
    return false;
  }

  if (workspaceConnection.length > 0 || sessionConnection.length > 0) {
    return sessionConnection === workspaceConnection;
  }

  return true;
}

export function getSessionSortTimestamp(session: Pick<Session, 'createdAt' | 'lastFinishedAt'>): number {
  return session.lastFinishedAt ?? session.createdAt;
}

export function compareSessionsForDisplay(
  a: Pick<Session, 'sessionId' | 'createdAt' | 'lastFinishedAt'>,
  b: Pick<Session, 'sessionId' | 'createdAt' | 'lastFinishedAt'>
): number {
  const byActivity = getSessionSortTimestamp(b) - getSessionSortTimestamp(a);
  if (byActivity !== 0) {
    return byActivity;
  }

  const byCreation = b.createdAt - a.createdAt;
  if (byCreation !== 0) {
    return byCreation;
  }

  return a.sessionId.localeCompare(b.sessionId);
}
