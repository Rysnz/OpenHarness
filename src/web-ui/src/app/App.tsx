import { useEffect, useCallback, useState, useRef, lazy, Suspense } from 'react';
import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import { ChatProvider } from '../infrastructure/contexts/ChatProvider';
import { useAIInitialization } from '../infrastructure/hooks/useAIInitialization';
import { ViewModeProvider } from '../infrastructure/contexts/ViewModeProvider';
import { SSHRemoteProvider } from '../features/ssh-remote/SSHRemoteProvider';
import AppLayout from './layout/AppLayout';
import { useCurrentModelConfig } from '../hooks/useModelConfigs';
import { NotificationContainer } from '../shared/notification-system/components/NotificationContainer';
import { createLogger } from '@/shared/utils/logger';
import { useWorkspaceContext } from '../infrastructure/contexts/WorkspaceContext';
import SplashScreen from './components/SplashScreen/SplashScreen';
import { useGlobalSceneShortcuts } from './hooks/useGlobalSceneShortcuts';
import { MCPAPI } from '../infrastructure/api/service-api/MCPAPI';

// Toolbar Mode
import { ToolbarModeProvider } from '../flow_chat/components/toolbar-mode/ToolbarModeProvider';

const log = createLogger('App');
const LazyContextMenuRenderer = lazy(async () => {
  const module = await import('../shared/context-menu-system/components/ContextMenuRenderer');
  return { default: module.ContextMenuRenderer };
});
const LazyNotificationCenter = lazy(async () => {
  const module = await import('../shared/notification-system/components/NotificationCenter');
  return { default: module.NotificationCenter };
});
const LazyAnnouncementProvider = lazy(() => import('../shared/announcement-system/components/AnnouncementProvider'));
const LazyConfirmDialogRenderer = lazy(async () => {
  const module = await import('../component-library/components/ConfirmDialog/ConfirmDialogRenderer');
  return { default: module.ConfirmDialogRenderer };
});
/**
 * OpenHarness main application component.
 *
 * Unified architecture:
 * - Use a single AppLayout component
 * - AppLayout switches content based on workspace presence
 * - Without a workspace: show startup content (branding + actions)
 * - With a workspace: show workspace panels
 * - Header is always present; elements toggle by state
 */
// Minimum time (ms) the splash is shown, so the animation is never a flash.
const MIN_SPLASH_MS = 900;

function App() {
  // AI initialization
  const { currentConfig } = useCurrentModelConfig();
  const { isInitialized: aiInitialized, isInitializing: aiInitializing, error: aiError } = useAIInitialization(currentConfig);

  // Workspace loading state — drives splash exit timing
  const { loading: workspaceLoading } = useWorkspaceContext();

  // Splash screen state
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashExiting, setSplashExiting] = useState(false);
  const [nonCriticalUiReady, setNonCriticalUiReady] = useState(false);
  const mountTimeRef = useRef(Date.now());
  const mainWindowShownRef = useRef(false);

  // Once the workspace finishes loading, wait for the remaining min-display
  // time and then begin the exit animation.
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

  useEffect(() => {
    if (splashVisible) {
      return;
    }

    const enableNonCriticalUi = () => setNonCriticalUiReady(true);
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (idleWindow.requestIdleCallback) {
      const idleId = idleWindow.requestIdleCallback(() => enableNonCriticalUi(), { timeout: 1000 });

      return () => {
        idleWindow.cancelIdleCallback?.(idleId);
      };
    }

    const timer = globalThis.setTimeout(enableNonCriticalUi, 200);
    return () => globalThis.clearTimeout(timer);
  }, [splashVisible]);

  const showMainWindow = useCallback(async (reason: string) => {
    if (mainWindowShownRef.current) {
      return;
    }
    mainWindowShownRef.current = true;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('show_main_window');
      log.debug('Main window shown', { reason });
    } catch (error: any) {
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

  // Reveal the native window as soon as React has painted a frame.
  // The splash still covers the UI, so users see immediate feedback instead
  // of waiting on a hidden window while startup continues in the background.
  useEffect(() => {
    void showMainWindow('startup-overlay');
  }, [showMainWindow]);

  // If the early reveal path fails, keep the old post-splash show as a retry.
  useEffect(() => {
    if (splashVisible) {
      return;
    }

    const timer = window.setTimeout(() => {
      void showMainWindow('startup-complete');
    }, 50);

    return () => window.clearTimeout(timer);
  }, [showMainWindow, splashVisible]);

  // Safety net: if startup gets stuck, reveal the window so the user can see errors.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void showMainWindow('startup-watchdog');
    }, 10000);

    return () => window.clearTimeout(timer);
  }, [showMainWindow]);

  // Startup logs and initialization
  useEffect(() => {
    if (splashVisible) {
      return;
    }

    log.info('Application started, initializing systems');
    
    // Initialize IDE control system
    const initIdeControl = async () => {
      try {
        const { initializeIdeControl } = await import('../shared/services/ide-control/IdeControlEventBus');
        await initializeIdeControl();
        log.debug('IDE control system initialized');
      } catch (error) {
        log.error('Failed to initialize IDE control system', error);
      }
    };
    
    // Initialize MCP servers
    const initMCPServers = async () => {
      try {
        await MCPAPI.initializeServers();
        log.debug('MCP servers initialized');
      } catch (error) {
        log.error('Failed to initialize MCP servers', error);
      }
    };
    
    initIdeControl();
    initMCPServers();
    
  }, [splashVisible]);

  // Observe AI initialization state
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

  // Escape closes preview overlay (registered via ShortcutManager)
  useShortcut(
    'app.closePreview',
    { key: 'Escape', scope: 'app', allowInInput: true },
    () => window.dispatchEvent(new CustomEvent('closePreview')),
    { priority: 1, description: 'keyboard.shortcuts.app.closePreview' }
  );

  // Top SceneBar: Mod+Alt+1..9 / Mod+Alt+PageUp/PageDown
  useGlobalSceneShortcuts();

  // Unified layout via a single AppLayout
  return (
    <ChatProvider>
      <ViewModeProvider defaultMode="coder">
        <SSHRemoteProvider>
          <ToolbarModeProvider>
            {/* Unified app layout with startup/workspace modes */}
            <AppLayout />

            {/* Context menu renderer */}
            {nonCriticalUiReady && (
              <Suspense fallback={null}>
                <LazyContextMenuRenderer />
              </Suspense>
            )}

            {/* Notification system */}
            <NotificationContainer />
            {nonCriticalUiReady && (
              <Suspense fallback={null}>
                <LazyNotificationCenter />
              </Suspense>
            )}

            {/* Confirm dialog */}
            {nonCriticalUiReady && (
              <Suspense fallback={null}>
                <LazyConfirmDialogRenderer />
              </Suspense>
            )}

            {/* Announcement / feature-demo / tips system */}
            {nonCriticalUiReady && (
              <Suspense fallback={null}>
                <LazyAnnouncementProvider />
              </Suspense>
            )}

            {/* Startup splash — sits above everything, exits once workspace is ready */}
            {splashVisible && (
              <SplashScreen isExiting={splashExiting} onExited={handleSplashExited} />
            )}
          </ToolbarModeProvider>
        </SSHRemoteProvider>
      </ViewModeProvider>
    </ChatProvider>
  );
}

export default App;
