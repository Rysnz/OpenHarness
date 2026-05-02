import { useState, useEffect, useCallback } from 'react';
import {
  UseAppReturn,
  AppState,
  AgentConfig,
  ChatSession,
  TabInfo,
  PanelType
} from '../types';
import { appManager } from '../services/AppManager';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('useApp');

const PANEL_WIDTHS = {
  leftMin: 50,
  centerMin: 400,
  rightMin: 200,
  rightMax: 1200
};

const clampMin = (value: number, min: number): number => Math.max(min, value);
const clampRange = (value: number, min: number, max: number): number => (
  Math.min(max, Math.max(min, value))
);

const logAndThrow = (message: string, error: unknown): never => {
  log.error(message, error);
  throw error;
};

const useManagedAppState = (): AppState => {
  const [state, setState] = useState<AppState>(appManager.getState());

  useEffect(() => {
    const syncState = () => setState(appManager.getState());
    const unsubscribe = appManager.addEventListener(syncState);

    syncState();
    return unsubscribe;
  }, []);

  return state;
};

export const useApp = (): UseAppReturn => {
  const state = useManagedAppState();

  const toggleLeftPanel = useCallback(() => {
    appManager.updateLayout({
      leftPanelCollapsed: !state.layout.leftPanelCollapsed
    });
  }, [state.layout.leftPanelCollapsed]);

  const toggleCenterPanel = useCallback(() => {
    appManager.updateLayout({
      centerPanelCollapsed: !state.layout.centerPanelCollapsed
    });
  }, [state.layout.centerPanelCollapsed]);

  const toggleRightPanel = useCallback(() => {
    appManager.updateLayout({
      rightPanelCollapsed: !state.layout.rightPanelCollapsed
    });
  }, [state.layout.rightPanelCollapsed]);

  const toggleChatPanel = useCallback(() => {
    const chatCollapsed = !state.layout.chatCollapsed;
    appManager.updateLayout({
      chatCollapsed,
      rightPanelCollapsed: chatCollapsed ? false : state.layout.rightPanelCollapsed
    });
  }, [state.layout.chatCollapsed, state.layout.rightPanelCollapsed]);

  const switchLeftPanelTab = useCallback((tab: PanelType) => {
    appManager.updateLayout({
      leftPanelActiveTab: tab,
      leftPanelCollapsed: false
    });
  }, []);

  const updateLeftPanelWidth = useCallback((width: number) => {
    appManager.updateLayout({
      leftPanelWidth: clampMin(width, PANEL_WIDTHS.leftMin)
    });
  }, []);

  const updateCenterPanelWidth = useCallback((width: number) => {
    appManager.updateLayout({
      centerPanelWidth: clampMin(width, PANEL_WIDTHS.centerMin)
    });
  }, []);

  const updateRightPanelWidth = useCallback((width: number) => {
    appManager.updateLayout({
      rightPanelWidth: clampRange(width, PANEL_WIDTHS.rightMin, PANEL_WIDTHS.rightMax)
    });
  }, []);

  const updateAgentConfig = useCallback(async (
    agentId: string,
    config: Partial<AgentConfig>
  ): Promise<void> => {
    try {
      await appManager.updateAgentConfig(agentId, config);
    } catch (error) {
      logAndThrow('Failed to update agent config', error);
    }
  }, []);

  const createChatSession = useCallback(async (agentId: string): Promise<ChatSession> => {
    try {
      return await appManager.createChatSession(agentId);
    } catch (error) {
      return logAndThrow('Failed to create chat session', error);
    }
  }, []);

  const selectChatSession = useCallback((sessionId: string) => {
    try {
      appManager.selectChatSession(sessionId);
    } catch (error) {
      log.error('Failed to select chat session', error);
    }
  }, []);

  const sendMessage = useCallback(async (content: string): Promise<void> => {
    if (state.activeChatSession) {
      try {
        await appManager.sendMessage(state.activeChatSession.id, content);
        return;
      } catch (error) {
        logAndThrow('Failed to send message', error);
      }
    }

    if (!state.currentAgent) {
      throw new Error('No active agent or chat session');
    }

    const session = await createChatSession(state.currentAgent.id);
    await appManager.sendMessage(session.id, content);
  }, [state.activeChatSession, state.currentAgent, createChatSession]);

  const enableExtension = useCallback(async (extensionId: string): Promise<void> => {
    try {
      await appManager.enableExtension(extensionId);
    } catch (error) {
      logAndThrow('Failed to enable extension', error);
    }
  }, []);

  const disableExtension = useCallback(async (extensionId: string): Promise<void> => {
    try {
      await appManager.disableExtension(extensionId);
    } catch (error) {
      logAndThrow('Failed to disable extension', error);
    }
  }, []);

  const openTab = useCallback((tab: Omit<TabInfo, 'id'>): string => {
    try {
      return appManager.openTab(tab);
    } catch (error) {
      return logAndThrow('Failed to open tab', error);
    }
  }, []);

  const closeTab = useCallback((tabId: string) => {
    try {
      appManager.closeTab(tabId);
    } catch (error) {
      log.error('Failed to close tab', error);
    }
  }, []);

  const selectTab = useCallback((tabId: string) => {
    try {
      appManager.selectTab(tabId);
    } catch (error) {
      log.error('Failed to select tab', error);
    }
  }, []);

  const clearError = useCallback(() => {
    appManager.clearError();
  }, []);

  return {
    state,
    toggleLeftPanel,
    toggleCenterPanel,
    toggleRightPanel,
    toggleChatPanel,
    switchLeftPanelTab,
    updateLeftPanelWidth,
    updateCenterPanelWidth,
    updateRightPanelWidth,
    updateAgentConfig,
    createChatSession,
    selectChatSession,
    sendMessage,
    enableExtension,
    disableExtension,
    openTab,
    closeTab,
    selectTab,
    clearError
  };
};

export const useLayout = () => {
  const {
    state,
    toggleLeftPanel,
    toggleRightPanel,
    toggleChatPanel,
    switchLeftPanelTab,
    updateLeftPanelWidth
  } = useApp();

  return {
    layout: state.layout,
    toggleLeftPanel,
    toggleRightPanel,
    toggleChatPanel,
    switchLeftPanelTab,
    updateLeftPanelWidth
  };
};

export const useChat = () => {
  const { state, createChatSession, selectChatSession, sendMessage } = useApp();

  return {
    sessions: state.chatSessions,
    activeSession: state.activeChatSession,
    currentAgent: state.currentAgent,
    createSession: createChatSession,
    selectSession: selectChatSession,
    sendMessage
  };
};

export const useTabs = () => {
  const { state, openTab, closeTab, selectTab } = useApp();

  return {
    tabs: state.layout.rightPanelTabs,
    activeTabId: state.layout.rightPanelActiveTabId,
    openTab,
    closeTab,
    selectTab
  };
};
