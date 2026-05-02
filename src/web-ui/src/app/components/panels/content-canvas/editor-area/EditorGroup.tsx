/**
 * EditorGroup component.
 * A single editor group with tab bar and content area.
 */

import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { TabBar } from '../tab-bar';
import { DropZone } from './DropZone';
import FlexiblePanel from '../../base/FlexiblePanel';
import { usePanelViewCanvasStore } from '../stores';
import { useSceneStore } from '../../../../stores/sceneStore';
import type { 
  EditorGroupId, 
  EditorGroupState, 
  CanvasTab,
  TabDragPayload,
  DropPosition,
  PanelContent,
  SplitMode,
} from '../types';
import './EditorGroup.scss';

const MAX_WARM_TABS = 5;

export interface EditorGroupProps {
  groupId: EditorGroupId;
  group: EditorGroupState;
  isActive: boolean;
  isSceneActive?: boolean;
  draggingTabId: string | null;
  draggingFromGroupId: EditorGroupId | null;
  splitMode: SplitMode;
  workspacePath?: string;
  onTabClick: (tabId: string) => void;
  onTabDoubleClick: (tabId: string) => void;
  onTabClose: (tabId: string) => Promise<void> | void;
  onTabPin: (tabId: string) => void;
  onDragStart: (payload: TabDragPayload) => void;
  onDragEnd: () => void;
  onReorderTab: (tabId: string, newIndex: number) => void;
  onDrop: (position: DropPosition) => void;
  onGroupFocus: () => void;
  onContentChange: (tabId: string, content: PanelContent) => void;
  onDirtyStateChange: (tabId: string, isDirty: boolean) => void;
  onTabFileDeletedFromDiskChange?: (tabId: string, missing: boolean) => void;
  onOpenMissionControl?: () => void;
  onCloseAllTabs?: () => Promise<void> | void;
  onInteraction?: (itemId: string, userInput: string) => Promise<void>;
  disablePopOut?: boolean;
}

function getVisibleTabs(tabs: EditorGroupState['tabs']): EditorGroupState['tabs'] {
  return tabs.filter((tab) => !tab.isHidden);
}

function getRecentlyAccessedTabs(
  tabs: EditorGroupState['tabs'],
  activeTabId: string | null
): string[] {
  return tabs
    .filter((tab) => !tab.isHidden && tab.id !== activeTabId)
    .sort((a, b) => (b.lastAccessedAt || 0) - (a.lastAccessedAt || 0))
    .slice(0, MAX_WARM_TABS - 1)
    .map((tab) => tab.id);
}

function useWarmTabs(group: EditorGroupState): EditorGroupState['tabs'] {
  const warmTabIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const visibleIds = new Set(getVisibleTabs(group.tabs).map((tab) => tab.id));
    warmTabIdsRef.current = new Set([...warmTabIdsRef.current].filter((id) => visibleIds.has(id)));

    if (!group.activeTabId || !visibleIds.has(group.activeTabId)) {
      return;
    }

    warmTabIdsRef.current.add(group.activeTabId);

    if (warmTabIdsRef.current.size > MAX_WARM_TABS) {
      warmTabIdsRef.current = new Set([
        group.activeTabId,
        ...getRecentlyAccessedTabs(group.tabs, group.activeTabId),
      ]);
    }
  }, [group.activeTabId, group.tabs]);

  return useMemo(
    () =>
      getVisibleTabs(group.tabs).filter(
        (tab) => tab.id === group.activeTabId || warmTabIdsRef.current.has(tab.id)
      ),
    [group.activeTabId, group.tabs]
  );
}

export const EditorGroup: React.FC<EditorGroupProps> = ({
  groupId,
  group,
  isActive,
  isSceneActive = true,
  draggingTabId,
  draggingFromGroupId,
  splitMode,
  workspacePath,
  onTabClick,
  onTabDoubleClick,
  onTabClose,
  onTabPin,
  onDragStart,
  onDragEnd,
  onReorderTab,
  onDrop,
  onGroupFocus,
  onContentChange,
  onDirtyStateChange,
  onTabFileDeletedFromDiskChange,
  onOpenMissionControl,
  onCloseAllTabs,
  onInteraction,
  disablePopOut = false,
}) => {
  const { t } = useTranslation('components');
  const visibleTabs = useMemo(() => getVisibleTabs(group.tabs), [group.tabs]);
  const tabsToRender = useWarmTabs(group);

  const handleContentChange = useCallback((content: PanelContent | null) => {
    if (content && group.activeTabId) {
      onContentChange(group.activeTabId, content);
    }
  }, [group.activeTabId, onContentChange]);

  const handleDirtyStateChange = useCallback((isDirty: boolean) => {
    if (group.activeTabId) {
      onDirtyStateChange(group.activeTabId, isDirty);
    }
  }, [group.activeTabId, onDirtyStateChange]);

  const handleTabPopOut = useCallback((tabId: string) => {
    const tab = group.tabs.find((item) => item.id === tabId);
    if (!tab || !tab.content) return;
    usePanelViewCanvasStore.getState().addTab(tab.content as PanelContent, 'active');
    useSceneStore.getState().openScene('panel-view');
  }, [group.tabs]);

  const isDragging = draggingTabId !== null;

  const renderTabContent = (tab: CanvasTab) => {
    const isCurrentTab = group.activeTabId === tab.id;
    const handleFileMissing = onTabFileDeletedFromDiskChange
      ? (missing: boolean) => onTabFileDeletedFromDiskChange(tab.id, missing)
      : undefined;

    return (
      <div
        key={tab.id}
        className="canvas-editor-group__tab-content"
        style={{ display: isCurrentTab ? 'flex' : 'none' }}
      >
        <FlexiblePanel
          content={tab.content as any}
          isActive={isSceneActive && isCurrentTab}
          onContentChange={isCurrentTab ? handleContentChange : undefined}
          onDirtyStateChange={isCurrentTab ? handleDirtyStateChange : undefined}
          onFileMissingFromDiskChange={handleFileMissing}
          onInteraction={onInteraction}
          workspacePath={workspacePath}
        />
      </div>
    );
  };

  const renderEditorContent = () => {
    if (tabsToRender.length > 0) {
      return tabsToRender.map(renderTabContent);
    }

    if (visibleTabs.length > 0) {
      return null;
    }

    return (
      <div className="canvas-editor-group__empty">
        <div className="canvas-editor-group__empty-content">
          <span>{t('canvas.dragTabHere')}</span>
        </div>
      </div>
    );
  };

  return (
    <div
      className={`canvas-editor-group ${isActive ? 'is-active' : ''}`}
      onClick={onGroupFocus}
    >
      {/* Tab bar */}
      <TabBar
        tabs={group.tabs}
        groupId={groupId}
        activeTabId={group.activeTabId}
        isActiveGroup={isActive}
        onTabClick={onTabClick}
        onTabDoubleClick={onTabDoubleClick}
        onTabClose={onTabClose}
        onTabPin={onTabPin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        draggingTabId={draggingTabId}
        onReorderTab={onReorderTab}
        onOpenMissionControl={onOpenMissionControl}
        onCloseAllTabs={onCloseAllTabs}
        onTabPopOut={disablePopOut ? undefined : handleTabPopOut}
      />

      <DropZone
        groupId={groupId}
        isDragging={isDragging}
        draggingFromGroupId={draggingFromGroupId}
        splitMode={splitMode}
        onDrop={onDrop}
      >
        <div className="canvas-editor-group__content">
          {renderEditorContent()}
        </div>
      </DropZone>
    </div>
  );
};

EditorGroup.displayName = 'EditorGroup';

export default EditorGroup;
