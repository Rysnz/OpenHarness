import React, { useCallback, useEffect, useState } from 'react';
import LanguageToggleButton from '../components/LanguageToggleButton';
import { useI18n } from '../i18n';
import {
  RecentWorkspaceEntry,
  RemoteSessionManager,
  WorkspaceInfo,
} from '../services/RemoteSessionManager';

interface WorkspacePageProps {
  sessionMgr: RemoteSessionManager;
  onReady: () => void;
}

type Translate = ReturnType<typeof useI18n>['t'];

function BranchIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M5 6V10M11 6V8C11 9.1046 10.1046 10 9 10H5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function FolderIcon(): React.ReactElement {
  return (
    <svg width="40" height="40" viewBox="0 0 16 16" fill="none">
      <path
        d="M2 4V12C2 12.5523 2.44772 13 3 13H13C13.5523 13 14 12.5523 14 12V6C14 5.44772 13.5523 5 13 5H8L6.5 3H3C2.44772 3 2 3.44772 2 4Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function LoadingWorkspace({ t }: { t: Translate }): React.ReactElement {
  return (
    <div className="workspace-page">
      <div className="workspace-page__loading">
        <div className="spinner" />
        <span>{t('workspace.loadingInfo')}</span>
      </div>
    </div>
  );
}

interface CurrentWorkspaceProps {
  info: WorkspaceInfo;
  t: Translate;
  onContinue: () => void;
  onSwitch: () => void;
}

function CurrentWorkspace({ info, t, onContinue, onSwitch }: CurrentWorkspaceProps): React.ReactElement {
  return (
    <div className="workspace-page__current">
      <div className="workspace-page__current-label">{t('workspace.currentWorkspace')}</div>
      <div className="workspace-page__current-card">
        <div className="workspace-page__project-name">
          {info.project_name || t('workspace.unknownProject')}
        </div>
        <div className="workspace-page__project-path">{info.path}</div>
        {info.git_branch && (
          <div className="workspace-page__git-branch">
            <BranchIcon />
            {info.git_branch}
          </div>
        )}
      </div>
      <div className="workspace-page__actions">
        <button className="workspace-page__btn workspace-page__btn--primary" onClick={onContinue}>
          {t('common.continue')}
        </button>
        <button className="workspace-page__btn workspace-page__btn--secondary" onClick={onSwitch}>
          {t('common.switch')}
        </button>
      </div>
    </div>
  );
}

interface EmptyWorkspaceProps {
  t: Translate;
  showRecent: boolean;
  onSelect: () => void;
}

function EmptyWorkspace({ t, showRecent, onSelect }: EmptyWorkspaceProps): React.ReactElement {
  return (
    <div className="workspace-page__no-workspace">
      <div className="workspace-page__no-workspace-icon">
        <FolderIcon />
      </div>
      <div className="workspace-page__no-workspace-text">{t('workspace.noWorkspaceOpen')}</div>
      <div className="workspace-page__no-workspace-hint">{t('workspace.noWorkspaceHint')}</div>
      {!showRecent && (
        <button className="workspace-page__btn workspace-page__btn--primary" onClick={onSelect}>
          {t('workspace.selectWorkspace')}
        </button>
      )}
    </div>
  );
}

interface RecentWorkspaceListProps {
  t: Translate;
  workspaces: RecentWorkspaceEntry[];
  switching: boolean;
  canCancel: boolean;
  onCancel: () => void;
  onSelect: (path: string) => void;
}

function RecentWorkspaceList({
  t,
  workspaces,
  switching,
  canCancel,
  onCancel,
  onSelect,
}: RecentWorkspaceListProps): React.ReactElement {
  return (
    <div className="workspace-page__recent">
      <div className="workspace-page__recent-label">{t('workspace.recentWorkspaces')}</div>
      {workspaces.length === 0 ? (
        <div className="workspace-page__recent-empty">{t('workspace.noRecentWorkspaces')}</div>
      ) : (
        <div className="workspace-page__recent-list">
          {workspaces.map((workspace) => (
            <button
              key={workspace.path}
              className="workspace-page__recent-item"
              onClick={() => onSelect(workspace.path)}
              disabled={switching}
            >
              <div className="workspace-page__recent-item-name">{workspace.name}</div>
              <div className="workspace-page__recent-item-path">{workspace.path}</div>
            </button>
          ))}
        </div>
      )}
      {canCancel && (
        <button className="workspace-page__btn workspace-page__btn--secondary" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      )}
    </div>
  );
}

function SwitchingIndicator({ t }: { t: Translate }): React.ReactElement {
  return (
    <div className="workspace-page__switching">
      <div className="spinner spinner--sm" />
      <span>{t('workspace.openingWorkspace')}</span>
    </div>
  );
}

const WorkspacePage: React.FC<WorkspacePageProps> = ({ sessionMgr, onReady }) => {
  const { t } = useI18n();
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspaceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);

  const loadWorkspaceInfo = useCallback(async () => {
    try {
      setWorkspaceInfo(await sessionMgr.getWorkspaceInfo());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionMgr]);

  const loadRecentWorkspaces = useCallback(async () => {
    try {
      setRecentWorkspaces(await sessionMgr.listRecentWorkspaces());
    } catch (e: any) {
      setError(e.message);
    }
  }, [sessionMgr]);

  useEffect(() => {
    loadWorkspaceInfo();
  }, [loadWorkspaceInfo]);

  const handleShowRecent = async () => {
    setShowRecent(true);
    await loadRecentWorkspaces();
  };

  const handleSelectWorkspace = useCallback(async (path: string) => {
    if (switching) return;
    setSwitching(true);
    setError(null);
    try {
      const result = await sessionMgr.setWorkspace(path);
      if (result.success) {
        await loadWorkspaceInfo();
        setShowRecent(false);
      } else {
        setError(result.error || t('workspace.failedToSetWorkspace'));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSwitching(false);
    }
  }, [loadWorkspaceInfo, sessionMgr, switching, t]);

  if (loading) {
    return <LoadingWorkspace t={t} />;
  }

  const hasWorkspace = Boolean(workspaceInfo?.has_workspace);

  return (
    <div className="workspace-page">
      <div className="workspace-page__header">
        <h1>{t('workspace.title')}</h1>
        <LanguageToggleButton />
      </div>

      <div className="workspace-page__content">
        {hasWorkspace && workspaceInfo ? (
          <CurrentWorkspace
            info={workspaceInfo}
            t={t}
            onContinue={onReady}
            onSwitch={handleShowRecent}
          />
        ) : (
          <EmptyWorkspace t={t} showRecent={showRecent} onSelect={handleShowRecent} />
        )}

        {showRecent && (
          <RecentWorkspaceList
            t={t}
            workspaces={recentWorkspaces}
            switching={switching}
            canCancel={hasWorkspace}
            onCancel={() => setShowRecent(false)}
            onSelect={handleSelectWorkspace}
          />
        )}

        {switching && <SwitchingIndicator t={t} />}
        {error && <div className="workspace-page__error">{error}</div>}
      </div>
    </div>
  );
};

export default WorkspacePage;
