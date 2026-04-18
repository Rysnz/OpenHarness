import React, { Suspense, lazy, useMemo, useEffect } from 'react';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { WorkspaceKind } from '@/shared/types';
import { ProcessingIndicator } from '@/flow_chat/components/modern/ProcessingIndicator';
import { useMyAgentStore } from '../my-agent/myAgentStore';
import './PartnerScene.scss';

const ProfileScene = lazy(() => import('../profile/ProfileScene'));

interface PartnerSceneProps {
  workspacePath?: string;
}

const PartnerScene: React.FC<PartnerSceneProps> = ({ workspacePath }) => {
  const { t } = useI18n('common');
  const selectedPartnerWorkspaceId = useMyAgentStore((s) => s.selectedPartnerWorkspaceId);
  const setSelectedPartnerWorkspaceId = useMyAgentStore((s) => s.setSelectedPartnerWorkspaceId);
  const { currentWorkspace, partnerWorkspacesList } = useWorkspaceContext();
  const activePartnerWorkspace =
    currentWorkspace?.workspaceKind === WorkspaceKind.Partner ? currentWorkspace : null;

  const defaultPartnerWorkspace = useMemo(
    () => partnerWorkspacesList.find((workspace) => !workspace.partnerId) ?? partnerWorkspacesList[0] ?? null,
    [partnerWorkspacesList]
  );

  const selectedPartnerWorkspace = useMemo(() => {
    if (!selectedPartnerWorkspaceId) {
      return null;
    }
    return partnerWorkspacesList.find((workspace) => workspace.id === selectedPartnerWorkspaceId) ?? null;
  }, [partnerWorkspacesList, selectedPartnerWorkspaceId]);

  const resolvedPartnerWorkspace = useMemo(() => {
    if (activePartnerWorkspace) {
      return activePartnerWorkspace;
    }
    if (selectedPartnerWorkspace) {
      return selectedPartnerWorkspace;
    }
    return defaultPartnerWorkspace;
  }, [activePartnerWorkspace, defaultPartnerWorkspace, selectedPartnerWorkspace]);

  useEffect(() => {
    if (activePartnerWorkspace?.id && activePartnerWorkspace.id !== selectedPartnerWorkspaceId) {
      setSelectedPartnerWorkspaceId(activePartnerWorkspace.id);
    }
  }, [activePartnerWorkspace, selectedPartnerWorkspaceId, setSelectedPartnerWorkspaceId]);

  useEffect(() => {
    const selectedExists = selectedPartnerWorkspaceId
      ? partnerWorkspacesList.some((workspace) => workspace.id === selectedPartnerWorkspaceId)
      : false;

    if (activePartnerWorkspace?.id) {
      return;
    }

    if (!selectedExists && resolvedPartnerWorkspace?.id !== selectedPartnerWorkspaceId) {
      setSelectedPartnerWorkspaceId(resolvedPartnerWorkspace?.id ?? null);
    }
  }, [
    activePartnerWorkspace,
    partnerWorkspacesList,
    resolvedPartnerWorkspace,
    selectedPartnerWorkspaceId,
    setSelectedPartnerWorkspaceId,
  ]);

  return (
    <div className="openharness-partner-scene">
      <Suspense
        fallback={(
          <div
            className="openharness-partner-scene__loading"
            role="status"
            aria-busy="true"
            aria-label={t('loading.scenes')}
          >
            <ProcessingIndicator visible />
          </div>
        )}
      >
        <ProfileScene
          key={resolvedPartnerWorkspace?.id ?? 'default-partner-workspace'}
          workspacePath={resolvedPartnerWorkspace?.rootPath ?? workspacePath}
        />
      </Suspense>
    </div>
  );
};

export default PartnerScene;
