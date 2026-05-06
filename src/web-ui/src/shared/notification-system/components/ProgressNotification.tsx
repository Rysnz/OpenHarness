import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { useI18n } from '@/infrastructure/i18n';
import { Notification } from '../types';
import { notificationService } from '../services/NotificationService';
import './ProgressNotification.scss';

export interface ProgressNotificationProps {
  notification: Notification;
}

type ProgressMode = NonNullable<Notification['progressMode']> | 'text-only';

const StatusIcon: React.FC<{ status?: Notification['status'] }> = ({ status }) => {
  if (status === 'completed') {
    return (
      <CheckCircle2
        size={16}
        className="progress-notification__status-icon progress-notification__status-icon--success"
      />
    );
  }

  if (status === 'failed') {
    return (
      <AlertCircle
        size={16}
        className="progress-notification__status-icon progress-notification__status-icon--error"
      />
    );
  }

  return <Loader2 size={16} className="progress-notification__spinner" />;
};

const resolveProgressMode = (notification: Notification): ProgressMode =>
  notification.progressMode || (notification.textOnly ? 'text-only' : 'percentage');

const progressIndicator = (notification: Notification, mode: ProgressMode): string | null => {
  if (mode === 'fraction' && notification.current !== undefined && notification.total !== undefined) {
    return `${notification.current}/${notification.total}`;
  }

  if (mode === 'percentage') {
    return `${Math.round(notification.progress ?? 0)}%`;
  }

  return null;
};

export const ProgressNotification: React.FC<ProgressNotificationProps> = ({ notification }) => {
  const { t } = useI18n('common');
  const {
    id,
    title,
    message,
    progress = 0,
    progressText,
    cancellable,
    onCancel,
    status
  } = notification;
  const mode = resolveProgressMode(notification);
  const showProgress = mode !== 'text-only';
  const classes = [
    'progress-notification',
    `progress-notification--${status || 'active'}`,
    mode === 'text-only' && 'progress-notification--text-only'
  ].filter(Boolean).join(' ');

  const handleCancel = () => {
    onCancel?.();
    notificationService.dismiss(id);
  };

  return (
    <div className={classes}>
      <div className="progress-notification__icon">
        <StatusIcon status={status} />
      </div>

      <div className="progress-notification__content">
        <div className="progress-notification__header">
          <div className="progress-notification__title">{title}</div>
          {showProgress && (
            <div className="progress-notification__percentage">
              {progressIndicator(notification, mode)}
            </div>
          )}
        </div>

        <div className="progress-notification__message">
          {progressText || message}
        </div>

        {showProgress && (
          <div className="progress-notification__progress-bar">
            <div
              className="progress-notification__progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {cancellable && status === 'active' && (
        <button
          className="progress-notification__cancel"
          onClick={handleCancel}
          aria-label={t('actions.cancel')}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};
