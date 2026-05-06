import React, { useState, forwardRef, ReactNode } from 'react';
import { useI18n } from '@/infrastructure/i18n';
import './Alert.scss';

type AlertType = 'success' | 'error' | 'warning' | 'info';

export interface AlertProps {
  type?: AlertType;
  title?: ReactNode;
  message: ReactNode;
  description?: string;
  closable?: boolean;
  onClose?: () => void;
  showIcon?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const iconPaths: Record<AlertType, React.ReactNode> = {
  success: <path d="M13.5 4L6 11.5L2.5 8" strokeLinecap="round" strokeLinejoin="round" />,
  error: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8.5M8 11H8.01" strokeLinecap="round" />
    </>
  ),
  warning: (
    <>
      <path d="M8 1.5L14.5 13H1.5L8 1.5Z" strokeLinejoin="round" />
      <path d="M8 6V9M8 11H8.01" strokeLinecap="round" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 11V8M8 5H8.01" strokeLinecap="round" />
    </>
  )
};

const AlertIcon: React.FC<{ type: AlertType }> = ({ type }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
    {iconPaths[type]}
  </svg>
);

const CloseIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M1 1L11 11M11 1L1 11" strokeLinecap="round" />
  </svg>
);

export const Alert = forwardRef<HTMLDivElement, AlertProps>(({
  type = 'info',
  title,
  message,
  description,
  closable = false,
  onClose,
  showIcon = true,
  className = '',
  style,
}, ref) => {
  const { t } = useI18n('components');
  const [visible, setVisible] = useState(true);

  const handleClose = (): void => {
    setVisible(false);
    onClose?.();
  };

  if (!visible) {
    return null;
  }

  const classNames = ['alert', `alert--${type}`, className].filter(Boolean).join(' ');

  return (
    <div
      ref={ref}
      className={classNames}
      style={style}
      role="alert"
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      {showIcon && (
        <div className="alert__icon">
          <AlertIcon type={type} />
        </div>
      )}

      <div className="alert__content">
        {title && <div className="alert__title">{title}</div>}
        <div className="alert__message">{message}</div>
        {description && <div className="alert__description">{description}</div>}
      </div>

      {closable && (
        <button
          className="alert__close"
          onClick={handleClose}
          aria-label={t('tooltip.close')}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
});

Alert.displayName = 'Alert';
