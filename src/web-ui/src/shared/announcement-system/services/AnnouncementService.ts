import { invoke } from '@tauri-apps/api/core';
import type { AnnouncementCard } from '../types';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('AnnouncementService');

const requestForId = (id: string) => ({ request: { id } });

async function invokeOrFallback<T>(
  command: string,
  fallback: T,
  message: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    log.error(message, args ? { ...args, error } : error);
    return fallback;
  }
}

async function invokeAndLog(command: string, id: string, message: string): Promise<void> {
  try {
    await invoke(command, requestForId(id));
  } catch (error) {
    log.error(message, { id, error });
  }
}

export const announcementService = {
  async getPendingAnnouncements(): Promise<AnnouncementCard[]> {
    return invokeOrFallback('get_pending_announcements', [], 'Failed to get pending announcements');
  },

  async markSeen(id: string): Promise<void> {
    await invokeAndLog('mark_announcement_seen', id, 'Failed to mark announcement seen');
  },

  async dismiss(id: string): Promise<void> {
    await invokeAndLog('dismiss_announcement', id, 'Failed to dismiss announcement');
  },

  async neverShow(id: string): Promise<void> {
    await invokeAndLog('never_show_announcement', id, 'Failed to suppress announcement');
  },

  async triggerCard(id: string): Promise<AnnouncementCard | null> {
    return invokeOrFallback(
      'trigger_announcement',
      null,
      'Failed to trigger announcement',
      requestForId(id)
    );
  },

  async getTips(): Promise<AnnouncementCard[]> {
    return invokeOrFallback('get_announcement_tips', [], 'Failed to get announcement tips');
  },

  async debugTriggerCards(ids: string[]): Promise<AnnouncementCard[]> {
    const cards = await Promise.all(ids.map((id) => announcementService.triggerCard(id)));
    return cards.filter((card): card is AnnouncementCard => card !== null);
  },
};
