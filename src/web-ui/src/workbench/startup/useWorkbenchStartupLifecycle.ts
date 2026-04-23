import { useCallback, useEffect, useRef, useState } from 'react';
import { useCurrentModelConfig } from '../../hooks/useModelConfigs';
import { useWorkspaceContext } from '../../infrastructure/contexts/WorkspaceContext';
import { useAIInitialization } from '../../infrastructure/hooks/useAIInitialization';
import { MCPAPI } from '../../infrastructure/api/service-api/MCPAPI';
import { createLogger } from '../../shared/utils/logger';

const log = createLogger('WorkbenchStartup');
const MIN_SPLASH_MS = 900;

function useDeferredNonCriticalUi(enabled: boolean): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const enable = () => setReady(true);
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (idleWindow.requestIdleCallback) {
      const idleId = idleWindow.requestIdleCallback(() => enable(), { timeout: 1000 });
      return () => idleWindow.cancelIdleCallback?.(idleId);
    }

    const timer = window.setTimeout(enable, 200);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  return ready;
}

function useWindowReveal(visible: boolean, showMainWindow: (reason: string) => Promise<void>): void {
  useEffect(() => {
    void showMainWindow('startup-overlay');
  }, [showMainWindow]);

  useEffect(() => {
    if (visible) {
      return;
    }

    const timer = window.setTimeout(() => {
      void showMainWindow('startup-complete');
    }, 50);

    return () => window.clearTimeout(timer);
  }, [showMainWindow, visible]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void showMainWindow('startup-watchdog');
    }, 10000);

    return () => window.clearTimeout(timer);
  }, [showMainWindow]);
}

function usePostSplashInitialization(splashVisible: boolean): void {
  useEffect(() => {
    if (splashVisible) {
      return;
    }

    log.info('Application started, initializing systems');

    const initIdeControl = async () => {
      try {
        const { initializeIdeControl } = await import('../../shared/services/ide-control/IdeControlEventBus');
        await initializeIdeControl();
        log.debug('IDE control system initialized');
      } catch (error) {
        log.error('Failed to initialize IDE control system', error);
      }
    };

    const initMcpServers = async () => {
      try {
        await MCPAPI.initializeServers();
        log.debug('MCP servers initialized');
      } catch (error) {
        log.error('Failed to initialize MCP servers', error);
      }
    };

    void initIdeControl();
    void initMcpServers();
  }, [splashVisible]);
}

function useAiInitializationDiagnostics(): void {
  const { currentConfig } = useCurrentModelConfig();
  const {
    isInitialized: aiInitialized,
    isInitializing: aiInitializing,
    error: aiError,
  } = useAIInitialization(currentConfig);

  useEffect(() => {
    if (aiError) {
      log.error('AI initialization failed', aiError);
    } else if (aiInitialized) {
      log.debug('AI client initialized successfully');
    } else if (!aiInitializing && !currentConfig) {
      log.warn('AI not initialized: waiting for model config');
    } else if (!aiInitializing && currentConfig && !currentConfig.apiKey) {
      log.warn('AI not initialized: missing API key');
    } else if (!aiInitializing && currentConfig && !currentConfig.modelName) {
      log.warn('AI not initialized: missing model name');
    } else if (!aiInitializing && currentConfig && !currentConfig.baseUrl) {
      log.warn('AI not initialized: missing base URL');
    }
  }, [aiInitialized, aiInitializing, aiError, currentConfig]);
}

export function useWorkbenchStartupLifecycle() {
  const { loading: workspaceLoading } = useWorkspaceContext();
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashExiting, setSplashExiting] = useState(false);
  const mountTimeRef = useRef(Date.now());
  const mainWindowShownRef = useRef(false);

  useEffect(() => {
    if (workspaceLoading) return;
    const elapsed = Date.now() - mountTimeRef.current;
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);
    const timer = window.setTimeout(() => setSplashExiting(true), remaining);
    return () => window.clearTimeout(timer);
  }, [workspaceLoading]);

  const handleSplashExited = useCallback(() => {
    setSplashVisible(false);
  }, []);

  const showMainWindow = useCallback(async (reason: string) => {
    if (mainWindowShownRef.current) {
      return;
    }
    mainWindowShownRef.current = true;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('show_main_window');
      log.debug('Main window shown', { reason });
    } catch (error) {
      log.error('Failed to show main window', error);

      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const mainWindow = getCurrentWindow();
        await mainWindow.show();
        await mainWindow.setFocus();
        log.debug('Main window shown via fallback', { reason });
      } catch (fallbackError) {
        log.error('Fallback window show failed', fallbackError);
        mainWindowShownRef.current = false;
      }
    }
  }, []);

  useWindowReveal(splashVisible, showMainWindow);
  usePostSplashInitialization(splashVisible);
  useAiInitializationDiagnostics();

  return {
    nonCriticalUiReady: useDeferredNonCriticalUi(!splashVisible),
    splashExiting,
    splashVisible,
    onSplashExited: handleSplashExited,
  };
}

export type WorkbenchStartupLifecycleState = ReturnType<typeof useWorkbenchStartupLifecycle>;
