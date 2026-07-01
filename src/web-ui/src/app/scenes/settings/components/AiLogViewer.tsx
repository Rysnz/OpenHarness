/**
 * AiLogViewer — AI call log browser.
 * Fully defensive against undefined/null data from backend.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Loader2, ChevronDown, ChevronRight, AlertCircle, Brain, MessageSquare, Wrench } from 'lucide-react';
import './AiLogViewer.scss';

interface LogFileMeta {
  filename: string;
  timestampMs: number | null;
  sizeBytes: number;
}

interface SessionSummary {
  sessionId: string;
  fileCount: number;
  latestTimestamp: string | null;
  files: LogFileMeta[];
}

interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface RoundLogEntry {
  timestamp: string;
  sessionId: string;
  dialogTurnId: string;
  roundId: string;
  agentType: string;
  model: string;
  thinkingEnabled: boolean;
  attemptIndex: number;
  request: {
    messageCount: number;
    systemPromptPreview: string;
    lastUserMessage: string;
    totalMessageChars: number;
    tools: string[];
    toolCount: number;
    messageSummary?: { role: string; contentLen: number; contentPreview: string }[];
  };
  response: {
    thinkingLen: number;
    textLen: number;
    toolCalls: { name: string; argumentsPreview: string }[];
    finishReason: string | null;
    usage: UsageInfo | null;
    hasEffectiveOutput: boolean;
    partialRecoveryReason: string | null;
    error: string | null;
    textFull: string;
    thinkingFull: string;
  };
}

// ── Error boundary ──
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(e: Error) { return { error: e }; }
  render() {
    if (this.state.error) {
      return <div className="ai-log-viewer__error"><AlertCircle size={16} /><span>{this.state.error.message}</span></div>;
    }
    return this.props.children;
  }
}

// ── Main component ──
const AiLogViewer: React.FC = () => {
  const { t } = useTranslation('settings/basics');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadSessions(); }, []);

  const loadSessions = async () => {
    setLoading(true);
    setError(null);
    setSessions([]);
    try {
      const raw = await invoke<any>('list_ai_request_logs');
      if (Array.isArray(raw)) {
        setSessions(raw.filter((s: any) => s && s.sessionId && Array.isArray(s.files)));
      } else {
        setSessions([]);
      }
    } catch (e: any) {
      setSessions([]);
      setError(typeof e === 'string' ? e : (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="ai-log-viewer__loading"><Loader2 size={24} className="ai-log-viewer__spinner" /><span>{t('logging.aiLogs.loading')}</span></div>;
  if (error) return <div className="ai-log-viewer__error"><AlertCircle size={16} /><span>{error}</span><button onClick={loadSessions}>{t('logging.aiLogs.retry')}</button></div>;
  if (!sessions.length) return <div className="ai-log-viewer__empty"><p>{t('logging.aiLogs.empty')}</p><p className="ai-log-viewer__hint">{t('logging.aiLogs.emptyHint')}</p></div>;

  return (
    <ErrorBoundary>
      <div className="ai-log-viewer">
        <div className="ai-log-viewer__header">
          <h2>{t('logging.sections.aiLogs')}</h2>
          <button className="ai-log-viewer__refresh-btn" onClick={loadSessions}>{t('logging.aiLogs.refresh')}</button>
        </div>
        <div className="ai-log-viewer__sessions">
          {sessions.map(s => (
            <SessionRow key={s.sessionId} session={s} t={t} />
          ))}
        </div>
      </div>
    </ErrorBoundary>
  );
};

// ── Session row ──
const SessionRow: React.FC<{ session: SessionSummary; t: any }> = ({ session, t }) => {
  const [open, setOpen] = useState(false);
  const files = Array.isArray(session.files) ? session.files : [];

  return (
    <div className="ai-log-viewer__session">
      <div className="ai-log-viewer__session-header" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="ai-log-viewer__session-id">{(session.sessionId || '').slice(0, 12)}…</span>
        <span className="ai-log-viewer__session-meta">
          {files.length} {t('logging.aiLogs.logsCount')}
          {session.latestTimestamp && <> · {(session.latestTimestamp || '').slice(0, 19)}</>}
        </span>
      </div>
      {open && (
        <div className="ai-log-viewer__session-files">
          {files.map(f => <FileRow key={f.filename} sessionId={session.sessionId} file={f} t={t} />)}
        </div>
      )}
    </div>
  );
};

// ── File row ──
const FileRow: React.FC<{ sessionId: string; file: LogFileMeta; t: any }> = ({ sessionId, file, t }) => {
  const [entry, setEntry] = useState<RoundLogEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(false);

  useEffect(() => {
    setLoading(true);
    invoke<any>('read_ai_request_log', { sessionId, filename: file.filename })
      .then(data => { if (data && data.request && data.response) setEntry(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="ai-log-viewer__entry ai-log-viewer__entry--loading"><Loader2 size={12} className="ai-log-viewer__spinner" /><span>{file.filename}</span></div>;
  if (!entry) return <div className="ai-log-viewer__entry"><div className="ai-log-viewer__entry-bar"><span>{file.filename}</span></div></div>;

  const fmt = (ts: number | null) => ts ? new Date(ts).toLocaleString() : '-';
  const r = entry.response || {};
  const req = entry.request || {};

  return (
    <div className={`ai-log-viewer__entry ${!r.hasEffectiveOutput ? 'ai-log-viewer__entry--no-output' : ''}`}>
      <div className="ai-log-viewer__entry-bar" onClick={() => setDetail(!detail)}>
        <div className="ai-log-viewer__entry-summary">
          <span className="ai-log-viewer__entry-model">{entry.model || '?'}</span>
          {entry.agentType && <span className="ai-log-viewer__entry-agent">{entry.agentType}</span>}
          {entry.attemptIndex > 0 && <span className="ai-log-viewer__entry-attempt">{t('logging.aiLogs.retryN', { n: entry.attemptIndex })}</span>}
          <span className="ai-log-viewer__entry-stats"><MessageSquare size={12} /> {req.messageCount || 0} <Wrench size={12} /> {Array.isArray(r.toolCalls) ? r.toolCalls.length : 0} <Brain size={12} /> {r.thinkingLen || 0}c</span>
          {!r.hasEffectiveOutput && <span className="ai-log-viewer__entry-warning">{t('logging.aiLogs.noOutput')}</span>}
          {r.error && <span className="ai-log-viewer__entry-error">{t('logging.aiLogs.error')}</span>}
        </div>
        <div className="ai-log-viewer__entry-meta">
          <span>{fmt(file.timestampMs)}</span>
          <span>{file.sizeBytes ? `${(file.sizeBytes / 1024).toFixed(1)} KB` : '-'}</span>
          {r.usage && <span className="ai-log-viewer__entry-tokens">{r.usage.inputTokens}→{r.usage.outputTokens} tok</span>}
        </div>
      </div>
      {detail && (
        <div className="ai-log-viewer__entry-detail">
          <Block label={t('logging.aiLogs.lastUserMessage')} text={req.lastUserMessage || ''} />
          {req.toolCount > 0 && <Block label={t('logging.aiLogs.tools')} text={Array.isArray(req.tools) ? req.tools.join(', ') : ''} />}
          {Array.isArray(req.messageSummary) && req.messageSummary.length > 0 && (
            <Block
              label={'发送的 AI 消息'}
              text={req.messageSummary.map((m: any) => `[${m.role}] (${m.contentLen}c) ${m.contentPreview}`).join('\n---\n')}
              scroll
            />
          )}
          {r.thinkingLen > 0 && <Block label={t('logging.aiLogs.thinking')} text={r.thinkingFull || ''} scroll />}
          {r.textLen > 0 && <Block label={t('logging.aiLogs.responseText')} text={r.textFull || ''} />}
          {!r.textLen && r.thinkingLen > 0 && <div className="ai-log-viewer__detail-warning">{t('logging.aiLogs.thinkingOnlyWarning')}</div>}
          {r.error && <Block label={t('logging.aiLogs.errorLabel')} text={r.error} err />}
          <div className="ai-log-viewer__detail-meta">
            <span>{t('logging.aiLogs.finish')}: {r.finishReason || '?'}</span>
            <span>{t('logging.aiLogs.thinkingEnabled')}: {entry.thinkingEnabled ? t('logging.aiLogs.yes') : t('logging.aiLogs.no')}</span>
            <span>{t('logging.aiLogs.attempt')}: {entry.attemptIndex}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const Block: React.FC<{ label: string; text: string; scroll?: boolean; err?: boolean }> = ({ label, text, scroll, err }) => {
  const { t } = useTranslation('settings/basics');
  return (
    <div className="ai-log-viewer__detail-block">
      <div className="ai-log-viewer__detail-label">{label}</div>
      <pre className={`ai-log-viewer__detail-content${scroll ? ' ai-log-viewer__detail-content--scroll' : ''}${err ? ' ai-log-viewer__detail-content--error' : ''}`}>{text || t('logging.aiLogs.emptyContent')}</pre>
    </div>
  );
};

export default AiLogViewer;
