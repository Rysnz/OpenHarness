/**
 * WindowControls component - window control buttons
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../Tooltip';
import './WindowControls.scss';

export interface WindowControlsProps extends React.HTMLAttributes<HTMLDivElement> {
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  showMinimize?: boolean;
  showMaximize?: boolean;
  showClose?: boolean;
  disabled?: boolean;
  isMaximized?: boolean;
  minimizeIcon?: React.ReactNode;
  maximizeIcon?: React.ReactNode;
  restoreIcon?: React.ReactNode;
  closeIcon?: React.ReactNode;
  'data-testid-minimize'?: string;
  'data-testid-maximize'?: string;
  'data-testid-close'?: string;
}

interface WindowControlButtonProps {
  className: string;
  disabled: boolean;
  label: string;
  testId?: string;
  tooltip: string;
  icon: React.ReactNode;
  onClick?: () => void;
}

const MinimizeGlyph = () => (
  <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
    <line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const MaximizeGlyph = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
    <rect x="2" y="2" width="8" height="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const RestoreGlyph = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
    <path d="M4 4 L4 1.5 Q4 1 4.5 1 L10.5 1 Q11 1 11 1.5 L11 7.5 Q11 8 10.5 8 L8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    <rect x="1" y="4" width="7" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

const CloseGlyph = () => (
  <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
    <line x1="3" y1="3" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="11" y1="3" x2="3" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

function WindowControlButton({
  className,
  disabled,
  label,
  testId,
  tooltip,
  icon,
  onClick,
}: WindowControlButtonProps) {
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled) {
      onClick?.();
    }
  };

  return (
    <Tooltip content={tooltip} placement="bottom">
      <button
        className={className}
        onClick={handleClick}
        disabled={disabled}
        aria-label={label}
        type="button"
        data-testid={testId}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

/**
 * Window control button component
 * Provides a unified window control UI (minimize, maximize, close)
 */
export const WindowControls: React.FC<WindowControlsProps> = ({
  onMinimize,
  onMaximize,
  onClose,
  showMinimize = true,
  showMaximize = true,
  showClose = true,
  disabled = false,
  isMaximized = false,
  minimizeIcon,
  maximizeIcon,
  restoreIcon,
  closeIcon,
  className = '',
  'data-testid-minimize': testIdMinimize,
  'data-testid-maximize': testIdMaximize,
  'data-testid-close': testIdClose,
  ...props
}) => {
  const { t } = useTranslation('common');
  const minimizeLabel = t('window.minimize');
  const maximizeLabel = t('window.maximize');
  const restoreLabel = t('window.restore');
  const closeLabel = t('window.close');

  return (
    <div 
      className={`window-controls ${className}`}
      {...props}
    >
      {showMinimize && (
        <WindowControlButton
          className="window-controls__btn window-controls__btn--minimize"
          disabled={disabled}
          icon={minimizeIcon || <MinimizeGlyph />}
          label={minimizeLabel}
          onClick={onMinimize}
          testId={testIdMinimize}
          tooltip={minimizeLabel}
        />
      )}

      {showMaximize && (
        <WindowControlButton
          className="window-controls__btn window-controls__btn--maximize"
          disabled={disabled}
          icon={isMaximized ? (restoreIcon || <RestoreGlyph />) : (maximizeIcon || <MaximizeGlyph />)}
          label={isMaximized ? restoreLabel : maximizeLabel}
          onClick={onMaximize}
          testId={testIdMaximize}
          tooltip={isMaximized ? restoreLabel : maximizeLabel}
        />
      )}

      {showClose && (
        <WindowControlButton
          className="window-controls__btn window-controls__btn--close"
          disabled={disabled}
          icon={closeIcon || <CloseGlyph />}
          label={closeLabel}
          onClick={onClose}
          testId={testIdClose}
          tooltip={closeLabel}
        />
      )}
    </div>
  );
};
