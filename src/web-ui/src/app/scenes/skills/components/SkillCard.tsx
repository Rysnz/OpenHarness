import React, { useMemo } from 'react';
import { Package, Puzzle } from 'lucide-react';
import { getCardGradient, getCardColorRgb } from '@/shared/utils/cardGradients';
import './SkillCard.scss';

type SkillCardActionTone = 'primary' | 'danger' | 'success' | 'muted';

export interface SkillCardAction {
  id: string;
  icon: React.ReactNode;
  ariaLabel: string;
  title?: string;
  disabled?: boolean;
  tone?: SkillCardActionTone;
  onClick: () => void;
}

interface SkillCardProps {
  name: string;
  description?: string;
  index?: number;
  accentSeed?: string;
  iconKind?: 'skill' | 'market';
  badges?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: SkillCardAction[];
  onOpenDetails?: () => void;
}

const SkillCard: React.FC<SkillCardProps> = ({
  name,
  description,
  index = 0,
  accentSeed,
  iconKind = 'skill',
  badges,
  meta,
  actions = [],
  onOpenDetails,
}) => {
  const Icon = iconKind === 'market' ? Package : Puzzle;
  const openDetails = () => onOpenDetails?.();
  const accentKey = accentSeed ?? name;
  const cardStyle = useMemo(
    () =>
      ({
        '--card-index': index,
        '--skill-card-gradient': getCardGradient(accentKey),
        '--skill-card-color-rgb': getCardColorRgb(accentKey),
      }) as React.CSSProperties,
    [accentKey, index],
  );

  return (
    <div
      className="skill-card"
      style={cardStyle}
      onClick={openDetails}
      tabIndex={0}
      onKeyDown={(event) => handleCardKeyDown(event, openDetails)}
      aria-label={name}
    >
      <div className="skill-card__header">
        <div className="skill-card__icon-area">
          <div className="skill-card__icon">
            <Icon size={20} strokeWidth={1.6} />
          </div>
        </div>
        {badges && <div className="skill-card__badges">{badges}</div>}
      </div>

      <div className="skill-card__body">
        <div className="skill-card__title-row">
          <span className="skill-card__name">{name}</span>
          {meta ? <SkillCardMeta>{meta}</SkillCardMeta> : null}
        </div>
        {description?.trim() && <p className="skill-card__desc">{description.trim()}</p>}
      </div>

      {actions.length > 0 && (
        <SkillCardActions actions={actions} />
      )}
    </div>
  );
};

const SkillCardMeta: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="skill-card__meta"
    onClick={stopCardEvent}
    onKeyDown={stopCardEvent}
  >
    {children}
  </div>
);

const SkillCardActions: React.FC<{ actions: SkillCardAction[] }> = ({ actions }) => (
  <div className="skill-card__footer">
    <div className="skill-card__actions" onClick={stopCardEvent}>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={actionClassName(action.tone)}
          onClick={action.onClick}
          disabled={action.disabled}
          aria-label={action.ariaLabel}
          title={action.title ?? action.ariaLabel}
        >
          {action.icon}
        </button>
      ))}
    </div>
  </div>
);

function handleCardKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
  openDetails: () => void,
): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openDetails();
  }
}

function actionClassName(tone?: SkillCardActionTone): string {
  return ['skill-card__action-btn', tone && `skill-card__action-btn--${tone}`]
    .filter(Boolean)
    .join(' ');
}

function stopCardEvent(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

export default SkillCard;
