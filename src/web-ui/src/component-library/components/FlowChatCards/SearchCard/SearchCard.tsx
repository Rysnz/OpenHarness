import React, { useState, useMemo } from 'react';
import {
  Search,
  File,
  FolderOpen,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle,
  XCircle,
  Clock
} from 'lucide-react';
import { useI18n } from '@/infrastructure/i18n';
import { BaseToolCard, BaseToolCardProps } from '../BaseToolCard';
import './SearchCard.scss';

type SearchType = 'grep' | 'glob';
type SearchMatch = any;
type SearchSummary = {
  matches: number;
  files: number;
};
type TopFile = {
  file: string;
  count: number;
};

export interface SearchCardProps extends Omit<BaseToolCardProps, 'toolName' | 'displayName'> {
  searchType?: SearchType;
  pattern?: string;
  searchPath?: string;
  matches?: SearchMatch[];
}

const SEARCH_STYLE: Record<SearchType, { toolName: string; color: string; Icon: typeof Search }> = {
  grep: {
    toolName: 'Grep',
    color: '#8b5cf6',
    Icon: Search
  },
  glob: {
    toolName: 'Glob',
    color: '#06b6d4',
    Icon: FolderOpen
  }
};

const firstDefined = (...values: any[]): any => (
  values.find((value) => value !== undefined && value !== null && value !== '')
);

const extractMatchPath = (match: SearchMatch): string | null => {
  const value = match?.file || match?.filename || match?.path || match;
  return typeof value === 'string' && value ? value : null;
};

const extractMatches = (matches: SearchMatch[] | undefined, result: any): SearchMatch[] => {
  if (matches) return matches;
  if (!result) return [];
  if (Array.isArray(result)) return result;

  for (const key of ['matches', 'results', 'files']) {
    if (Array.isArray(result[key])) {
      return result[key];
    }
  }

  return [];
};

const summarizeMatches = (searchMatches: SearchMatch[]): SearchSummary => {
  if (searchMatches.length === 0) {
    return { matches: 0, files: 0 };
  }

  return {
    matches: searchMatches.length,
    files: new Set(searchMatches.map(extractMatchPath).filter(Boolean)).size
  };
};

const getTopFiles = (searchMatches: SearchMatch[]): TopFile[] => {
  const counts = new Map<string, number>();

  searchMatches.forEach((match) => {
    const file = extractMatchPath(match);
    if (file) {
      counts.set(file, (counts.get(file) || 0) + 1);
    }
  });

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([file, count]) => ({ file, count }));
};

const StatusIcon: React.FC<{ status: SearchCardProps['status'] }> = ({ status }) => {
  switch (status) {
    case 'running':
    case 'streaming':
      return <Loader2 className="search-card__status-spinner" size={12} />;
    case 'completed':
      return <CheckCircle className="search-card__status-success" size={12} />;
    case 'error':
      return <XCircle className="search-card__status-error" size={12} />;
    default:
      return <Clock className="search-card__status-pending" size={12} />;
  }
};

const SearchInfo: React.FC<{
  patternLabel: string;
  pathLabel: string;
  pattern: string;
  path: string;
}> = ({ patternLabel, pathLabel, pattern, path }) => (
  <div className="search-card__info">
    <div className="search-card__info-row">
      <span className="search-card__label">{patternLabel}:</span>
      <span className="search-card__value">{pattern}</span>
    </div>
    <div className="search-card__info-row">
      <span className="search-card__label">{pathLabel}:</span>
      <span className="search-card__value">{path}</span>
    </div>
  </div>
);

const SearchStats: React.FC<{
  stats: SearchSummary;
  matchesLabel: string;
  filesLabel: string;
}> = ({ stats, matchesLabel, filesLabel }) => (
  <div className="search-card__stats-box">
    <div className="search-card__stat-item">
      <span className="search-card__stat-value">{stats.matches}</span>
      <span className="search-card__stat-label">{matchesLabel}</span>
    </div>
    <div className="search-card__stat-item">
      <span className="search-card__stat-value">{stats.files}</span>
      <span className="search-card__stat-label">{filesLabel}</span>
    </div>
  </div>
);

export const SearchCard: React.FC<SearchCardProps> = ({
  searchType = 'grep',
  pattern,
  searchPath,
  matches,
  input,
  result,
  status = 'pending',
  displayMode = 'compact',
  ...baseProps
}) => {
  const { t } = useI18n('components');
  const [isExpanded, setIsExpanded] = useState(false);
  const isGrepSearch = searchType === 'grep';
  const style = SEARCH_STYLE[searchType];
  const CardIcon = style.Icon;

  const searchPattern = useMemo(() => {
    const fallback = t('flowChatCards.searchCard.unspecifiedPattern');
    return isGrepSearch
      ? firstDefined(pattern, input?.pattern, input?.search_pattern, input?.query, input?.text, fallback)
      : firstDefined(pattern, input?.pattern, input?.glob_pattern, input?.query, fallback);
  }, [input, isGrepSearch, pattern, t]);

  const resolvedPath = useMemo(() => (
    firstDefined(searchPath, input?.path, t('flowChatCards.searchCard.currentDir'))
  ), [input, searchPath, t]);

  const searchMatches = useMemo(() => extractMatches(matches, result), [matches, result]);
  const stats = useMemo(() => summarizeMatches(searchMatches), [searchMatches]);
  const topFiles = useMemo(() => getTopFiles(searchMatches), [searchMatches]);
  const cardTitle = isGrepSearch
    ? t('flowChatCards.searchCard.grepTitle')
    : t('flowChatCards.searchCard.globTitle');

  if (displayMode === 'compact') {
    return (
      <div className={`search-card search-card--compact search-card--${searchType} status-${status}`}>
        <CardIcon className="search-card__icon" size={14} />
        <span className="search-card__action">{cardTitle}:</span>
        <span className="search-card__pattern">"{searchPattern}"</span>
        {status === 'completed' && stats.matches > 0 && (
          <span className="search-card__result">
            -&gt; {stats.matches} {t('flowChatCards.searchCard.matches')}
          </span>
        )}
        <span className="search-card__status">
          <StatusIcon status={status} />
        </span>
      </div>
    );
  }

  return (
    <BaseToolCard
      toolName={style.toolName}
      displayName={cardTitle}
      icon={<CardIcon size={18} />}
      description={isGrepSearch ? t('flowChatCards.searchCard.grepDesc') : t('flowChatCards.searchCard.globDesc')}
      status={status}
      displayMode={displayMode}
      input={input}
      result={result}
      primaryColor={style.color}
      className={`search-card search-card--${searchType}`}
      {...baseProps}
    >
      <SearchInfo
        patternLabel={t('flowChatCards.searchCard.pattern')}
        pathLabel={t('flowChatCards.searchCard.path')}
        pattern={searchPattern}
        path={resolvedPath}
      />

      {status === 'completed' && (
        <SearchStats
          stats={stats}
          matchesLabel={t('flowChatCards.searchCard.matches')}
          filesLabel={t('flowChatCards.searchCard.files')}
        />
      )}

      {status === 'completed' && topFiles.length > 0 && (
        <div className="search-card__top-files">
          <button
            className="search-card__expand-button"
            onClick={() => setIsExpanded((expanded) => !expanded)}
          >
            <File size={14} />
            <span>{t('flowChatCards.searchCard.matchingFiles')} ({topFiles.length})</span>
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {isExpanded && (
            <div className="search-card__file-list">
              {topFiles.map(({ file, count }) => (
                <div key={file} className="search-card__file-item">
                  <File size={12} />
                  <span className="search-card__file-name" title={file}>
                    {file.split('/').pop() || file}
                  </span>
                  <span className="search-card__file-count">
                    {t('flowChatCards.searchCard.matchCount', { count })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {status === 'completed' && stats.matches === 0 && (
        <div className="search-card__no-results">
          {isGrepSearch ? t('flowChatCards.searchCard.noTextMatch') : t('flowChatCards.searchCard.noFileMatch')}
        </div>
      )}
    </BaseToolCard>
  );
};
