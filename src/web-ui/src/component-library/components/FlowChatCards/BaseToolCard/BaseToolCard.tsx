/**
 * Base Tool Card Component
 * Provides common layout and state management for all tool cards
 */

import React from 'react';
import { Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useI18n } from '@/infrastructure/i18n';
import './BaseToolCard.scss';

type ToolCardStatus = 'pending' | 'preparing' | 'running' | 'streaming' | 'completed' | 'cancelled' | 'error';
type Translate = ReturnType<typeof useI18n>['t'];

export interface BaseToolCardProps {
  toolName: string;
  displayName: string;
  icon?: React.ReactNode | string;
  description?: string;
  primaryColor?: string;
  status?: 'pending' | 'preparing' | 'running' | 'streaming' | 'completed' | 'error';
  displayMode?: 'compact' | 'standard' | 'detailed';
  requiresConfirmation?: boolean;
  userConfirmed?: boolean;
  input?: Record<string, any>;
  result?: any;
  error?: string;
  children?: React.ReactNode;
  onConfirm?: (input?: any) => void;
  onReject?: () => void;
  onExpand?: () => void;
  className?: string;
}

function cardClassName(displayMode: BaseToolCardProps['displayMode'], status: ToolCardStatus, className: string): string {
  return ['base-tool-card', `base-tool-card--${displayMode}`, `base-tool-card--${status}`, className]
    .filter(Boolean)
    .join(' ');
}

function primaryColorStyle(primaryColor: string): React.CSSProperties {
  return { '--primary-color': primaryColor } as React.CSSProperties;
}

function renderToolIcon(icon: BaseToolCardProps['icon']): React.ReactNode {
  const iconClassName = typeof icon === 'string' ? 'base-tool-card__icon-emoji' : 'base-tool-card__icon';
  return <span className={iconClassName}>{icon}</span>;
}

function statusIconFor(status: ToolCardStatus): React.ReactElement {
  switch (status) {
    case 'preparing':
      return <Loader2 className="base-tool-card__status-spinner base-tool-card__status-preparing" size={12} />;
    case 'running':
    case 'streaming':
      return <Loader2 className="base-tool-card__status-spinner" size={12} />;
    case 'completed':
      return <CheckCircle className="base-tool-card__status-success" size={12} />;
    case 'cancelled':
      return <XCircle className="base-tool-card__status-cancelled" size={12} />;
    case 'error':
      return <XCircle className="base-tool-card__status-error" size={12} />;
    default:
      return <Clock className="base-tool-card__status-pending" size={12} />;
  }
}

function statusTextFor(
  status: ToolCardStatus,
  t: Translate,
  requiresConfirmation: boolean,
  userConfirmed: boolean
): string {
  if (requiresConfirmation && !userConfirmed) {
    return t('flowChatCards.baseToolCard.awaitingConfirmation');
  }

  const statusKey: Record<ToolCardStatus, string> = {
    pending: 'preparing',
    preparing: 'analyzing',
    running: 'running',
    streaming: 'running',
    completed: 'completed',
    cancelled: 'cancelled',
    error: 'failed',
  };

  return t(`flowChatCards.baseToolCard.${statusKey[status]}`);
}

export const BaseToolCard: React.FC<BaseToolCardProps> = ({
  displayName,
  icon,
  description,
  primaryColor = '#667eea',
  status = 'pending',
  displayMode = 'standard',
  requiresConfirmation = false,
  userConfirmed = false,
  input,
  result,
  error,
  children,
  onConfirm,
  onReject,
  onExpand,
  className = ''
}) => {
  const { t } = useI18n('components');
  const currentStatus = status as ToolCardStatus;
  const statusIcon = statusIconFor(currentStatus);
  const statusText = statusTextFor(currentStatus, t, requiresConfirmation, userConfirmed);
  const handleConfirm = () => onConfirm?.(input);
  const handleReject = () => onReject?.();
  const showConfirmationActions = requiresConfirmation && !userConfirmed && currentStatus !== 'completed';
  const showDetailedInput = displayMode === 'detailed' && input;
  const canExpandResult = displayMode === 'standard' && onExpand;

  if (displayMode === 'compact') {
    return (
      <div 
        className={cardClassName('compact', currentStatus, className)}
        style={primaryColorStyle(primaryColor)}
      >
        <div className="base-tool-card__compact-content">
          {renderToolIcon(icon)}
          <span className="base-tool-card__action">{displayName}</span>
          {children}
          <span className="base-tool-card__status">{statusIcon}</span>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={cardClassName(displayMode, currentStatus, className)}
      style={primaryColorStyle(primaryColor)}
    >
      <div className="base-tool-card__header">
        <div className="base-tool-card__info">
          {renderToolIcon(icon)}
          <div className="base-tool-card__details">
            <div className="base-tool-card__name">{displayName}</div>
            {description && <div className="base-tool-card__description">{description}</div>}
          </div>
        </div>
        <div className="base-tool-card__status-container">
          <span className="base-tool-card__status-icon">{statusIcon}</span>
          <span className="base-tool-card__status-text">{statusText}</span>
        </div>
      </div>

      {children && <div className="base-tool-card__content">{children}</div>}

      {showDetailedInput && (
        <div className="base-tool-card__input">
          <div className="base-tool-card__input-label">{t('flowChatCards.baseToolCard.inputParams')}</div>
          <div className="base-tool-card__input-content">
            <pre>{JSON.stringify(input, null, 2)}</pre>
          </div>
        </div>
      )}

      {showConfirmationActions && (
        <div className="base-tool-card__actions">
          <button 
            className="base-tool-card__button base-tool-card__button--confirm"
            onClick={handleConfirm}
            disabled={status === 'streaming'}
          >
            {t('flowChatCards.baseToolCard.confirm')}
          </button>
          <button 
            className="base-tool-card__button base-tool-card__button--reject"
            onClick={handleReject}
            disabled={status === 'streaming'}
          >
            {t('flowChatCards.baseToolCard.cancel')}
          </button>
        </div>
      )}

      {result && (
        <div className="base-tool-card__result">
          <div className="base-tool-card__result-label">{t('flowChatCards.baseToolCard.result')}</div>
          <div className="base-tool-card__result-content">
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </div>
          {canExpandResult && (
            <button 
              className="base-tool-card__button base-tool-card__button--expand"
              onClick={onExpand}
            >
              {t('flowChatCards.baseToolCard.viewDetails')}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="base-tool-card__error">
          <XCircle className="base-tool-card__error-icon" size={16} />
          <span className="base-tool-card__error-message">{error}</span>
        </div>
      )}
    </div>
  );
};
