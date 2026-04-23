import { useEffect } from 'react';
import { FlowChatManager } from '../../../flow_chat/services/FlowChatManager';
import { flowChatStore } from '../../../flow_chat/store/FlowChatStore';
import { useSessionModeStore } from '../../../app/stores/sessionModeStore';
import { WorkspaceInfo, WorkspaceKind } from '../../../shared/types/global-state';
import { notificationService } from '../../../shared/notification-system/services/NotificationService';
import { quickActions } from '../../../shared/services/ide-control/api';
import { createLogger } from '../../../shared/utils/logger';

const log = createLogger('WorkbenchSessionBootstrap');

interface SessionBootstrapOptions {
  currentWorkspace: WorkspaceInfo | null;
  remoteSshFlowChatKey: string;
  ensurePartnerBootstrapForWorkspace: (workspace: WorkspaceInfo | null | undefined, sessionId?: string | null) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}

export function useWorkbenchSessionBootstrap({
  currentWorkspace,
  remoteSshFlowChatKey,
  ensurePartnerBootstrapForWorkspace,
  t,
}: SessionBootstrapOptions): void {
  useEffect(() => {
    const initializeFlowChat = async () => {
      if (!currentWorkspace?.rootPath) return;

      try {
        const explicitPreferredMode =
          sessionStorage.getItem('openharness:flowchat:preferredMode') || undefined;
        if (explicitPreferredMode) {
          sessionStorage.removeItem('openharness:flowchat:preferredMode');
        }

        const initializationPreferredMode =
          currentWorkspace.workspaceKind === WorkspaceKind.Partner ? 'Partner' : explicitPreferredMode;

        const flowChatManager = FlowChatManager.getInstance();
        const hasHistoricalSessions = await flowChatManager.initialize(
          currentWorkspace.rootPath,
          initializationPreferredMode,
          currentWorkspace.workspaceKind === WorkspaceKind.Remote
            ? currentWorkspace.connectionId
            : undefined,
          currentWorkspace.workspaceKind === WorkspaceKind.Remote
            ? currentWorkspace.sshHost
            : undefined
        );

        let sessionId: string | undefined;
        if (!hasHistoricalSessions) {
          const initialSessionMode =
            currentWorkspace.workspaceKind === WorkspaceKind.Partner
              ? 'Partner'
              : explicitPreferredMode || 'agentic';
          sessionId = await flowChatManager.createChatSession({}, initialSessionMode);
        }

        const activeSessionId = sessionId || flowChatStore.getState().activeSessionId;
        if (currentWorkspace.workspaceKind === WorkspaceKind.Partner && activeSessionId) {
          ensurePartnerBootstrapForWorkspace(currentWorkspace, activeSessionId);
        }

        const pendingDescription = sessionStorage.getItem('pendingProjectDescription');
        if (pendingDescription && pendingDescription.trim()) {
          sessionStorage.removeItem('pendingProjectDescription');

          setTimeout(async () => {
            try {
              const targetSessionId = sessionId || flowChatStore.getState().activeSessionId;

              if (!targetSessionId) {
                log.error('Cannot find active session ID');
                return;
              }

              const fullMessage = t('appLayout.projectRequestMessage', {
                description: pendingDescription,
              });
              await flowChatManager.sendMessage(fullMessage, targetSessionId);

              notificationService.success(t('appLayout.projectRequestSent'), { duration: 3000 });
            } catch (sendError) {
              log.error('Failed to send project description', sendError);
              notificationService.error(t('appLayout.projectRequestSendFailed'), {
                duration: 5000,
              });
            }
          }, 500);
        }

        const pendingSettings = sessionStorage.getItem('pendingOpenSettings');
        if (pendingSettings) {
          sessionStorage.removeItem('pendingOpenSettings');
          setTimeout(async () => {
            try {
              await quickActions.openSettings(pendingSettings);
            } catch (settingsError) {
              log.error('Failed to open pending settings', settingsError);
            }
          }, 500);
        }
      } catch (error) {
        log.error('FlowChatManager initialization failed', error);
        notificationService.error(t('appLayout.flowChatInitFailed'), { duration: 5000 });
      }
    };

    void initializeFlowChat();
  }, [
    currentWorkspace,
    currentWorkspace?.id,
    currentWorkspace?.rootPath,
    currentWorkspace?.workspaceKind,
    currentWorkspace?.connectionId,
    currentWorkspace?.sshHost,
    remoteSshFlowChatKey,
    ensurePartnerBootstrapForWorkspace,
    t,
  ]);
}

export function useWorkbenchToolbarSessionCreation(): (mode?: 'code' | 'cowork') => Promise<void> {
  return async (mode?: 'code' | 'cowork') => {
    try {
      const flowChatManager = FlowChatManager.getInstance();
      const setMode = useSessionModeStore.getState().setMode;
      if (mode === 'cowork') {
        setMode('cowork');
        await flowChatManager.createChatSession({}, 'Cowork');
      } else {
        setMode('code');
        await flowChatManager.createChatSession({}, 'agentic');
      }
    } catch (error) {
      log.error('Failed to create FlowChat session', error);
    }
  };
}
