/**
 * Main application layout.
 *
 * Column structure (top to bottom):
 *   WorkspaceBody (flex:1) 鈥?contains NavBar (with WindowControls) + NavPanel + SceneArea
 *   OR StartupContent
 *
 * TitleBar removed; window controls moved to NavBar, dialogs managed here.
 */

import { useState, useCallback, useEffect, useMemo, useRef, useContext, lazy, Suspense } from 'react';
import type { FC } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useWorkspaceContext } from '../../infrastructure/contexts/WorkspaceContext';
import { useWindowControls } from '../hooks/useWindowControls';
import { usePartnerBootstrap } from '../hooks/usePartnerBootstrap';
import { useApp } from '../hooks/useApp';
import { useSceneStore } from '../stores/sceneStore';
import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import { useWorkbenchSessionBootstrap } from '@/workbench/runtime/session/useWorkbenchSessionBootstrap';
import { useWorkbenchToolbarBridge } from '@/workbench/runtime/toolbar/useWorkbenchToolbarBridge';
import {
  useWorkbenchDragAndDropGuard,
  useWorkbenchWindowClosePersistence,
} from '@/workbench/runtime/window/useWorkbenchWindowLifecycle';

type TransitionDirection = 'entering' | 'returning' | null;
import WorkspaceBody from './WorkspaceBody';
import { ToolbarMode } from '../../flow_chat/components/toolbar-mode/ToolbarMode';
import { useToolbarModeContext } from '../../flow_chat/components/toolbar-mode/ToolbarModeContext';
import { workspaceAPI } from '@/infrastructure/api/service-api/WorkspaceAPI';
import { createLogger } from '@/shared/utils/logger';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { WorkspaceKind } from '@/shared/types/global-state';
import { SSHContext } from '@/features/ssh-remote/SSHRemoteContext';
import { shortcutManager, parseStoredKeybindings } from '@/infrastructure/services/ShortcutManager';
import './AppLayout.scss';

const log = createLogger('AppLayout');
const LazyFloatingMiniChat = lazy(async () => {
  const module = await import('./FloatingMiniChat');
  return { default: module.FloatingMiniChat };
});
const LazyNewProjectDialog = lazy(async () => {
  const module = await import('../components/NewProjectDialog');
  return { default: module.NewProjectDialog };
});
const LazyAboutDialog = lazy(async () => {
  const module = await import('../components/AboutDialog');
  return { default: module.AboutDialog };
});
const LazyMCPInteractionDialog = lazy(() => import('../components/MCPInteractionDialog/MCPInteractionDialog'));
const LazyWorkspaceManager = lazy(async () => {
  const module = await import('../../tools/workspace');
  return { default: module.WorkspaceManager };
});

interface AppLayoutProps {
  className?: string;
}

const AppLayout: FC<AppLayoutProps> = ({ className = '' }) => {
  const { t } = useI18n('components');
  const {
    currentWorkspace,
    hasWorkspace,
    openWorkspace,
    switchWorkspace,
    recentWorkspaces,
    loading,
  } = useWorkspaceContext();
  const sshContext = useContext(SSHContext);
  /** When SSH finishes connecting, re-run FlowChat init (first run may have skipped while disconnected). */
  const remoteSshFlowChatKey =
    currentWorkspace?.workspaceKind === WorkspaceKind.Remote && currentWorkspace?.connectionId
      ? sshContext?.workspaceStatuses[currentWorkspace.connectionId] ?? 'unknown'
      : 'local';

  const { isToolbarMode } = useToolbarModeContext();
  const { ensureForWorkspace: ensurePartnerBootstrapForWorkspace } = usePartnerBootstrap();

  const { handleMinimize, handleMaximize, handleClose, isMaximized } =
    useWindowControls({ isToolbarMode });

  const { state, switchLeftPanelTab, toggleLeftPanel, toggleRightPanel } = useApp();

  // 鈹€鈹€ Load user keybinding overrides from config on startup 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  useEffect(() => {
    const load = async () => {
      try {
        const raw = await configManager.getConfig('app.keybindings');
        const overrides = parseStoredKeybindings(raw);
        if (Object.keys(overrides).length > 0) {
          shortcutManager.loadUserOverrides(overrides);
        }
      } catch {
        // No overrides stored yet 鈥?that's fine
      }
    };

    void load();

    const unsubscribe = configManager.onConfigChange((path) => {
      if (path === 'app.keybindings') void load();
    });

    return () => unsubscribe();
  }, []);
  const activeSceneId = useSceneStore(s => s.activeTabId);
  const isAgentScene = activeSceneId === 'session';
  const isWelcomeScene = activeSceneId === 'welcome';

  const isTransitioning = false;
  const transitionDir: TransitionDirection = null;

  // Auto-open last workspace on startup
  const autoOpenAttemptedRef = useRef(false);
  useEffect(() => {
    if (autoOpenAttemptedRef.current || loading) return;
    if (!hasWorkspace && recentWorkspaces.length > 0) {
      autoOpenAttemptedRef.current = true;
      switchWorkspace(recentWorkspaces[0]).catch(err => {
        log.warn('Auto-open recent workspace failed', err);
      });
    } else {
      autoOpenAttemptedRef.current = true;
    }
  }, [hasWorkspace, loading, recentWorkspaces, switchWorkspace]);

  // Dialog state (previously in TitleBar)
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [showAboutDialog, setShowAboutDialog] = useState(false);
  const [showWorkspaceStatus, setShowWorkspaceStatus] = useState(false);
  const handleOpenProject = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('header.selectProjectDirectory'),
      });

      if (selected && typeof selected === 'string') {
        await openWorkspace(selected);
      }
    } catch (error) {
      log.error('Failed to open project', error);
    }
  }, [openWorkspace, t]);
  const handleNewProject = useCallback(() => setShowNewProjectDialog(true), []);
  const handleShowAbout  = useCallback(() => setShowAboutDialog(true), []);

  const handleConfirmNewProject = useCallback(async (parentPath: string, projectName: string) => {
    const normalized = parentPath.replace(/\\/g, '/');
    const newProjectPath = `${normalized}/${projectName}`;
    try {
      await workspaceAPI.createDirectory(newProjectPath);
      await openWorkspace(newProjectPath);
    } catch (error) {
      log.error('Failed to create project', error);
      throw error;
    }
  }, [openWorkspace]);

  // Listen for nav-panel events dispatched by the workspace area
  useEffect(() => {
    const onOpenProject = () => { void handleOpenProject(); };
    const onNewProject = () => handleNewProject();
    window.addEventListener('nav:open-project', onOpenProject);
    window.addEventListener('nav:new-project', onNewProject);
    return () => {
      window.removeEventListener('nav:open-project', onOpenProject);
      window.removeEventListener('nav:new-project', onNewProject);
    };
  }, [handleNewProject, handleOpenProject]);

  // macOS native menubar events (previously in TitleBar)
  const isMacOS = useMemo(() => {
    const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;
    return isTauri && typeof navigator?.platform === 'string' && navigator.platform.toUpperCase().includes('MAC');
  }, []);

  useEffect(() => {
    if (!isMacOS) return;
    let unlistenFns: Array<() => void> = [];
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const { open } = await import('@tauri-apps/plugin-dialog');
        unlistenFns.push(await listen('openharness_menu_open_project', async () => {
          try {
            const selected = await open({ directory: true, multiple: false }) as string;
            if (selected) await openWorkspace(selected);
          } catch {}
        }));
        unlistenFns.push(await listen('openharness_menu_new_project', () => handleNewProject()));
        unlistenFns.push(await listen('openharness_menu_about', () => handleShowAbout()));
      } catch {}
    })();
    return () => { unlistenFns.forEach(fn => fn()); unlistenFns = []; };
  }, [isMacOS, openWorkspace, handleNewProject, handleShowAbout]);

  useWorkbenchSessionBootstrap({
    currentWorkspace,
    remoteSshFlowChatKey,
    ensurePartnerBootstrapForWorkspace,
    t,
  });

  useWorkbenchWindowClosePersistence();

  // Handle switch-to-files-panel event
  useEffect(() => {
    const handleSwitchToFilesPanel = () => {
      switchLeftPanelTab('files');
      if (state.layout.leftPanelCollapsed) toggleLeftPanel();
      if (state.layout.rightPanelCollapsed) {
        setTimeout(() => toggleRightPanel(), 100);
      }
    };

    window.addEventListener('switch-to-files-panel', handleSwitchToFilesPanel);
    return () => window.removeEventListener('switch-to-files-panel', handleSwitchToFilesPanel);
  }, [state.layout.leftPanelCollapsed, state.layout.rightPanelCollapsed, switchLeftPanelTab, toggleLeftPanel, toggleRightPanel]);

  useWorkbenchToolbarBridge();

  // Toggle left panel: mod+B (VS Code convention)
  useShortcut(
    'panel.toggleLeft',
    { key: 'B', ctrl: true, scope: 'app' },
    () => toggleLeftPanel(),
    { priority: 5, description: 'keyboard.shortcuts.panel.toggleLeft' }
  );

  // Collapse/expand both panels: mod+Shift+B
  useShortcut(
    'panel.toggleBoth',
    { key: 'B', ctrl: true, shift: true, scope: 'app' },
    () => {
      const bothCollapsed = state.layout.leftPanelCollapsed && state.layout.rightPanelCollapsed;
      if (bothCollapsed) {
        toggleLeftPanel();
        setTimeout(() => toggleRightPanel(), 50);
      } else {
        if (!state.layout.leftPanelCollapsed) toggleLeftPanel();
        if (!state.layout.rightPanelCollapsed) toggleRightPanel();
      }
    },
    { priority: 5, description: 'keyboard.shortcuts.panel.toggleBoth' }
  );

  useWorkbenchDragAndDropGuard();

  const containerClassName = [
    'openharness-app-layout',
    isMacOS ? 'openharness-app-layout--macos' : '',
    className,
    isTransitioning ? 'openharness-app-layout--transitioning' : '',
  ].filter(Boolean).join(' ');

  if (isToolbarMode) return <ToolbarMode />;

  return (
    <>
      <div className={containerClassName} data-testid="app-layout">
        {/* Main content 鈥?always render WorkspaceBody; WelcomeScene in viewport handles no-workspace state */}
        <main className="openharness-app-main-workspace" data-testid="app-main-content">
          <WorkspaceBody
            onMinimize={isMacOS ? undefined : handleMinimize}
            onMaximize={handleMaximize}
            onClose={isMacOS ? undefined : handleClose}
            isMaximized={isMaximized}
            isEntering={transitionDir === 'entering'}
            isExiting={transitionDir === 'returning'}
          />
        </main>

        {/* Non-agent scenes: floating mini chat button */}
        {!isWelcomeScene && !isAgentScene && (
          <Suspense fallback={null}>
            <LazyFloatingMiniChat />
          </Suspense>
        )}
      </div>

      {/* Dialogs (previously owned by TitleBar) */}
      {showNewProjectDialog && (
        <Suspense fallback={null}>
          <LazyNewProjectDialog
            isOpen={showNewProjectDialog}
            onClose={() => setShowNewProjectDialog(false)}
            onConfirm={handleConfirmNewProject}
            defaultParentPath={hasWorkspace ? currentWorkspace?.rootPath : undefined}
          />
        </Suspense>
      )}
      {showWorkspaceStatus && (
        <Suspense fallback={null}>
          <LazyWorkspaceManager
            isVisible={showWorkspaceStatus}
            onClose={() => setShowWorkspaceStatus(false)}
            onWorkspaceSelect={() => {}}
          />
        </Suspense>
      )}
      {showAboutDialog && (
        <Suspense fallback={null}>
          <LazyAboutDialog
            isOpen={showAboutDialog}
            onClose={() => setShowAboutDialog(false)}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <LazyMCPInteractionDialog />
      </Suspense>
    </>
  );
};

export default AppLayout;
