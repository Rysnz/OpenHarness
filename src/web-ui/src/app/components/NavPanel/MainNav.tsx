/**
 * MainNav — default workspace navigation sidebar.
 *
 * Layout (top to bottom):
 *   1. Workspace file search
 *   2. Top: New sessions | Partner | Extensions (expand → Agents | Skills)
 *   3. Partner sessions, Workspace
 *   4. Bottom: MiniApp
 *
 * When a scene-nav transition is active (`isDeparting=true`), items receive
 * positional CSS classes for the split-open animation effect.
 */

import React, { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, FolderOpen, FolderPlus, History, Check, User, Users, Puzzle, Blocks, ChevronDown, Search } from 'lucide-react';
import { OpenHarnessLogo, Tooltip } from '@/component-library';
import { useApp } from '../../hooks/useApp';
import { useSceneManager } from '../../hooks/useSceneManager';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import type { SceneTabId } from '../SceneBar/types';
import SectionHeader from './components/SectionHeader';
import MiniAppEntry from './components/MiniAppEntry';
import WorkspaceListSection from './sections/workspaces/WorkspaceListSection';
import SessionsSection from './sections/sessions/SessionsSection';
import { useSceneStore } from '../../stores/sceneStore';
import { useMyAgentStore } from '../../scenes/my-agent/myAgentStore';
import { useMiniAppCatalogSync } from '../../scenes/miniapps/hooks/useMiniAppCatalogSync';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { createLogger } from '@/shared/utils/logger';
import { notificationService } from '@/shared/notification-system';
import { WorkspaceKind, isRemoteWorkspace } from '@/shared/types';
import {
  findLatestWorkspaceSessionId,
  flowChatSessionConfigForWorkspace,
  pickWorkspaceForProjectChatSession,
} from '@/app/utils/projectSessionWorkspace';
import { getRecentWorkspaceLineParts } from '@/shared/utils/recentWorkspaceDisplay';
import { useSSHRemoteContext, SSHConnectionDialog, RemoteFileBrowser } from '@/features/ssh-remote';
import { useSessionModeStore } from '../../stores/sessionModeStore';
import NavSearchDialog from './NavSearchDialog';
import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import { ALL_SHORTCUTS } from '@/shared/constants/shortcuts';

import './NavPanel.scss';

const NAV_TOGGLE_SEARCH_DEF = ALL_SHORTCUTS.find((d) => d.id === 'nav.toggleSearch')!;

const log = createLogger('MainNav');

interface MainNavProps {
  isDeparting?: boolean;
  anchorNavSceneId?: SceneTabId | null;
}

const MainNav: React.FC<MainNavProps> = ({
  isDeparting: _isDeparting = false,
  anchorNavSceneId: _anchorNavSceneId = null,
}) => {
  useMiniAppCatalogSync();

  const sshRemote = useSSHRemoteContext();
  const [isSSHConnectionDialogOpen, setIsSSHConnectionDialogOpen] = useState(false);

  useEffect(() => {
    if (sshRemote.showFileBrowser) {
      setIsSSHConnectionDialogOpen(false);
    }
  }, [sshRemote.showFileBrowser]);

  const { switchLeftPanelTab } = useApp();
  const { openScene } = useSceneManager();
  const activeTabId = useSceneStore(s => s.activeTabId);
  const setSelectedPartnerWorkspaceId = useMyAgentStore((s) => s.setSelectedPartnerWorkspaceId);
  const { t } = useI18n('common');
  const {
    currentWorkspace,
    recentWorkspaces,
    openedWorkspacesList,
    partnerWorkspacesList,
    normalWorkspacesList,
    switchWorkspace,
    setActiveWorkspace,
  } = useWorkspaceContext();

  const activeMiniAppId = useMemo(
    () => (typeof activeTabId === 'string' && activeTabId.startsWith('miniapp:') ? activeTabId.slice('miniapp:'.length) : null),
    [activeTabId]
  );

  // Section expand state
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(['tasks', 'workspace'])
  );

  const workspaceMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceMenuClosing, setWorkspaceMenuClosing] = useState(false);
  const [workspaceMenuPos, setWorkspaceMenuPos] = useState({ top: 0, left: 0 });
  const [isExtensionsOpen, setIsExtensionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const toggleSection = useCallback((id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const closeWorkspaceMenu = useCallback(() => {
    setWorkspaceMenuClosing(true);
    window.setTimeout(() => {
      setWorkspaceMenuOpen(false);
      setWorkspaceMenuClosing(false);
    }, 150);
  }, []);

  const openWorkspaceMenu = useCallback(async () => {
    try {
      await workspaceManager.cleanupInvalidWorkspaces();
    } catch (error) {
      log.warn('Failed to cleanup invalid workspaces before opening workspace menu', { error });
    }
    const rect = workspaceMenuButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setWorkspaceMenuPos({ top: rect.bottom + 6, left: rect.left });
    setWorkspaceMenuOpen(true);
    setWorkspaceMenuClosing(false);
  }, []);

  const toggleWorkspaceMenu = useCallback(() => {
    if (workspaceMenuOpen) { closeWorkspaceMenu(); return; }
    void openWorkspaceMenu();
  }, [closeWorkspaceMenu, openWorkspaceMenu, workspaceMenuOpen]);

  const sessionMode = useSessionModeStore(s => s.mode);
  const setSessionMode = useSessionModeStore(s => s.setMode);
  const isPartnerWorkspaceActive = currentWorkspace?.workspaceKind === WorkspaceKind.Partner;

  const defaultPartnerWorkspace = useMemo(
    () => partnerWorkspacesList.find(w => !w.partnerId) ?? partnerWorkspacesList[0] ?? null,
    [partnerWorkspacesList]
  );
  const projectTaskWorkspace = useMemo(
    () => pickWorkspaceForProjectChatSession(currentWorkspace, normalWorkspacesList),
    [currentWorkspace, normalWorkspacesList]
  );

  useEffect(() => {
    openedWorkspacesList.forEach(workspace => {
      if (workspace.workspaceKind === WorkspaceKind.Remote) {
        void flowChatStore.initializeFromDisk(
          workspace.rootPath,
          workspace.connectionId ?? undefined,
          workspace.sshHost ?? undefined
        );
      } else {
        void flowChatStore.initializeFromDisk(workspace.rootPath);
      }
    });
  }, [openedWorkspacesList]);

  const toggleNavSearch = useCallback(() => {
    setSearchOpen((v) => !v);
  }, []);

  useShortcut(
    NAV_TOGGLE_SEARCH_DEF.id,
    NAV_TOGGLE_SEARCH_DEF.config,
    toggleNavSearch,
    { priority: 5, description: NAV_TOGGLE_SEARCH_DEF.descriptionKey }
  );

  // Secondary binding (not listed separately in keyboard settings — same action as Mod+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        !e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'f'
      ) {
        return;
      }
      e.preventDefault();
      toggleNavSearch();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleNavSearch]);

  const handleCreateProjectSession = useCallback(
    async (mode: 'agentic' | 'Cowork', options?: { preferLatest?: boolean }) => {
      const target = pickWorkspaceForProjectChatSession(currentWorkspace, normalWorkspacesList);
      if (!target) {
        notificationService.warning(t('nav.sessions.needProjectWorkspaceForSession'), { duration: 4500 });
        return;
      }
      openScene('session');
      switchLeftPanelTab('sessions');
      try {
        if (target.id !== currentWorkspace?.id) {
          await setActiveWorkspace(target.id);
        }
        if (options?.preferLatest !== false) {
          const latestSessionId = findLatestWorkspaceSessionId(target, mode);
          if (latestSessionId) {
            await flowChatManager.switchChatSession(latestSessionId);
            return;
          }
        }
        await flowChatManager.createChatSession(flowChatSessionConfigForWorkspace(target), mode);
      } catch (err) {
        log.error('Failed to create session', err);
      }
    },
    [
      currentWorkspace,
      normalWorkspacesList,
      openScene,
      setActiveWorkspace,
      switchLeftPanelTab,
      t,
    ]
  );

  const handleToggleSessionMode = useCallback(() => {
    const nextMode = sessionMode === 'code' ? 'cowork' : 'code';
    setSessionMode(nextMode);
    void handleCreateProjectSession(nextMode === 'code' ? 'agentic' : 'Cowork');
  }, [handleCreateProjectSession, sessionMode, setSessionMode]);

  const handleCreateCurrentModeTask = useCallback(() => {
    void handleCreateProjectSession(
      sessionMode === 'code' ? 'agentic' : 'Cowork',
      { preferLatest: false }
    );
  }, [handleCreateProjectSession, sessionMode]);

  const handleOpenProject = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title: t('header.selectProjectDirectory') });
      if (selected && typeof selected === 'string') {
        await workspaceManager.openWorkspace(selected);
      }
    } catch (err) {
      log.error('Failed to open project', err);
    }
  }, [t]);

  const handleNewProject = useCallback(() => {
    window.dispatchEvent(new Event('nav:new-project'));
  }, []);

  const handleSwitchWorkspace = useCallback(async (workspaceId: string) => {
    const targetWorkspace = recentWorkspaces.find(item => item.id === workspaceId);
    if (!targetWorkspace) return;
    closeWorkspaceMenu();
    await switchWorkspace(targetWorkspace);
  }, [closeWorkspaceMenu, recentWorkspaces, switchWorkspace]);

  const handleOpenRemoteSSH = useCallback(() => {
    closeWorkspaceMenu();
    setIsSSHConnectionDialogOpen(true);
  }, [closeWorkspaceMenu]);

  const handleSelectRemoteWorkspace = useCallback(async (path: string) => {
    try {
      await sshRemote.openWorkspace(path);
      sshRemote.setShowFileBrowser(false);
      setIsSSHConnectionDialogOpen(false);
    } catch (err) {
      log.error('Failed to open remote workspace', err);
    }
  }, [sshRemote]);

  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (workspaceMenuButtonRef.current?.contains(target)) return;
      if (workspaceMenuRef.current?.contains(target)) return;
      closeWorkspaceMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeWorkspaceMenu();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closeWorkspaceMenu, workspaceMenuOpen]);

  const handleOpenPartner = useCallback(() => {
    const targetPartnerWorkspace =
      isPartnerWorkspaceActive && currentWorkspace?.workspaceKind === WorkspaceKind.Partner
        ? currentWorkspace
        : defaultPartnerWorkspace;

    if (targetPartnerWorkspace?.id) {
      setSelectedPartnerWorkspaceId(targetPartnerWorkspace.id);
    }
    if (!isPartnerWorkspaceActive && targetPartnerWorkspace) {
      void setActiveWorkspace(targetPartnerWorkspace.id).catch(error => {
        log.warn('Failed to activate default partner workspace', { error });
      });
    }
    switchLeftPanelTab('profile');
    openScene('partner');
  }, [
    currentWorkspace,
    defaultPartnerWorkspace,
    isPartnerWorkspaceActive,
    openScene,
    setActiveWorkspace,
    setSelectedPartnerWorkspaceId,
    switchLeftPanelTab,
  ]);

  const handleOpenAgents = useCallback(() => {
    openScene('agents');
  }, [openScene]);

  const handleOpenSkills = useCallback(() => {
    openScene('skills');
  }, [openScene]);

  const isAgentsActive = activeTabId === 'agents';
  const isSkillsActive = activeTabId === 'skills';

  useEffect(() => {
    if (isAgentsActive || isSkillsActive) {
      setIsExtensionsOpen(true);
    }
  }, [isAgentsActive, isSkillsActive]);

  const workspaceMenuPortal = workspaceMenuOpen ? createPortal(
    <div
      ref={workspaceMenuRef}
      className={`openharness-nav-panel__workspace-menu${workspaceMenuClosing ? ' is-closing' : ''}`}
      role="menu"
      style={{ top: workspaceMenuPos.top, left: workspaceMenuPos.left }}
    >
      <button
        type="button"
        className="openharness-nav-panel__workspace-menu-item"
        role="menuitem"
        onClick={() => { closeWorkspaceMenu(); void handleOpenProject(); }}
      >
        <FolderOpen size={13} />
        <span>{t('header.openProject')}</span>
      </button>
      <button
        type="button"
        className="openharness-nav-panel__workspace-menu-item"
        role="menuitem"
        onClick={() => { closeWorkspaceMenu(); handleNewProject(); }}
      >
        <FolderPlus size={13} />
        <span>{t('header.newProject')}</span>
      </button>
      <button
        type="button"
        className="openharness-nav-panel__workspace-menu-item"
        role="menuitem"
        onClick={handleOpenRemoteSSH}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0-6v6" />
        </svg>
        <span>{t('ssh.remote.connect')}</span>
      </button>
      <div className="openharness-nav-panel__workspace-menu-divider" role="separator" />
      <div className="openharness-nav-panel__workspace-menu-section-title">
        <History size={12} aria-hidden="true" />
        <span>{t('header.recentWorkspaces')}</span>
      </div>
      {recentWorkspaces.length === 0 ? (
        <div className="openharness-nav-panel__workspace-menu-empty">
          <span>{t('header.noRecentWorkspaces')}</span>
        </div>
      ) : (
        <div className="openharness-nav-panel__workspace-menu-workspaces">
          {recentWorkspaces.map((workspace) => {
            const { hostPrefix, folderLabel, tooltip } = getRecentWorkspaceLineParts(workspace);
            return (
            <button
              key={workspace.id}
              type="button"
              className="openharness-nav-panel__workspace-menu-item openharness-nav-panel__workspace-menu-item--workspace"
              role="menuitem"
              title={tooltip}
              onClick={() => { void handleSwitchWorkspace(workspace.id); }}
            >
              <FolderOpen size={13} aria-hidden="true" />
              <span className="openharness-nav-panel__workspace-menu-item-main">
                {hostPrefix ? (
                  <>
                    <span className="openharness-nav-panel__workspace-menu-item-host">{hostPrefix}</span>
                    <span className="openharness-nav-panel__workspace-menu-item-host-sep" aria-hidden>
                      ·
                    </span>
                  </>
                ) : null}
                <span className="openharness-nav-panel__workspace-menu-item-name">{folderLabel}</span>
              </span>
              {workspace.id === currentWorkspace?.id ? <Check size={12} aria-hidden="true" /> : null}
            </button>
            );
          })}
        </div>
      )}
    </div>,
    document.body
  ) : null;

  const sessionModeLabel = sessionMode === 'code' ? 'Code' : 'MTC';
  const sessionModeTooltip = `${t('nav.sessions.modeSwitchLabel')}: ${sessionModeLabel}`;
  const partnerTooltip = t('nav.items.persona');
  const addWorkspaceTooltip = t('nav.tooltips.addWorkspace');
  const isPartnerActive = activeTabId === 'partner';
  const agentsTooltip = t('nav.tooltips.agents');
  const skillsTooltip = t('nav.tooltips.skills');
  const extensionsLabel = t('nav.sections.extensions');
  return (
    <>
      {/* ── Workspace search ───────────────────────── */}
      <div className="openharness-nav-panel__brand-header">
        <div className="openharness-nav-panel__brand-search">
          <Tooltip content={t('nav.search.triggerTooltip')} placement="right" followCursor>
            <button
              type="button"
              className="openharness-nav-panel__search-trigger"
              onClick={() => setSearchOpen(true)}
              aria-label={t('nav.search.triggerTooltip')}
            >
              <span className="openharness-nav-panel__search-trigger__icon" aria-hidden="true">
                <span className="openharness-nav-panel__search-trigger__icon-inner">
                  <Search size={13} />
                </span>
              </span>
              <span className="openharness-nav-panel__search-trigger__label">
                {t('nav.search.triggerPlaceholder')}
              </span>
            </button>
          </Tooltip>
          <NavSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
        </div>
      </div>

      {/* ── Top action strip ────────────────────────── */}
      <div className="openharness-nav-panel__top-actions">
        <Tooltip content={sessionModeTooltip} placement="right" followCursor>
          <button
            type="button"
            className={`openharness-nav-panel__session-mode-switch is-${sessionMode}`}
            role="switch"
            aria-checked={sessionMode === 'cowork'}
            aria-label={sessionModeTooltip}
            onClick={handleToggleSessionMode}
          >
            <span className="openharness-nav-panel__session-mode-label">
              {sessionModeLabel}
            </span>
            <span className="openharness-nav-panel__session-mode-logo" aria-hidden="true">
              <OpenHarnessLogo size={16} variant="compact" animated={false} />
            </span>
          </button>
        </Tooltip>

        <Tooltip content={partnerTooltip} placement="right" followCursor>
          <button
            type="button"
            className={`openharness-nav-panel__top-action-btn${isPartnerActive ? ' is-active' : ''}`}
            onClick={handleOpenPartner}
            aria-label={partnerTooltip}
          >
            <span className="openharness-nav-panel__top-action-icon-slot" aria-hidden="true">
              <User size={15} />
            </span>
            <span>{t('nav.items.persona')}</span>
          </button>
        </Tooltip>

        <div className="openharness-nav-panel__top-action-expand">
          <Tooltip content={extensionsLabel} placement="right" followCursor>
            <button
              type="button"
              className={[
                'openharness-nav-panel__top-action-btn',
                'openharness-nav-panel__top-action-btn--expand',
                isExtensionsOpen ? 'is-open' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setIsExtensionsOpen(v => !v)}
              aria-expanded={isExtensionsOpen}
              aria-label={extensionsLabel}
            >
              <span className="openharness-nav-panel__top-action-expand-icons" aria-hidden="true">
                <Blocks size={15} className="openharness-nav-panel__top-action-expand-icon-default" />
                <ChevronDown
                  size={15}
                  className={[
                    'openharness-nav-panel__top-action-expand-icon-chevron',
                    isExtensionsOpen ? 'is-open' : '',
                  ].filter(Boolean).join(' ')}
                />
              </span>
              <span>{extensionsLabel}</span>
            </button>
          </Tooltip>

          <div className={`openharness-nav-panel__top-action-sublist${isExtensionsOpen ? ' is-open' : ''}`}>
            <Tooltip content={agentsTooltip} placement="right" followCursor>
              <button
                type="button"
                className={[
                  'openharness-nav-panel__top-action-btn',
                  'openharness-nav-panel__top-action-btn--sub',
                  isAgentsActive ? 'is-active' : '',
                ].filter(Boolean).join(' ')}
                onClick={handleOpenAgents}
                aria-label={agentsTooltip}
              >
                <span className="openharness-nav-panel__top-action-icon-slot" aria-hidden="true">
                  <Users size={15} />
                </span>
                <span>{t('nav.items.agents')}</span>
              </button>
            </Tooltip>

            <Tooltip content={skillsTooltip} placement="right" followCursor>
              <button
                type="button"
                className={[
                  'openharness-nav-panel__top-action-btn',
                  'openharness-nav-panel__top-action-btn--sub',
                  isSkillsActive ? 'is-active' : '',
                ].filter(Boolean).join(' ')}
                onClick={handleOpenSkills}
                aria-label={skillsTooltip}
              >
                <span className="openharness-nav-panel__top-action-icon-slot" aria-hidden="true">
                  <Puzzle size={15} />
                </span>
                <span>{t('nav.items.skills')}</span>
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* ── Sections ────────────────────────────────── */}
      <div className="openharness-nav-panel__sections">

        {/* Mode task list */}
        <div className="openharness-nav-panel__section">
          <SectionHeader
            label={t('nav.sections.tasks')}
            collapsible
            isOpen={expandedSections.has('tasks')}
            onToggle={() => toggleSection('tasks')}
            actions={(
              <Tooltip content={t('nav.sessions.newTask')} placement="right" followCursor>
                <button
                  type="button"
                  className="openharness-nav-panel__section-action"
                  aria-label={t('nav.sessions.newTask')}
                  onClick={handleCreateCurrentModeTask}
                >
                  <Plus size={13} />
                </button>
              </Tooltip>
            )}
          />
          <div className={`openharness-nav-panel__collapsible${expandedSections.has('tasks') ? '' : ' is-collapsed'}`}>
            <div className="openharness-nav-panel__collapsible-inner">
              <div className="openharness-nav-panel__items openharness-nav-panel__items--session-blocks">
                {projectTaskWorkspace ? (
                  <SessionsSection
                    key={`${projectTaskWorkspace.id}-${sessionMode}`}
                    workspaceId={projectTaskWorkspace.id}
                    workspacePath={projectTaskWorkspace.rootPath}
                    remoteConnectionId={isRemoteWorkspace(projectTaskWorkspace) ? projectTaskWorkspace.connectionId : null}
                    remoteSshHost={isRemoteWorkspace(projectTaskWorkspace) ? projectTaskWorkspace.sshHost : null}
                    isActiveWorkspace={projectTaskWorkspace.id === currentWorkspace?.id}
                    modeFilter={['code', 'cowork']}
                    showEmptyState
                    emptyTitle={t('nav.sessions.noTasks')}
                    emptyDescription={t('nav.sessions.emptyTaskHint')}
                  />
                ) : (
                  <div className="openharness-nav-panel__inline-empty openharness-nav-panel__inline-empty--tasks">
                    <div className="openharness-nav-panel__inline-empty-title">{t('nav.sessions.noTasks')}</div>
                    <div className="openharness-nav-panel__inline-empty-description">{t('nav.sessions.emptyTaskHint')}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Workspace */}
        <div className="openharness-nav-panel__section">
          <SectionHeader
            label={t('nav.sections.workspace')}
            collapsible
            isOpen={expandedSections.has('workspace')}
            onToggle={() => toggleSection('workspace')}
            actions={
              <div className="openharness-nav-panel__workspace-action-wrap">
                <Tooltip content={addWorkspaceTooltip} placement="right" followCursor disabled={workspaceMenuOpen}>
                  <button
                    ref={workspaceMenuButtonRef}
                    type="button"
                    className={`openharness-nav-panel__section-action${workspaceMenuOpen ? ' is-active' : ''}`}
                    aria-label={addWorkspaceTooltip}
                    aria-expanded={workspaceMenuOpen}
                    onClick={toggleWorkspaceMenu}
                  >
                    <Plus size={13} />
                  </button>
                </Tooltip>
              </div>
            }
          />
          <div className={`openharness-nav-panel__collapsible${expandedSections.has('workspace') ? '' : ' is-collapsed'}`}>
            <div className="openharness-nav-panel__collapsible-inner">
              <div className="openharness-nav-panel__items">
                <WorkspaceListSection variant="projects" />
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ── Bottom: MiniApp ───────────────────────── */}
      <div className="openharness-nav-panel__bottom-bar">
        <div className="openharness-nav-panel__miniapp-footer">
          <MiniAppEntry
            isActive={activeTabId === 'miniapps' || !!activeMiniAppId}
            activeMiniAppId={activeMiniAppId}
            onOpenMiniApps={() => openScene('miniapps')}
            onOpenMiniApp={(appId) => openScene(`miniapp:${appId}`)}
          />
        </div>
      </div>

      {workspaceMenuPortal}

      {/* SSH Remote Dialogs */}
      <SSHConnectionDialog
        open={isSSHConnectionDialogOpen}
        onClose={() => setIsSSHConnectionDialogOpen(false)}
      />
      {sshRemote.showFileBrowser && sshRemote.connectionId && (
        <RemoteFileBrowser
          connectionId={sshRemote.connectionId}
          initialPath={sshRemote.remoteFileBrowserInitialPath}
          homePath={sshRemote.remoteFileBrowserInitialPath}
          onSelect={handleSelectRemoteWorkspace}
          onCancel={() => {
            sshRemote.setShowFileBrowser(false);
            void sshRemote.disconnect();
          }}
        />
      )}
    </>
  );
};

export default MainNav;
