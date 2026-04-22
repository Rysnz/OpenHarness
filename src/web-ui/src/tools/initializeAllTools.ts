import { createLogger } from '@/shared/utils/logger';

import { initializeGit } from './git/initializeGit';
import { initializeLsp } from './lsp/initializeLsp';

const log = createLogger('Tools');

export async function initializeAllTools(): Promise<void> {
  try {
    await initializeLsp();
    initializeGit();
    log.info('All tool modules initialized');
  } catch (error) {
    log.error('Failed to initialize tool modules', { error });
  }
}
