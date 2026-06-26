import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { memoryAPI, MemorySearchResult, MemorySessionSummary, MemoryStatsResponse } from '@/workbench/services/api/MemoryAPI';
import { createLogger } from '@/shared/utils/logger';
import './MemoryScene.scss';

const log = createLogger('MemoryScene');

type TabId = 'search' | 'sessions' | 'stats';

interface MemorySceneProps {
  workspacePath?: string;
}

export const MemoryScene: React.FC<MemorySceneProps> = ({ workspacePath }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>('search');

  return (
    <div className="memory-scene">
      <div className="memory-scene__header">
        <h2>{t('memory.title', 'Memory Engine')}</h2>
        <div className="memory-scene__tabs">
          {(['search', 'sessions', 'stats'] as TabId[]).map((tab) => (
            <button
              key={tab}
              className={`memory-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {t(`memory.tab.${tab}`, tab)}
            </button>
          ))}
        </div>
      </div>

      <div className="memory-scene__content">
        {activeTab === 'search' && <SearchTab workspacePath={workspacePath} />}
        {activeTab === 'sessions' && <SessionsTab workspacePath={workspacePath} />}
        {activeTab === 'stats' && <StatsTab workspacePath={workspacePath} />}
      </div>
    </div>
  );
};

// ============================================================
// Search Tab
// ============================================================

const SearchTab: React.FC<{ workspacePath?: string }> = ({ workspacePath }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveContent, setSaveContent] = useState('');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    if (!workspacePath || !query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await memoryAPI.search(workspacePath, query, 20);
      setResults(resp.results);
    } catch (e: any) {
      setError(e.message || 'Search failed');
      log.error('Memory search failed', e);
    } finally {
      setLoading(false);
    }
  }, [workspacePath, query]);

  const handleSave = useCallback(async () => {
    if (!workspacePath || !saveContent.trim()) return;
    try {
      const resp = await memoryAPI.save(workspacePath, saveContent, 0.7);
      if (resp.success) {
        setSaveStatus('Saved!');
        setSaveContent('');
        setTimeout(() => setSaveStatus(null), 3000);
      }
    } catch (e: any) {
      setSaveStatus(`Error: ${e.message}`);
    }
  }, [workspacePath, saveContent]);

  const handleDelete = useCallback(async (id: string, tier: string) => {
    if (!workspacePath) return;
    try {
      await memoryAPI.delete(workspacePath, id, tier);
      setResults((prev) => prev.filter((r) => r.id !== id));
    } catch (e: any) {
      log.error('Failed to delete memory', e);
    }
  }, [workspacePath]);

  const tierColors: Record<string, string> = {
    working: '#888',
    episodic: '#4a9eff',
    semantic: '#22c55e',
    procedural: '#f59e0b',
  };

  return (
    <div className="memory-search">
      <div className="memory-search__bar">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder={t('memory.searchPlaceholder', 'Search memories...')}
          className="memory-search__input"
        />
        <button onClick={handleSearch} disabled={loading} className="memory-search__btn">
          {loading ? '...' : t('memory.search', 'Search')}
        </button>
      </div>

      {error && <div className="memory-search__error">{error}</div>}

      <div className="memory-search__results">
        {results.length === 0 && !loading && query && (
          <div className="memory-empty">{t('memory.noResults', 'No memories found')}</div>
        )}
        {results.map((r) => (
          <div key={r.id} className="memory-card">
            <div className="memory-card__header">
              <span className="memory-card__tier" style={{ color: tierColors[r.tier] || '#888' }}>
                [{r.tier}]
              </span>
              <span className="memory-card__score">score: {r.score.toFixed(2)}</span>
              <span className="memory-card__importance">importance: {r.importance.toFixed(1)}</span>
              <button
                className="memory-card__delete"
                onClick={() => handleDelete(r.id, r.tier)}
                title={t('memory.delete', 'Delete')}
              >
                &times;
              </button>
            </div>
            <div className="memory-card__content">{r.content}</div>
            <div className="memory-card__meta">
              {r.sessionId && <span>session: {r.sessionId}</span>}
              {r.tags.length > 0 && <span>tags: {r.tags.join(', ')}</span>}
              <span>{new Date(r.createdAt).toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="memory-save">
        <h4>{t('memory.saveNew', 'Save New Memory')}</h4>
        <textarea
          value={saveContent}
          onChange={(e) => setSaveContent(e.target.value)}
          placeholder={t('memory.savePlaceholder', 'Enter a fact to remember...')}
          rows={3}
        />
        <button onClick={handleSave} disabled={!saveContent.trim()}>
          {t('memory.save', 'Save')}
        </button>
        {saveStatus && <span className="memory-save__status">{saveStatus}</span>}
      </div>
    </div>
  );
};

// ============================================================
// Sessions Tab
// ============================================================

const SessionsTab: React.FC<{ workspacePath?: string }> = ({ workspacePath }) => {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<MemorySessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspacePath) return;
    setLoading(true);
    memoryAPI
      .sessions(workspacePath)
      .then(setSessions)
      .catch((e) => {
        setError(e.message);
        log.error('Failed to load sessions', e);
      })
      .finally(() => setLoading(false));
  }, [workspacePath]);

  if (loading) return <div className="memory-loading">Loading...</div>;
  if (error) return <div className="memory-error">{error}</div>;

  return (
    <div className="memory-sessions">
      {sessions.length === 0 ? (
        <div className="memory-empty">{t('memory.noSessions', 'No session summaries yet')}</div>
      ) : (
        sessions.map((s) => (
          <div key={s.sessionId} className="memory-session-card">
            <div className="memory-session-card__header">
              <span className="memory-session-card__agent">{s.agentName}</span>
              <span className="memory-session-card__tools">{s.totalTools} tools</span>
              <span className="memory-session-card__date">
                {new Date(s.startedAt).toLocaleString()}
              </span>
            </div>
            <div className="memory-session-card__summary">{s.summary}</div>
            {s.files.length > 0 && (
              <div className="memory-session-card__files">
                Files: {s.files.join(', ')}
              </div>
            )}
            {s.toolsUsed.length > 0 && (
              <div className="memory-session-card__tools-list">
                Tools: {s.toolsUsed.join(', ')}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
};

// ============================================================
// Stats Tab
// ============================================================

const StatsTab: React.FC<{ workspacePath?: string }> = ({ workspacePath }) => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<MemoryStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workspacePath) return;
    setLoading(true);
    memoryAPI
      .stats(workspacePath)
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workspacePath]);

  if (loading) return <div className="memory-loading">Loading...</div>;
  if (!stats) return <div className="memory-empty">No stats available</div>;

  const total = stats.workingCount + stats.episodicCount + stats.semanticCount + stats.proceduralCount;

  const tiers = [
    { label: 'Working', count: stats.workingCount, color: '#888' },
    { label: 'Episodic', count: stats.episodicCount, color: '#4a9eff' },
    { label: 'Semantic', count: stats.semanticCount, color: '#22c55e' },
    { label: 'Procedural', count: stats.proceduralCount, color: '#f59e0b' },
  ];

  return (
    <div className="memory-stats">
      <div className="memory-stats__summary">
        <div className="memory-stats__total">
          <span className="memory-stats__number">{total}</span>
          <span className="memory-stats__label">{t('memory.totalMemories', 'Total Memories')}</span>
        </div>
        <div className="memory-stats__sessions-count">
          <span className="memory-stats__number">{stats.sessionCount}</span>
          <span className="memory-stats__label">{t('memory.totalSessions', 'Sessions')}</span>
        </div>
      </div>

      <div className="memory-stats__tiers">
        {tiers.map((tier) => (
          <div key={tier.label} className="memory-stats__tier">
            <div className="memory-stats__tier-bar">
              <div
                className="memory-stats__tier-fill"
                style={{
                  width: total > 0 ? `${(tier.count / total) * 100}%` : '0%',
                  backgroundColor: tier.color,
                }}
              />
            </div>
            <div className="memory-stats__tier-label">
              <span style={{ color: tier.color }}>{tier.label}</span>
              <span>{tier.count}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MemoryScene;
