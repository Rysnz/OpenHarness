/**
 * ContentCanvas main container component.
 * Core component for the right panel, aggregating submodules.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { EditorArea } from './editor-area';
import { AnchorZone } from './anchor-zone';
import { MissionControl } from './mission-control';
import { EmptyState } from './empty-state';
import { useCanvasStore } from './stores';
import { useTabLifecycle, useKeyboardShortcuts, usePanelTabCoordinator } from './hooks';
import type { AnchorPosition } from './types';
import { openMainSession, selectActiveBtwSessionTab } from '@/flow_chat/services/openBtwSession';
import './ContentCanvas.scss';

type BtwSessionData = { childSessionId: string; parentSessionId: string; workspacePath?: string };

export interface ContentCanvasProps {
  /** Workspace path */
  workspacePath?: string;
  /** App mode */
  mode?: 'agent' | 'project' | 'git';
  /** Whether the containing scene is currently visible */
  isSceneActive?: boolean;
  /** Interaction callback */
  onInteraction?: (itemId: string, userInput: string) => Promise<void>;
  /** Before-close callback */
  onBeforeClose?: (content: any) => Promise<boolean>;
  /** Disable pop-out and panel-close controls (used in panel-view scene) */
  disablePopOut?: boolean;
}

function useBtwSessionSync(mode: NonNullable<ContentCanvasProps['mode']>): void {
  const activeBtwSessionTab = useCanvasStore(state => selectActiveBtwSessionTab(state as any));
  const activeBtwSessionData = activeBtwSessionTab?.content.data as BtwSessionData | undefined;
  const lastSyncedBtwTabIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (mode !== 'agent' || !activeBtwSessionTab?.id || !activeBtwSessionData?.parentSessionId) {
      lastSyncedBtwTabIdRef.current = null;
      return;
    }

    if (lastSyncedBtwTabIdRef.current === activeBtwSessionTab.id) {
      return;
    }

    lastSyncedBtwTabIdRef.current = activeBtwSessionTab.id;
    void openMainSession(activeBtwSessionData.parentSessionId);
  }, [activeBtwSessionData?.parentSessionId, activeBtwSessionTab?.id, mode]);
}

function hasVisibleTabs(tabs: Array<{ isHidden?: boolean }>): boolean {
  return tabs.some((tab) => !tab.isHidden);
}

export const ContentCanvas: React.FC<ContentCanvasProps> = ({
  workspacePath,
  mode = 'agent',
  isSceneActive = true,
  onInteraction,
  disablePopOut = false,
}) => {
  // Store state
  const {
    primaryGroup,
    layout,
    isMissionControlOpen,
    setAnchorPosition,
    setAnchorSize,
    closeMissionControl,
    openMissionControl,
  } = useCanvasStore();
  useBtwSessionSync(mode);

  const { handleCloseWithDirtyCheck, handleCloseAllWithDirtyCheck } = useTabLifecycle({ mode });
  useKeyboardShortcuts({ enabled: true, handleCloseWithDirtyCheck });
  const { collapsePanel } = usePanelTabCoordinator({
    autoCollapseOnEmpty: true,
    autoExpandOnTabOpen: true,
  });

  const hasPrimaryVisibleTabs = useMemo(() => hasVisibleTabs(primaryGroup.tabs), [primaryGroup.tabs]);

  const handleAnchorClose = useCallback(() => {
    setAnchorPosition('hidden');
  }, [setAnchorPosition]);

  const handleAnchorPositionChange = useCallback((position: AnchorPosition) => {
    setAnchorPosition(position);
  }, [setAnchorPosition]);

  const handleAnchorSizeChange = useCallback((size: number) => {
    setAnchorSize(size);
  }, [setAnchorSize]);

  const handleOpenMissionControl = useCallback(() => {
    openMissionControl();
  }, [openMissionControl]);

  const handleCloseMissionControl = useCallback(() => {
    closeMissionControl();
  }, [closeMissionControl]);

  const renderContent = () => {
    if (!hasPrimaryVisibleTabs) {
      return <EmptyState onClose={disablePopOut ? undefined : collapsePanel} />;
    }

    return (
      <div className="canvas-content-canvas__main">
        <div className="canvas-content-canvas__editor">
          <EditorArea
            workspacePath={workspacePath}
            isSceneActive={isSceneActive}
            onOpenMissionControl={handleOpenMissionControl}
            onInteraction={onInteraction}
            onTabCloseWithDirtyCheck={handleCloseWithDirtyCheck}
            onTabCloseAllWithDirtyCheck={handleCloseAllWithDirtyCheck}
            disablePopOut={disablePopOut}
          />
        </div>

        {layout.anchorPosition !== 'hidden' && (
          <AnchorZone
            position={layout.anchorPosition}
            size={layout.anchorSize}
            onSizeChange={handleAnchorSizeChange}
            onPositionChange={handleAnchorPositionChange}
            onClose={handleAnchorClose}
          >
            <div className="canvas-content-canvas__anchor-content">
            </div>
          </AnchorZone>
        )}
      </div>
    );
  };

  return (
    <div
      className={`canvas-content-canvas ${layout.isMaximized ? 'is-maximized' : ''}`}
      data-shortcut-scope="canvas"
    >
      {renderContent()}

      <MissionControl
        isOpen={isMissionControlOpen}
        onClose={handleCloseMissionControl}
        handleCloseWithDirtyCheck={handleCloseWithDirtyCheck}
      />
    </div>
  );
};
ContentCanvas.displayName = 'ContentCanvas';

export default ContentCanvas;
