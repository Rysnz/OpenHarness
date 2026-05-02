import React from 'react';
import { Archive, CheckCircle, Loader2, XCircle } from 'lucide-react';
import { useI18n } from '@/infrastructure/i18n';
import { BaseToolCard, BaseToolCardProps } from '../BaseToolCard';
import './ContextCompressionCard.scss';

type CompressionStatus = NonNullable<BaseToolCardProps['status']>;
type Translate = ReturnType<typeof useI18n>['t'];

export interface ContextCompressionCardProps extends Omit<BaseToolCardProps, 'toolName' | 'displayName'> {
  compressionCount?: number;
  hasSummary?: boolean;
  tokensBefore?: number;
  tokensAfter?: number;
  compressionRatio?: number;
  duration?: number;
  summaryContent?: string;
  trigger?: 'user_message' | 'tool_batch' | 'ai_response' | 'manual';
  compressionTiers?: {
    tier1?: { before: number; after: number; saved: number };
    tier2_3?: { before: number; after: number; saved: number };
    tier4_plus?: { before: number; after: number; saved: number };
  };
}

interface CompressionMetrics {
  count: number;
  tokensBefore?: number;
  tokensAfter?: number;
  ratio?: number;
  duration?: number;
  trigger: string;
  savedTokens?: number;
}

function resolveCompressionMetrics(props: ContextCompressionCardProps): CompressionMetrics {
  const { compressionCount = 1, tokensBefore, tokensAfter, compressionRatio, duration, trigger = 'manual' } = props;
  const { input, result } = props;
  const resolvedTokensBefore = tokensBefore || result?.tokens_before || input?.tokens_before;
  const resolvedTokensAfter = tokensAfter || result?.tokens_after || input?.tokens_after;
  const ratio =
    compressionRatio ||
    result?.compression_ratio ||
    (resolvedTokensBefore && resolvedTokensAfter ? resolvedTokensAfter / resolvedTokensBefore : undefined);

  return {
    count: compressionCount || result?.compression_count || 1,
    tokensBefore: resolvedTokensBefore,
    tokensAfter: resolvedTokensAfter,
    ratio,
    duration: duration || result?.duration,
    trigger: trigger || result?.trigger || input?.trigger || 'manual',
    savedTokens:
      resolvedTokensBefore && resolvedTokensAfter ? resolvedTokensBefore - resolvedTokensAfter : undefined,
  };
}

function triggerText(triggerType: string, t: Translate): string {
  const keyByTrigger: Record<string, string> = {
    user_message: 'triggerBeforeUserMessage',
    tool_batch: 'triggerAfterToolBatch',
    ai_response: 'triggerAfterAiResponse',
    manual: 'triggerManual',
  };

  return t(`flowChatCards.contextCompressionCard.${keyByTrigger[triggerType] || 'triggerAuto'}`);
}

function durationText(duration: number): string {
  return duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(2)}s`;
}

function tokenTransition(metrics: CompressionMetrics): string | null {
  if (metrics.tokensBefore === undefined || metrics.tokensAfter === undefined) {
    return null;
  }

  return `${metrics.tokensBefore.toLocaleString()} -> ${metrics.tokensAfter.toLocaleString()} tokens`;
}

function savedTokenText(metrics: CompressionMetrics, t: Translate, precision: number): string | null {
  if (metrics.savedTokens === undefined || metrics.ratio === undefined) {
    return null;
  }

  return t('flowChatCards.contextCompressionCard.savedTokens', {
    count: metrics.savedTokens.toLocaleString(),
    ratio: (metrics.ratio * 100).toFixed(precision),
  });
}

function statusIcon(status: CompressionStatus, size = 14): React.ReactElement {
  switch (status) {
    case 'running':
    case 'streaming':
      return <Loader2 className="context-compression-card__status-spinner" size={size} />;
    case 'completed':
      return <CheckCircle className="context-compression-card__status-success" size={size} />;
    case 'error':
      return <XCircle className="context-compression-card__status-error" size={size} />;
    default:
      return <Archive className="context-compression-card__status-pending" size={size} />;
  }
}

function isProcessing(status: CompressionStatus): boolean {
  return status === 'running' || status === 'streaming';
}

interface CompactCompressionCardProps {
  metrics: CompressionMetrics;
  status: CompressionStatus;
  t: Translate;
}

function CompactCompressionCard({ metrics, status, t }: CompactCompressionCardProps): React.ReactElement {
  const transition = tokenTransition(metrics);
  const saved = savedTokenText(metrics, t, 0);

  return (
    <div className={`context-compression-card context-compression-card--compact status-${status}`}>
      <span className="context-compression-card__status-icon">{statusIcon(status, 14)}</span>
      <span className="context-compression-card__action">
        {isProcessing(status)
          ? t('flowChatCards.contextCompressionCard.compressing')
          : t('flowChatCards.contextCompressionCard.title')}
      </span>
      {transition && <span className="context-compression-card__tokens">{transition}</span>}
      {status === 'completed' && saved && <span className="context-compression-card__result">{saved}</span>}
    </div>
  );
}

interface CompressionDetailsProps {
  metrics: CompressionMetrics;
  status: CompressionStatus;
  t: Translate;
}

function CompressionDetails({ metrics, status, t }: CompressionDetailsProps): React.ReactElement | null {
  if (isProcessing(status)) {
    return (
      <div className="context-compression-card__processing">
        <Loader2 className="context-compression-card__processing-icon" size={14} />
        <span>{t('flowChatCards.contextCompressionCard.analyzing')}</span>
      </div>
    );
  }

  if (status !== 'completed') {
    return null;
  }

  const transition = tokenTransition(metrics);
  const saved = savedTokenText(metrics, t, 1);

  return (
    <>
      <div className="context-compression-card__simple-row">
        <span className="context-compression-card__simple-label">
          {t('flowChatCards.contextCompressionCard.triggerTime', {
            trigger: triggerText(metrics.trigger, t),
            count: metrics.count,
          })}
        </span>
        {metrics.duration !== undefined && (
          <span className="context-compression-card__simple-duration">
            {t('flowChatCards.contextCompressionCard.duration')} {durationText(metrics.duration)}
          </span>
        )}
      </div>

      {transition && (
        <div className="context-compression-card__simple-row context-compression-card__simple-row--stats">
          <span className="context-compression-card__simple-tokens">{transition}</span>
          {saved && <span className="context-compression-card__simple-savings">{saved}</span>}
        </div>
      )}
    </>
  );
}

export const ContextCompressionCard: React.FC<ContextCompressionCardProps> = ({
  status = 'pending',
  displayMode = 'standard',
  input,
  result,
  ...baseProps
}) => {
  const { t } = useI18n('components');
  const metrics = resolveCompressionMetrics({ ...baseProps, input, result, status, displayMode });

  if (displayMode === 'compact') {
    return <CompactCompressionCard metrics={metrics} status={status} t={t} />;
  }

  return (
    <BaseToolCard
      toolName="ContextCompression"
      displayName={t('flowChatCards.contextCompressionCard.title')}
      icon={statusIcon(status, 16)}
      description={t('flowChatCards.contextCompressionCard.description')}
      status={status}
      displayMode={displayMode}
      input={input}
      result={result}
      primaryColor="#a855f7"
      className="context-compression-card"
      {...baseProps}
    >
      <CompressionDetails metrics={metrics} status={status} t={t} />
    </BaseToolCard>
  );
};
