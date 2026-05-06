import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useCurrentWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { gitService } from '@/tools/git/services/GitService';
import { createLogger } from '@/shared/utils/logger';
import './ChatEmptyState.scss';

const log = createLogger('ChatEmptyState');

interface WorkspaceLineProps {
  workspaceName: string;
  branch?: string;
  t: TFunction<'flow-chat'>;
}

const WorkspaceLine: React.FC<WorkspaceLineProps> = ({ workspaceName, branch, t }) => (
  <p>
    <Trans
      i18nKey={branch ? 'emptyState.workingInWithBranch' : 'emptyState.workingIn'}
      t={t}
      values={{ workspace: workspaceName, branch }}
      components={{
        workspace: <span className="fc-chat-empty__workspace-name" />,
        branch: <span className="fc-chat-empty__branch-name" />
      }}
    />
  </p>
);

export const ChatEmptyState: React.FC = () => {
  const { t } = useTranslation('flow-chat');
  const { workspace: currentWorkspace } = useCurrentWorkspace();
  const [currentBranch, setCurrentBranch] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadGitInfo = async () => {
      setLoading(true);

      if (!currentWorkspace?.rootPath) {
        setCurrentBranch('');
        setLoading(false);
        return;
      }

      try {
        const status = await gitService.getStatus(currentWorkspace.rootPath);
        if (status) {
          setCurrentBranch(status.current_branch || '');
        }
      } catch (error) {
        log.debug('Failed to get Git info', error);
      } finally {
        setLoading(false);
      }
    };

    loadGitInfo();
  }, [currentWorkspace]);

  return (
    <div className="fc-chat-empty">
      <div className="fc-chat-empty__container">
        {!loading && currentWorkspace && (
          <>
            <div className="fc-chat-empty__greeting">
              <p>{t('emptyState.welcomeBack')}</p>
              <WorkspaceLine
                workspaceName={currentWorkspace.name}
                branch={currentBranch || undefined}
                t={t}
              />
            </div>

            <div className="fc-chat-empty__divider" />

            <div className="fc-chat-empty__prompt">
              <p>{t('emptyState.capabilities')}</p>
              <p>{t('emptyState.capabilities2')}</p>
              <p className="fc-chat-empty__prompt-hint">{t('emptyState.readyToHelp')}</p>
            </div>
          </>
        )}

        {!loading && !currentWorkspace && (
          <div className="fc-chat-empty__no-workspace">
            <p>{t('emptyState.noWorkspace')}</p>
            <p className="fc-chat-empty__hint">{t('emptyState.openProject')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

