import React, { useState, useCallback, useMemo } from 'react';
import { FolderOpen, Clock, FolderPlus, Trash2 } from 'lucide-react';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { useSceneStore } from '@/app/stores/sceneStore';
import { useI18n } from '@/infrastructure/i18n';
import { OpenHarnessLogo, Tooltip } from '@/component-library';
import { createLogger } from '@/shared/utils/logger';
import type { SceneTabId } from '@/app/components/SceneBar/types';
import type { WorkspaceInfo } from '@/shared/types';
import { getRecentWorkspaceLineParts } from '@/shared/utils/recentWorkspaceDisplay';
import './WelcomeScene.scss';

const log = createLogger('WelcomeScene');
const MAX_RECENT_WORKSPACES = 5;
const WELCOME_MESSAGE_COUNT = 4;
const DAY_MS = 1000 * 60 * 60 * 24;

type DateFormatter = (dateString: string) => string;

interface RecentWorkspaceRowProps {
  workspace: WorkspaceInfo;
  formatDate: DateFormatter;
  onSwitch: (workspace: WorkspaceInfo) => void;
  onRemove: (workspaceId: string) => void;
  removeLabel: string;
}

const buildWelcomeMessages = (t: (key: string, options?: any) => string): string[] => (
  Array.from({ length: WELCOME_MESSAGE_COUNT }, (_, index) => (
    t(`welcomeScene.messages.message${index + 1}`)
  ))
);

const getRelativeWorkspaceDate = (
  dateString: string,
  t: (key: string, options?: any) => string
): string => {
  try {
    const date = new Date(dateString);
    const diffDays = Math.ceil(Math.abs(Date.now() - date.getTime()) / DAY_MS);

    if (diffDays <= 1) return t('time.yesterday');
    if (diffDays < 7) return t('startup.daysAgo', { count: diffDays });
    if (diffDays < 30) return t('startup.weeksAgo', { count: Math.ceil(diffDays / 7) });

    return date.toLocaleDateString();
  } catch {
    return '';
  }
};

const RecentWorkspaceRow: React.FC<RecentWorkspaceRowProps> = ({
  workspace,
  formatDate,
  onSwitch,
  onRemove,
  removeLabel
}) => {
  const { hostPrefix, folderLabel, tooltip } = getRecentWorkspaceLineParts(workspace);

  return (
    <div className="welcome-scene__recent-row">
      <Tooltip content={tooltip} placement="right" followCursor>
        <button
          type="button"
          className="welcome-scene__recent-item"
          onClick={() => onSwitch(workspace)}
        >
          <FolderOpen size={13} />
          <span className="welcome-scene__recent-name">
            {hostPrefix ? (
              <>
                <span className="welcome-scene__recent-host">{hostPrefix}</span>
                <span className="welcome-scene__recent-host-sep" aria-hidden>
                  {' - '}
                </span>
              </>
            ) : null}
            {folderLabel}
          </span>
        </button>
      </Tooltip>
      <button
        type="button"
        className="welcome-scene__recent-time-btn"
        title={removeLabel}
        aria-label={removeLabel}
        onClick={() => onRemove(workspace.id)}
      >
        <span className="welcome-scene__recent-time-btn__label">
          {formatDate(workspace.lastAccessed)}
        </span>
        <span className="welcome-scene__recent-time-btn__icon" aria-hidden>
          <Trash2 size={15} strokeWidth={2} />
        </span>
      </button>
    </div>
  );
};

const WelcomeScene: React.FC = () => {
  const { t } = useI18n('common');
  const {
    hasWorkspace,
    currentWorkspace,
    recentWorkspaces,
    openWorkspace,
    switchWorkspace,
    removeWorkspaceFromRecent,
  } = useWorkspaceContext();
  const openScene = useSceneStore((state) => state.openScene);
  const [isSelecting, setIsSelecting] = useState(false);
  const [welcomeMessageIndex] = useState(() => Math.floor(Math.random() * WELCOME_MESSAGE_COUNT));

  const welcomeMessages = useMemo(() => buildWelcomeMessages(t), [t]);
  const welcomeMessage = welcomeMessages[welcomeMessageIndex % welcomeMessages.length];
  const recentWorkspaceItems = useMemo(() => {
    const source = hasWorkspace
      ? recentWorkspaces.filter((workspace) => workspace.id !== currentWorkspace?.id)
      : recentWorkspaces;

    return source.slice(0, MAX_RECENT_WORKSPACES);
  }, [currentWorkspace?.id, hasWorkspace, recentWorkspaces]);

  const openSessionScene = useCallback(() => {
    openScene('session' as SceneTabId);
  }, [openScene]);

  const handleOpenFolder = useCallback(async () => {
    try {
      setIsSelecting(true);
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('startup.selectWorkspaceDirectory'),
      });

      if (selected && typeof selected === 'string') {
        await openWorkspace(selected);
        openSessionScene();
      }
    } catch (error) {
      log.error('Failed to open folder', error);
    } finally {
      setIsSelecting(false);
    }
  }, [openWorkspace, openSessionScene, t]);

  const handleNewProject = useCallback(() => {
    window.dispatchEvent(new Event('nav:new-project'));
  }, []);

  const handleSwitchWorkspace = useCallback((workspace: WorkspaceInfo) => {
    void (async () => {
      try {
        await switchWorkspace(workspace);
        openSessionScene();
      } catch (error) {
        log.error('Failed to switch workspace', error);
      }
    })();
  }, [switchWorkspace, openSessionScene]);

  const handleRemoveFromRecent = useCallback((workspaceId: string) => {
    void removeWorkspaceFromRecent(workspaceId).catch((error) => {
      log.error('Failed to remove workspace from recent', error);
    });
  }, [removeWorkspaceFromRecent]);

  const formatDate = useCallback<DateFormatter>(
    (dateString) => getRelativeWorkspaceDate(dateString, t),
    [t]
  );

  return (
    <div className="welcome-scene">
      <div className="welcome-scene__content">
        <div className="welcome-scene__greeting">
          <div className="welcome-scene__brand-mark" aria-hidden="true">
            <OpenHarnessLogo size={42} animated={false} variant="compact" status="resolved" />
          </div>
          <h1 className="welcome-scene__title">{t('welcomeScene.firstTime.title')}</h1>
          <p className="welcome-scene__greeting-label">{welcomeMessage}</p>
        </div>

        <div className="welcome-scene__divider" />

        <section className="welcome-scene__switch">
          <div className="welcome-scene__switch-header">
            <span className="welcome-scene__section-label">
              <Clock size={12} />
              {t('welcomeScene.recentWorkspaces')}
            </span>
            <div className="welcome-scene__switch-actions">
              <button
                className="welcome-scene__link-btn"
                onClick={() => void handleOpenFolder()}
                disabled={isSelecting}
              >
                <FolderOpen size={12} />
                {t('welcomeScene.openOtherProject')}
              </button>
              <button className="welcome-scene__link-btn" onClick={handleNewProject}>
                <FolderPlus size={12} />
                {t('welcomeScene.newProject')}
              </button>
            </div>
          </div>

          {recentWorkspaceItems.length > 0 ? (
            <div className="welcome-scene__recent-list">
              {recentWorkspaceItems.map((workspace) => (
                <RecentWorkspaceRow
                  key={workspace.id}
                  workspace={workspace}
                  formatDate={formatDate}
                  onSwitch={handleSwitchWorkspace}
                  onRemove={handleRemoveFromRecent}
                  removeLabel={t('welcomeScene.removeFromRecent')}
                />
              ))}
            </div>
          ) : (
            <p className="welcome-scene__no-recent">{t('welcomeScene.noRecentWorkspaces')}</p>
          )}
        </section>
      </div>
    </div>
  );
};

export default WelcomeScene;
