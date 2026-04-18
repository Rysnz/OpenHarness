import React from 'react';
import { Bot, MessageSquarePlus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Tooltip } from '@/component-library';
import type { WorkspaceInfo } from '@/shared/types';
import { getCardGradient } from '@/shared/utils/cardGradients';

interface PartnerCardProps {
  workspace: WorkspaceInfo;
  onClick: () => void;
  onNewSession?: () => void;
  onDelete?: () => void;
  isPrimary?: boolean;
  style?: React.CSSProperties;
}

const PartnerCard: React.FC<PartnerCardProps> = ({ workspace, onClick, onNewSession, onDelete, isPrimary, style }) => {
  const { t } = useTranslation('scenes/profile');
  const identity = workspace.identity;

  const name = identity?.name?.trim() || workspace.name || t('nursery.card.unnamed');
  const emoji = identity?.emoji?.trim() ?? '';
  const creature = identity?.creature?.trim() || '';
  const vibe = identity?.vibe?.trim() || '';
  const modelPrimary = identity?.modelPrimary?.trim() || '';
  const modelFast = identity?.modelFast?.trim() || '';

  const gradient = getCardGradient(workspace.id || name);

  const handleCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className="partner-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleCardKeyDown}
      aria-label={name}
      style={{
        ...style,
        '--partner-card-gradient': gradient,
      } as React.CSSProperties}
    >
      {/* Header: avatar + name + badges */}
      <div className="partner-card__header">
        <div className="partner-card__avatar">
          {emoji ? (
            <span className="partner-card__emoji">{emoji}</span>
          ) : (
            <Bot className="partner-card__avatar-icon" size={20} strokeWidth={1.6} aria-hidden />
          )}
        </div>
        <div className="partner-card__header-info">
          <div className="partner-card__title-row">
            <span className="partner-card__name">{name}</span>
            {isPrimary && (
              <span className="partner-card__primary-badge">
                {t('nursery.card.primaryBadge')}
              </span>
            )}
          </div>
          <div className="partner-card__badges">
            {creature && <Badge variant="neutral">{creature}</Badge>}
            {modelPrimary && <Badge variant="accent">{modelPrimary}</Badge>}
            {modelFast && <Badge variant="neutral">{modelFast}</Badge>}
          </div>
        </div>
      </div>

      {/* Body: vibe / description */}
      <div className="partner-card__body">
        {vibe ? (
          <p className="partner-card__vibe">{vibe}</p>
        ) : (
          <p className="partner-card__vibe partner-card__vibe--empty">
            {t('nursery.card.noVibe')}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="partner-card__footer">
        <div className="partner-card__footer-inner">
          <span className="partner-card__footer-hint">
            {t('nursery.card.configure')}
          </span>
          {(onNewSession || onDelete) ? (
            <div className="partner-card__footer-actions">
              {onNewSession && (
                <Tooltip content={t('nursery.card.newSession')} placement="top">
                  <button
                    type="button"
                    className="partner-card__new-session-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNewSession();
                    }}
                    aria-label={t('nursery.card.newSession')}
                  >
                    <MessageSquarePlus size={15} strokeWidth={2} aria-hidden />
                  </button>
                </Tooltip>
              )}
              {onDelete && (
                <Tooltip content={t('nursery.card.delete')} placement="top">
                  <button
                    type="button"
                    className="partner-card__delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    aria-label={t('nursery.card.delete')}
                  >
                    <Trash2 size={14} strokeWidth={2} aria-hidden />
                  </button>
                </Tooltip>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default PartnerCard;
