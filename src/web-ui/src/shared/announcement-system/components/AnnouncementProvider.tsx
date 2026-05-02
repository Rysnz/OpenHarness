import React, { useCallback, useEffect } from 'react';
import { createLogger } from '@/shared/utils/logger';
import { announcementService } from '../services/AnnouncementService';
import { useAnnouncementStore } from '../store/announcementStore';
import AnnouncementToastStack from './AnnouncementToastStack';
import FeatureModal from './FeatureModal';

const log = createLogger('AnnouncementProvider');

const DEBUG_CARD_IDS = [
  'feature_shortcuts_v0_2_2',
  'feature_welcome',
];

function isDebugShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey && event.shiftKey && event.altKey && event.key === 'D';
}

const AnnouncementProvider: React.FC = () => {
  const { loadQueue, markInitialised, initialised, forceShowCards } = useAnnouncementStore();

  const scheduleCards = useCallback((cards: Parameters<typeof loadQueue>[0]) => {
    const maxDelay = Math.max(...cards.map((card) => card.trigger.delay_ms ?? 0));
    setTimeout(() => loadQueue(cards), maxDelay);
  }, [loadQueue]);

  useEffect(() => {
    if (initialised) return;

    const load = async () => {
      try {
        const cards = await announcementService.getPendingAnnouncements();
        if (cards.length > 0) {
          log.debug('Announcement cards loaded', { count: cards.length });
          scheduleCards(cards);
        }
      } catch (e) {
        log.error('Failed to load announcement cards', e);
      } finally {
        markInitialised();
      }
    };

    load();
  }, [initialised, markInitialised, scheduleCards]);

  const handleDebugTrigger = useCallback(async () => {
    log.debug('[DEBUG] Triggering announcement preview', { ids: DEBUG_CARD_IDS });
    try {
      const cards = await announcementService.debugTriggerCards(DEBUG_CARD_IDS);
      if (cards.length === 0) {
        log.warn('[DEBUG] No cards resolved for debug trigger. Check DEBUG_CARD_IDS.');
        return;
      }
      log.debug('[DEBUG] Force-showing cards', { count: cards.length, ids: cards.map((card) => card.id) });
      forceShowCards(cards);
    } catch (e) {
      log.error('[DEBUG] Failed to trigger debug cards', e);
    }
  }, [forceShowCards]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isDebugShortcut(event)) {
        event.preventDefault();
        handleDebugTrigger();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleDebugTrigger]);

  return (
    <>
      <AnnouncementToastStack />
      <FeatureModal />
    </>
  );
};

export default AnnouncementProvider;
