import { useCallback, useEffect } from 'react';
import { FlowChatManager } from '../../../flow_chat/services/FlowChatManager';
import { createLogger } from '../../../shared/utils/logger';
import { useWorkbenchToolbarSessionCreation } from '../session/useWorkbenchSessionBootstrap';

const log = createLogger('WorkbenchToolbarBridge');

export function useWorkbenchToolbarBridge(): void {
  const createSession = useWorkbenchToolbarSessionCreation();

  useEffect(() => {
    const handleToolbarSendMessage = async (event: Event) => {
      const customEvent = event as CustomEvent<{ message: string; sessionId: string }>;
      const { message, sessionId } = customEvent.detail;
      if (message && sessionId) {
        try {
          const flowChatManager = FlowChatManager.getInstance();
          await flowChatManager.sendMessage(message, sessionId);
        } catch (error) {
          log.error('Failed to send toolbar message', error);
        }
      }
    };

    window.addEventListener('toolbar-send-message', handleToolbarSendMessage);
    return () => window.removeEventListener('toolbar-send-message', handleToolbarSendMessage);
  }, []);

  useEffect(() => {
    const handleToolbarCancelTask = async () => {
      try {
        const flowChatManager = FlowChatManager.getInstance();
        await flowChatManager.cancelCurrentTask();
      } catch (error) {
        log.error('Failed to cancel toolbar task', error);
      }
    };

    window.addEventListener('toolbar-cancel-task', handleToolbarCancelTask);
    return () => window.removeEventListener('toolbar-cancel-task', handleToolbarCancelTask);
  }, []);

  const handleCreateFlowChatSession = useCallback(
    async (mode?: 'code' | 'cowork') => {
      await createSession(mode);
    },
    [createSession]
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const mode = (event as CustomEvent<{ mode?: 'code' | 'cowork' }>).detail?.mode;
      void handleCreateFlowChatSession(mode === 'cowork' ? 'cowork' : 'code');
    };

    window.addEventListener('toolbar-create-session', handler);
    return () => window.removeEventListener('toolbar-create-session', handler);
  }, [handleCreateFlowChatSession]);
}
