import { initializeConfigInfrastructure } from './config';
import { globalEventBus } from './event-bus';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('Infrastructure');

export async function initializeInfrastructure(): Promise<void> {
  log.info('Initializing infrastructure systems');

  try {
    await initializeConfigInfrastructure();
    globalEventBus.emit('infrastructure:ready');
    log.info('Infrastructure systems initialized successfully');
  } catch (error) {
    log.error('Failed to initialize infrastructure systems', error);
    throw error;
  }
}

export async function destroyInfrastructure(): Promise<void> {
  log.info('Shutting down infrastructure systems');

  globalEventBus.emit('infrastructure:shutdown');
  globalEventBus.destroy();
}

export const initializeCore = initializeInfrastructure;
export const destroyCore = destroyInfrastructure;
