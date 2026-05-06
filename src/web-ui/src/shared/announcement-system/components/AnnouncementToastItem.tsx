import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { AnnouncementCard } from '../types';
import { useAnnouncementStore } from '../store/announcementStore';
import { useAnnouncementI18n } from '../hooks/useAnnouncementI18n';

const EXIT_ANIMATION_MS = 280;
const ANNOUNCEMENT_KEY_PREFIX = 'announcements.';

interface AnnouncementToastItemProps {
  card: AnnouncementCard;
}

const AnnouncementToastItem: React.FC<AnnouncementToastItemProps> = ({ card }) => {
  const { t } = useAnnouncementI18n();
  const { openModalFor, dismissToast } = useAnnouncementStore();
  const [exiting, setExiting] = useState(false);
  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { toast, card_type, modal } = card;
  const hasModal = card_type !== 'tip' && modal !== null;
  const autoDismissMs = toast.auto_dismiss_ms;

  const resolve = useCallback(
    (key: string) => (key.startsWith(ANNOUNCEMENT_KEY_PREFIX) ? t(key) : key),
    [t],
  );

  const clearAutoDismiss = useCallback(() => {
    if (autoDismissTimer.current) {
      clearTimeout(autoDismissTimer.current);
      autoDismissTimer.current = null;
    }
  }, []);

  const triggerExit = useCallback(
    (callback: () => void) => {
      clearAutoDismiss();
      setExiting(true);
      setTimeout(callback, EXIT_ANIMATION_MS);
    },
    [clearAutoDismiss],
  );

  const handleDismiss = useCallback(() => {
    triggerExit(() => dismissToast(card));
  }, [card, dismissToast, triggerExit]);

  const handleAction = useCallback(() => {
    if (hasModal) {
      triggerExit(() => openModalFor(card));
      return;
    }

    handleDismiss();
  }, [card, handleDismiss, hasModal, openModalFor, triggerExit]);

  useEffect(() => {
    if (autoDismissMs) {
      autoDismissTimer.current = setTimeout(handleDismiss, autoDismissMs);
    }

    return clearAutoDismiss;
  }, [autoDismissMs, card.id, clearAutoDismiss, handleDismiss]);

  const actionLabel = useMemo(
    () =>
      resolve(toast.action_label) ||
      (hasModal ? t('announcements.common.learn_more') : t('announcements.common.got_it')),
    [hasModal, resolve, t, toast.action_label],
  );

  return (
    <div
      className={`announcement-toast ${exiting ? 'announcement-toast--exiting' : 'announcement-toast--entering'}`}
      role="alert"
      aria-live="polite"
    >
      <div className="announcement-toast__header">
        <div className="announcement-toast__title">{resolve(toast.title)}</div>
        {toast.dismissible && (
          <div className="announcement-toast__close-wrap">
            {autoDismissMs && (
              <svg className="announcement-toast__ring" viewBox="0 0 28 28" aria-hidden>
                <circle cx="14" cy="14" r="11.5" className="announcement-toast__ring-track" />
                <circle
                  cx="14"
                  cy="14"
                  r="11.5"
                  className="announcement-toast__ring-fill"
                  style={{ animationDuration: `${autoDismissMs}ms` }}
                />
              </svg>
            )}
            <button
              type="button"
              className="announcement-toast__close"
              onClick={handleDismiss}
              aria-label={t('announcements.common.close')}
            >
              <X strokeWidth={2} />
            </button>
          </div>
        )}
      </div>

      <p className="announcement-toast__desc">{resolve(toast.description)}</p>

      <div className="announcement-toast__actions">
        <button
          type="button"
          className="announcement-toast__btn announcement-toast__btn--primary"
          onClick={handleAction}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
};

export default AnnouncementToastItem;
