import { i18nService } from '@/infrastructure/i18n';
import type {
  SessionCustomMetadata,
  SessionKind,
  SessionMetadata,
} from '@/shared/types/session-history';
import type { Session } from '../types/flow-chat';

const BTW_TAG = 'btw';
const RELATIONSHIP_METADATA_KEYS = new Set([
  'kind',
  'parentSessionId',
  'parentRequestId',
  'parentDialogTurnId',
  'parentTurnIndex',
]);

const TEXT_ITEM_TYPE = 'text';
const TOOL_ITEM_TYPE = 'tool';

type SessionRelationshipInput = Pick<Session, 'sessionKind' | 'parentSessionId' | 'btwOrigin'>;

export interface ResolvedSessionRelationship {
  kind: SessionKind;
  isBtw: boolean;
  parentSessionId?: string;
  displayAsChild: boolean;
  canOpenInAuxPane: boolean;
  origin?: Session['btwOrigin'];
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeTurnIndex(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function countRoundItems(
  turn: Session['dialogTurns'][number],
  itemType: typeof TEXT_ITEM_TYPE | typeof TOOL_ITEM_TYPE
): number {
  return turn.modelRounds.reduce((sum, round) => {
    return sum + round.items.filter(item => item.type === itemType).length;
  }, 0);
}

function preserveNonRelationshipMetadata(
  existingCustomMetadata?: SessionCustomMetadata
): SessionCustomMetadata {
  return Object.entries(existingCustomMetadata || {}).reduce<SessionCustomMetadata>(
    (metadata, [key, value]) => {
      if (!RELATIONSHIP_METADATA_KEYS.has(key)) {
        metadata[key] = value;
      }
      return metadata;
    },
    {}
  );
}

export function normalizeSessionKind(value: unknown): SessionKind {
  return value === 'btw' ? 'btw' : 'normal';
}

export function normalizeSessionRelationship(
  input?: Partial<SessionRelationshipInput> | null
): Pick<Session, 'sessionKind' | 'parentSessionId' | 'btwOrigin'> {
  const sessionKind = normalizeSessionKind(input?.sessionKind);
  const parentSessionId = normalizeString(
    input?.btwOrigin?.parentSessionId ?? input?.parentSessionId
  );

  if (sessionKind !== 'btw') {
    return {
      sessionKind,
      parentSessionId: undefined,
      btwOrigin: undefined,
    };
  }

  const origin: Session['btwOrigin'] = {
    requestId: normalizeString(input?.btwOrigin?.requestId),
    parentSessionId,
    parentDialogTurnId: normalizeString(input?.btwOrigin?.parentDialogTurnId),
    parentTurnIndex: normalizeTurnIndex(input?.btwOrigin?.parentTurnIndex),
  };

  return {
    sessionKind,
    parentSessionId,
    btwOrigin: origin,
  };
}

export function resolveSessionRelationship(
  input?: Partial<SessionRelationshipInput> | null
): ResolvedSessionRelationship {
  const normalized = normalizeSessionRelationship(input);
  const isBtw = normalized.sessionKind === 'btw';

  return {
    kind: normalized.sessionKind,
    isBtw,
    parentSessionId: normalized.parentSessionId,
    displayAsChild: Boolean(normalized.parentSessionId),
    canOpenInAuxPane: Boolean(isBtw && normalized.parentSessionId),
    origin: normalized.btwOrigin,
  };
}

export function deriveSessionRelationshipFromMetadata(
  metadata?: Pick<SessionMetadata, 'customMetadata'> | null
): Pick<Session, 'sessionKind' | 'parentSessionId' | 'btwOrigin'> {
  const customMetadata = metadata?.customMetadata;
  const sessionKind = normalizeSessionKind(customMetadata?.kind);

  return normalizeSessionRelationship({
    sessionKind,
    parentSessionId: customMetadata?.parentSessionId ?? undefined,
    btwOrigin:
      sessionKind === 'btw'
        ? {
            requestId: normalizeString(customMetadata?.parentRequestId),
            parentSessionId: normalizeString(customMetadata?.parentSessionId),
            parentDialogTurnId: normalizeString(customMetadata?.parentDialogTurnId),
            parentTurnIndex: normalizeTurnIndex(customMetadata?.parentTurnIndex),
          }
        : undefined,
  });
}

export function deriveLastFinishedAtFromMetadata(
  metadata?: Pick<SessionMetadata, 'customMetadata'> | null
): number | undefined {
  const value = metadata?.customMetadata?.lastFinishedAt;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function calculateSessionStats(
  session: Pick<Session, 'dialogTurns'>
): Pick<SessionMetadata, 'turnCount' | 'messageCount' | 'toolCallCount'> {
  const turnCount = session.dialogTurns.length;
  const messageCount = session.dialogTurns.reduce((sum, turn) => {
    return sum + 1 + countRoundItems(turn, TEXT_ITEM_TYPE);
  }, 0);
  const toolCallCount = session.dialogTurns.reduce((sum, turn) => {
    return sum + countRoundItems(turn, TOOL_ITEM_TYPE);
  }, 0);

  return { turnCount, messageCount, toolCallCount };
}

function buildSessionCustomMetadata(
  session: Pick<Session, 'sessionKind' | 'parentSessionId' | 'btwOrigin' | 'lastFinishedAt'>,
  existingCustomMetadata?: SessionCustomMetadata
): SessionCustomMetadata {
  const normalized = normalizeSessionRelationship(session);
  const nextCustomMetadata = preserveNonRelationshipMetadata(existingCustomMetadata);

  nextCustomMetadata.kind = normalized.sessionKind;

  if (normalized.sessionKind === 'btw') {
    Object.assign(nextCustomMetadata, {
      parentSessionId: normalized.parentSessionId ?? null,
      parentRequestId: normalized.btwOrigin?.requestId ?? null,
      parentDialogTurnId: normalized.btwOrigin?.parentDialogTurnId ?? null,
      parentTurnIndex: normalized.btwOrigin?.parentTurnIndex ?? null,
    });
  }

  nextCustomMetadata.lastFinishedAt = session.lastFinishedAt ?? null;

  return nextCustomMetadata;
}

function mergeCount(current: number, existing?: number): number {
  return Math.max(current, existing ?? 0);
}

function resolveSessionName(
  session: Pick<Session, 'title'>,
  existingMetadata?: SessionMetadata | null
): string {
  return (
    session.title ||
    existingMetadata?.sessionName ||
    i18nService.t('flow-chat:session.new')
  );
}

function resolveAgentType(
  session: Pick<Session, 'mode' | 'config'>,
  existingMetadata?: SessionMetadata | null
): string {
  return (
    session.mode ||
    session.config.agentType ||
    existingMetadata?.agentType ||
    'agentic'
  );
}

function buildSessionTags(
  sessionKind: SessionKind,
  existingTags?: string[]
): string[] {
  const baseTags = Array.isArray(existingTags) ? [...existingTags] : [];

  if (sessionKind === 'btw' && !baseTags.includes(BTW_TAG)) {
    baseTags.push(BTW_TAG);
  }

  return baseTags;
}

export function buildSessionMetadata(
  session: Pick<
    Session,
    | 'sessionId'
    | 'title'
    | 'mode'
    | 'config'
    | 'createdAt'
    | 'workspacePath'
    | 'remoteConnectionId'
    | 'remoteSshHost'
    | 'todos'
    | 'dialogTurns'
    | 'sessionKind'
    | 'parentSessionId'
    | 'btwOrigin'
    | 'lastFinishedAt'
  >,
  existingMetadata?: SessionMetadata | null
): SessionMetadata {
  const stats = calculateSessionStats(session);
  const sessionKind = normalizeSessionKind(session.sessionKind);

  return {
    ...existingMetadata,
    sessionId: session.sessionId,
    sessionName: resolveSessionName(session, existingMetadata),
    agentType: resolveAgentType(session, existingMetadata),
    modelName:
      session.config.modelName || existingMetadata?.modelName || 'auto',
    createdAt: existingMetadata?.createdAt ?? session.createdAt,
    lastActiveAt: Date.now(),
    turnCount: mergeCount(stats.turnCount, existingMetadata?.turnCount),
    messageCount: mergeCount(stats.messageCount, existingMetadata?.messageCount),
    toolCallCount: mergeCount(stats.toolCallCount, existingMetadata?.toolCallCount),
    status: 'active',
    snapshotSessionId: existingMetadata?.snapshotSessionId,
    tags: buildSessionTags(sessionKind, existingMetadata?.tags),
    customMetadata: buildSessionCustomMetadata(
      {
        sessionKind,
        parentSessionId: session.parentSessionId,
        btwOrigin: session.btwOrigin,
        lastFinishedAt: session.lastFinishedAt,
      },
      existingMetadata?.customMetadata
    ),
    todos: session.todos || existingMetadata?.todos || [],
    workspacePath: session.workspacePath || existingMetadata?.workspacePath,
    remoteConnectionId:
      session.remoteConnectionId ?? existingMetadata?.remoteConnectionId,
    remoteSshHost: session.remoteSshHost ?? existingMetadata?.remoteSshHost,
  };
}
