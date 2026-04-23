/**
 * FlowChat store synchronization effects.
 */

import { useEffect } from 'react';
import { agentAPI } from '@/infrastructure/api';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { startAutoSync } from '@/flow_chat/services/storeSync';

export function useFlowChatSync(): void {
  useEffect(() => {
    const unsubscribe = startAutoSync();
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unlisten = agentAPI.onSessionTitleGenerated((event) => {
      flowChatStore.updateSessionTitle(
        event.sessionId,
        event.title,
        'generated',
      );
    });

    return () => {
      unlisten();
    };
  }, []);
}
