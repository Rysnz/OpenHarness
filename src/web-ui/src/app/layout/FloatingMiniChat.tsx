/**
 * Floating mini chat — circular button in bottom-right that expands to an
 * always-expanded ToolbarMode-style conversation panel with FlowChat.
 * Used in non-agent scenes only; agent scene uses centered ChatInput.
 *
 * When opened the button disappears and the panel springs into view;
 * closing reverses the animation and restores the button.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  X,
  Check,
  Square,
  ArrowUp,
  ChevronDown,
  Plus
} from 'lucide-react';
import { flowChatStore } from '../../flow_chat/store/FlowChatStore';
import { FlowChatManager } from '../../flow_chat/services/FlowChatManager';
import { syncSessionToModernStore } from '../../flow_chat/services/storeSync';
import { useToolbarModeContext } from '../../flow_chat/components/toolbar-mode/ToolbarModeContext';
import type { FlowChatState } from '../../flow_chat/types/flow-chat';
import {
  compareSessionsForDisplay,
  sessionBelongsToWorkspaceNavRow,
} from '../../flow_chat/utils/sessionOrdering';
import { ModernFlowChatContainer } from '../../flow_chat/components/modern/ModernFlowChatContainer';
import { Tooltip, Input } from '@/component-library';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { findLatestWorkspaceSessionId } from '@/app/utils/projectSessionWorkspace';
import { createLogger } from '@/shared/utils/logger';
import { useMyAgentStore } from '@/app/scenes/my-agent/myAgentStore';
import { WorkspaceKind, type WorkspaceInfo } from '@/shared/types';
import './FloatingMiniChat.scss';

const log = createLogger('FloatingMiniChat');

export const FloatingMiniChat: React.FC = () => {
  const { t } = useTranslation('flow-chat');
  const { toolbarState } = useToolbarModeContext();
  const { currentWorkspace, partnerWorkspacesList, setActiveWorkspace } = useWorkspaceContext();
  const selectedPartnerWorkspaceId = useMyAgentStore((s) => s.selectedPartnerWorkspaceId);
  const setSelectedPartnerWorkspaceId = useMyAgentStore((s) => s.setSelectedPartnerWorkspaceId);

  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [flowChatState, setFlowChatState] = useState<FlowChatState>(() =>
    flowChatStore.getState()
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const sessionPickerRef = useRef<HTMLDivElement>(null);
  const partnerWorkspace = useMemo(() => {
    const activePartner =
      currentWorkspace?.workspaceKind === WorkspaceKind.Partner
        ? currentWorkspace
        : null;
    const selectedPartner = selectedPartnerWorkspaceId
      ? partnerWorkspacesList.find(workspace => workspace.id === selectedPartnerWorkspaceId) ?? null
      : null;
    const primaryPartner = partnerWorkspacesList.find(workspace => !workspace.partnerId) ?? null;
    return activePartner ?? selectedPartner ?? primaryPartner ?? partnerWorkspacesList[0] ?? null;
  }, [currentWorkspace, partnerWorkspacesList, selectedPartnerWorkspaceId]);

  const visiblePartnerTabs = useMemo<WorkspaceInfo[]>(() => {
    if (partnerWorkspacesList.length > 0) {
      return partnerWorkspacesList;
    }
    return partnerWorkspace ? [partnerWorkspace] : [];
  }, [partnerWorkspace, partnerWorkspacesList]);

  const partnerName = useMemo(() => {
    const rawName =
      partnerWorkspace?.identity?.name?.trim() ||
      partnerWorkspace?.name?.trim() ||
      '';
    return rawName || t('session.partnerFallbackName', { defaultValue: 'Partner' });
  }, [partnerWorkspace, t]);

  useEffect(() => {
    const unsubscribe = flowChatStore.subscribe((state) => {
      setFlowChatState(state);
    });
    return () => unsubscribe();
  }, []);

  const sessionTitle = useMemo(() => {
    const activeSession = flowChatState.activeSessionId
      ? flowChatState.sessions.get(flowChatState.activeSessionId)
      : undefined;
    return activeSession?.title || t('session.new');
  }, [flowChatState, t]);

  const titleText = useMemo(
    () => partnerWorkspace ? `${partnerName} / ${sessionTitle}` : sessionTitle,
    [partnerName, partnerWorkspace, sessionTitle]
  );

  const sessions = useMemo(() => {
    const allSessions = Array.from(flowChatState.sessions.values());
    if (!partnerWorkspace) {
      return allSessions.sort(compareSessionsForDisplay).slice(0, 10);
    }
    return allSessions
      .filter(session =>
        sessionBelongsToWorkspaceNavRow(
          session,
          partnerWorkspace.rootPath,
          partnerWorkspace.connectionId ?? null,
          partnerWorkspace.sshHost ?? null
        )
      )
      .sort(compareSessionsForDisplay)
      .slice(0, 10);
  }, [partnerWorkspace, flowChatState]);

  const currentStreamState = useMemo(() => {
    const activeSession = flowChatState.activeSessionId
      ? flowChatState.sessions.get(flowChatState.activeSessionId)
      : undefined;

    if (!activeSession || !activeSession.dialogTurns || activeSession.dialogTurns.length === 0) {
      return { isStreaming: false };
    }

    const lastTurn = activeSession.dialogTurns[activeSession.dialogTurns.length - 1];
    const isStreaming =
      lastTurn.status === 'processing' ||
      lastTurn.status === 'finishing' ||
      lastTurn.status === 'image_analyzing';
    return { isStreaming };
  }, [flowChatState]);

  const ensurePartnerSessionForWorkspace = useCallback(
    async (targetWorkspace: WorkspaceInfo | null, createNew = false): Promise<string | null> => {
      if (!targetWorkspace) {
        const state = flowChatStore.getState();
        return state.activeSessionId ?? null;
      }

      setSelectedPartnerWorkspaceId(targetWorkspace.id);
      await setActiveWorkspace(targetWorkspace.id);

      let sessionId = createNew
        ? null
        : findLatestWorkspaceSessionId(targetWorkspace, 'Partner');

      if (!sessionId) {
        sessionId = await FlowChatManager.getInstance().createChatSession(
          {
            workspaceId: targetWorkspace.id,
            workspacePath: targetWorkspace.rootPath,
          },
          'Partner'
        );
      } else {
        await FlowChatManager.getInstance().switchChatSession(sessionId);
      }

      syncSessionToModernStore(sessionId);
      return sessionId;
    },
    [setActiveWorkspace, setSelectedPartnerWorkspaceId]
  );

  const ensurePartnerSession = useCallback(
    async (createNew = false): Promise<string | null> => ensurePartnerSessionForWorkspace(partnerWorkspace, createNew),
    [ensurePartnerSessionForWorkspace, partnerWorkspace]
  );

  const handleOpen = useCallback(() => {
    void (async () => {
      try {
        await ensurePartnerSession(false);
      } catch (error) {
        log.error('Failed to prepare partner session', error);
      } finally {
        setIsOpen(true);
      }
    })();
  }, [ensurePartnerSession]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setShowSessionPicker(false);
  }, []);

  const getPartnerDisplayName = useCallback((workspace: WorkspaceInfo): string => (
    workspace.identity?.name?.trim() ||
    workspace.name?.trim() ||
    t('session.partnerFallbackName', { defaultValue: 'Partner' })
  ), [t]);

  const getPartnerInitial = useCallback((workspace: WorkspaceInfo): string => {
    const name = getPartnerDisplayName(workspace).trim();
    return Array.from(name)[0]?.toUpperCase() || 'P';
  }, [getPartnerDisplayName]);

  const handleSwitchPartner = useCallback((e: React.MouseEvent, workspace: WorkspaceInfo) => {
    e.stopPropagation();
    e.preventDefault();
    void (async () => {
      try {
        await ensurePartnerSessionForWorkspace(workspace, false);
        setShowSessionPicker(false);
      } catch (error) {
        log.error('Failed to switch partner workspace', error);
      }
    })();
  }, [ensurePartnerSessionForWorkspace]);

  const handleSwitchSession = useCallback((e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    e.preventDefault();
    void (async () => {
      if (partnerWorkspace) {
        setSelectedPartnerWorkspaceId(partnerWorkspace.id);
        await setActiveWorkspace(partnerWorkspace.id);
      }
      flowChatStore.switchSession(sessionId);
      syncSessionToModernStore(sessionId);
      setShowSessionPicker(false);
    })();
  }, [partnerWorkspace, setActiveWorkspace, setSelectedPartnerWorkspaceId]);

  const handleCancel = useCallback(() => {
    window.dispatchEvent(new CustomEvent('toolbar-cancel-task'));
  }, []);

  const handleConfirm = useCallback(() => {
    if (toolbarState.pendingToolId) {
      window.dispatchEvent(
        new CustomEvent('toolbar-tool-confirm', { detail: { toolId: toolbarState.pendingToolId } })
      );
    }
  }, [toolbarState.pendingToolId]);

  const handleReject = useCallback(() => {
    if (toolbarState.pendingToolId) {
      window.dispatchEvent(
        new CustomEvent('toolbar-tool-reject', { detail: { toolId: toolbarState.pendingToolId } })
      );
    }
  }, [toolbarState.pendingToolId]);

  const handleCreateSession = useCallback(() => {
    void (async () => {
      try {
        await ensurePartnerSession(true);
        setShowSessionPicker(false);
      } catch (error) {
        log.error('Failed to create partner session', error);
      }
    })();
  }, [ensurePartnerSession]);

  const handleSendMessage = useCallback(() => {
    const message = inputValue.trim();
    if (message) {
      window.dispatchEvent(
        new CustomEvent('toolbar-send-message', {
          detail: { message, sessionId: flowChatState.activeSessionId }
        })
      );
      setInputValue('');
    }
  }, [inputValue, flowChatState.activeSessionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (showSessionPicker) {
          setShowSessionPicker(false);
        } else {
          handleClose();
        }
      }
    },
    [handleSendMessage, showSessionPicker, handleClose]
  );

  // Close session picker when clicking outside it
  useEffect(() => {
    if (!isOpen || !showSessionPicker) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (sessionPickerRef.current?.contains(target)) return;
      if (target.closest?.('.openharness-fmc__title-btn')) return;
      setShowSessionPicker(false);
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, showSessionPicker]);

  const panelClassName = [
    'openharness-fmc__panel',
    isOpen && 'openharness-fmc__panel--open',
    visiblePartnerTabs.length > 0 && 'openharness-fmc__panel--with-partner-tabs',
    currentStreamState.isStreaming && 'openharness-fmc__panel--processing',
    toolbarState.hasError && 'openharness-fmc__panel--error',
    toolbarState.hasPendingConfirmation && 'openharness-fmc__panel--confirm'
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`openharness-fmc ${isOpen ? 'openharness-fmc--open' : ''}`}>
      {/* Fullscreen backdrop to catch outside clicks */}
      {isOpen && (
        <div
          className="openharness-fmc__backdrop"
          onMouseDown={handleClose}
        />
      )}

      {/* Circular trigger button — hidden when panel is open */}
      <button
        type="button"
        className="openharness-fmc__button openharness-fmc__button--partner"
        onClick={handleOpen}
        aria-label="Partner"
      >
        <Bot size={20} />
      </button>

      {/* Expanded panel */}
      <div ref={panelRef} className={panelClassName}>
        {isOpen && visiblePartnerTabs.length > 0 && (
          <div
            className="openharness-fmc__partner-tabs"
            aria-label={t('session.partnerSectionTitle', { defaultValue: 'Partners' })}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {visiblePartnerTabs.map((workspace) => {
              const name = getPartnerDisplayName(workspace);
              const avatarDataUrl = workspace.identity?.avatarDataUrl?.trim();
              return (
                <button
                  key={workspace.id}
                  type="button"
                  className={`openharness-fmc__partner-tab ${
                    workspace.id === partnerWorkspace?.id
                      ? 'openharness-fmc__partner-tab--active'
                      : ''
                  }`}
                  title={name}
                  aria-label={name}
                  onMouseDown={(e) => handleSwitchPartner(e, workspace)}
                >
                  {avatarDataUrl ? (
                    <img src={avatarDataUrl} alt="" />
                  ) : (
                    <span>{getPartnerInitial(workspace)}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="openharness-fmc__content">
        {/* Header */}
        <div className="openharness-fmc__header">
          <Tooltip content={t('session.new')}>
            <button type="button" className="openharness-fmc__header-btn" onClick={handleCreateSession}>
              <Plus size={14} />
            </button>
          </Tooltip>

          <div className="openharness-fmc__title-wrapper">
            <Tooltip content={t('session.switchSession')}>
              <button
                type="button"
                className="openharness-fmc__title-btn"
                onClick={() => setShowSessionPicker(!showSessionPicker)}
              >
                <span className="openharness-fmc__title-text">{titleText}</span>
                <ChevronDown
                  size={12}
                  className={`openharness-fmc__title-chevron ${showSessionPicker ? 'openharness-fmc__title-chevron--open' : ''}`}
                />
              </button>
            </Tooltip>

            {showSessionPicker && (
              <div
                className="openharness-fmc__session-dropdown"
                ref={sessionPickerRef}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="openharness-fmc__session-section openharness-fmc__session-section--sessions">
                  <div className="openharness-fmc__session-section-label">
                    <span>{partnerName}</span>
                    <small>{t('session.sessionSectionTitle', { defaultValue: 'Sessions' })}</small>
                  </div>
                  {sessions.length > 0 ? (
                    sessions.map((session) => (
                      <button
                        key={session.sessionId}
                        type="button"
                        className={`openharness-fmc__session-item ${
                          session.sessionId === flowChatState.activeSessionId
                            ? 'openharness-fmc__session-item--active'
                            : ''
                        }`}
                        onMouseDown={(e) => handleSwitchSession(e, session.sessionId)}
                      >
                        {session.title || t('session.new')}
                      </button>
                    ))
                  ) : (
                    <div className="openharness-fmc__session-empty">
                      {t('session.noPartnerSessions', { defaultValue: 'No sessions for this partner yet.' })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Confirm / reject controls inline in header */}
          {toolbarState.hasPendingConfirmation && (
            <>
              <Tooltip content={t('toolCards.common.confirm')}>
                <button type="button" className="openharness-fmc__header-btn openharness-fmc__header-btn--confirm" onClick={handleConfirm}>
                  <Check size={14} />
                </button>
              </Tooltip>
              <Tooltip content={t('toolCards.common.cancel')}>
                <button type="button" className="openharness-fmc__header-btn openharness-fmc__header-btn--reject" onClick={handleReject}>
                  <X size={14} />
                </button>
              </Tooltip>
            </>
          )}

          {currentStreamState.isStreaming && !toolbarState.hasPendingConfirmation && (
            <Tooltip content={t('input.stop')}>
              <button type="button" className="openharness-fmc__header-btn openharness-fmc__header-btn--stop" onClick={handleCancel}>
                <Square size={12} />
              </button>
            </Tooltip>
          )}

          <Tooltip content={t('planner.cancel')}>
            <button type="button" className="openharness-fmc__header-btn openharness-fmc__header-btn--close" onClick={handleClose}>
              <X size={14} />
            </button>
          </Tooltip>
        </div>

        {/* FlowChat body — only mounted while the panel is open to avoid
            running a second VirtualMessageList and store sync in the background
            while the agent is actively streaming in another scene. */}
        <div className="openharness-fmc__body">
          {isOpen && <ModernFlowChatContainer />}
        </div>

        {/* Input bar */}
        <div className="openharness-fmc__input-bar">
          <Input
            variant="filled"
            inputSize="small"
            className="openharness-fmc__input-wrapper"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              currentStreamState.isStreaming
                ? t('toolCards.toolbar.aiProcessing')
                : t('toolCards.toolbar.inputMessage')
            }
            disabled={currentStreamState.isStreaming}
          />
          {currentStreamState.isStreaming ? (
            <Tooltip content={t('input.stop')}>
              <button
                type="button"
                className="openharness-fmc__input-btn openharness-fmc__input-btn--stop"
                onClick={handleCancel}
              >
                <Square size={14} />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content={t('input.send')}>
              <button
                type="button"
                className="openharness-fmc__input-btn openharness-fmc__input-btn--send"
                onClick={handleSendMessage}
                disabled={!inputValue.trim()}
              >
                <ArrowUp size={14} />
              </button>
            </Tooltip>
          )}
        </div>
        </div>
      </div>
    </div>
  );
};

export default FloatingMiniChat;
