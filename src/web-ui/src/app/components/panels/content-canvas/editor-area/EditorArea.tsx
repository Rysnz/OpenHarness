import React, { useRef, useCallback } from 'react';
import { EditorGroup } from './EditorGroup';
import { SplitHandle } from './SplitHandle';
import { useCanvasStore } from '../stores';
import type { 
  EditorGroupId, 
  TabDragPayload, 
  DropPosition,
  PanelContent,
} from '../types';
import './EditorArea.scss';

type EditorPaneName = 'primary' | 'secondary' | 'tertiary';

export interface EditorAreaProps {
  workspacePath?: string;
  isSceneActive?: boolean;
  onOpenMissionControl?: () => void;
  onInteraction?: (itemId: string, userInput: string) => Promise<void>;
  onTabCloseWithDirtyCheck?: (tabId: string, groupId: EditorGroupId) => Promise<boolean>;
  onTabCloseAllWithDirtyCheck?: (groupId: EditorGroupId) => Promise<boolean>;
  disablePopOut?: boolean;
}

export const EditorArea: React.FC<EditorAreaProps> = ({
  workspacePath,
  isSceneActive = true,
  onOpenMissionControl,
  onInteraction,
  onTabCloseWithDirtyCheck,
  onTabCloseAllWithDirtyCheck,
  disablePopOut = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const topRowRef = useRef<HTMLDivElement>(null);

  const {
    primaryGroup,
    secondaryGroup,
    tertiaryGroup,
    activeGroupId,
    layout,
    draggingTabId,
    draggingFromGroupId,
    switchToTab,
    closeTab,
    closeAllTabs,
    promoteTab,
    togglePinTab,
    startDrag,
    endDrag,
    reorderTab,
    handleDrop,
    setSplitRatio,
    setSplitRatio2,
    setActiveGroup,
    updateTabContent,
    setTabDirty,
    setTabFileDeletedFromDisk,
  } = useCanvasStore();

  const handleTabClick = useCallback((groupId: EditorGroupId) => (tabId: string) => {
    switchToTab(tabId, groupId);
  }, [switchToTab]);

  const handleTabDoubleClick = useCallback((groupId: EditorGroupId) => (tabId: string) => {
    promoteTab(tabId, groupId);
  }, [promoteTab]);

  const handleTabClose = useCallback((groupId: EditorGroupId) => async (tabId: string) => {
    if (onTabCloseWithDirtyCheck) {
      await onTabCloseWithDirtyCheck(tabId, groupId);
      return;
    }
    closeTab(tabId, groupId);
  }, [closeTab, onTabCloseWithDirtyCheck]);

  const handleCloseAllTabs = useCallback((groupId: EditorGroupId) => async () => {
    if (onTabCloseAllWithDirtyCheck) {
      await onTabCloseAllWithDirtyCheck(groupId);
      return;
    }
    closeAllTabs(groupId);
  }, [closeAllTabs, onTabCloseAllWithDirtyCheck]);

  const handleTabPin = useCallback((groupId: EditorGroupId) => (tabId: string) => {
    togglePinTab(tabId, groupId);
  }, [togglePinTab]);

  const handleDragStart = useCallback((payload: TabDragPayload) => {
    startDrag(payload.tabId, payload.sourceGroupId);
  }, [startDrag]);

  const handleDragEnd = useCallback(() => {
    endDrag();
  }, [endDrag]);

  const handleReorderTab = useCallback((groupId: EditorGroupId) => (tabId: string, newIndex: number) => {
    reorderTab(tabId, groupId, newIndex);
  }, [reorderTab]);

  const handleDropOnGroup = useCallback((groupId: EditorGroupId) => (position: DropPosition) => {
    if (draggingTabId && draggingFromGroupId) {
      handleDrop(draggingTabId, draggingFromGroupId, groupId, position);
      endDrag();
    }
  }, [draggingTabId, draggingFromGroupId, handleDrop, endDrag]);

  const handleGroupFocus = useCallback((groupId: EditorGroupId) => () => {
    setActiveGroup(groupId);
  }, [setActiveGroup]);

  const handleContentChange = useCallback((groupId: EditorGroupId) => (tabId: string, content: PanelContent) => {
    updateTabContent(tabId, groupId, content);
  }, [updateTabContent]);

  const handleDirtyStateChange = useCallback((groupId: EditorGroupId) => (tabId: string, isDirty: boolean) => {
    setTabDirty(tabId, groupId, isDirty);
  }, [setTabDirty]);

  const handleTabFileDeletedFromDiskChange = useCallback(
    (groupId: EditorGroupId) => (tabId: string, missing: boolean) => {
      setTabFileDeletedFromDisk(tabId, groupId, missing);
    },
    [setTabFileDeletedFromDisk]
  );

  const renderEditorGroup = (groupId: EditorGroupId, group: typeof primaryGroup) => (
    <EditorGroup
      groupId={groupId}
      group={group}
      isActive={activeGroupId === groupId}
      isSceneActive={isSceneActive}
      draggingTabId={draggingTabId}
      draggingFromGroupId={draggingFromGroupId}
      splitMode={layout.splitMode}
      workspacePath={workspacePath}
      onTabClick={handleTabClick(groupId)}
      onTabDoubleClick={handleTabDoubleClick(groupId)}
      onTabClose={handleTabClose(groupId)}
      onTabPin={handleTabPin(groupId)}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onReorderTab={handleReorderTab(groupId)}
      onDrop={handleDropOnGroup(groupId)}
      onGroupFocus={handleGroupFocus(groupId)}
      onContentChange={handleContentChange(groupId)}
      onDirtyStateChange={handleDirtyStateChange(groupId)}
      onTabFileDeletedFromDiskChange={handleTabFileDeletedFromDiskChange(groupId)}
      onOpenMissionControl={groupId === 'primary' ? onOpenMissionControl : undefined}
      onCloseAllTabs={handleCloseAllTabs(groupId)}
      onInteraction={onInteraction}
      disablePopOut={disablePopOut}
    />
  );

  const { splitMode, splitRatio, splitRatio2 } = layout;

  const renderPane = (
    pane: EditorPaneName,
    group: typeof primaryGroup,
    style?: React.CSSProperties
  ) => (
    <div className={`canvas-editor-area__${pane}`} style={style}>
      {renderEditorGroup(pane, group)}
    </div>
  );

  const renderSplitHandle = (
    direction: 'horizontal' | 'vertical',
    ratio: number,
    onRatioChange: (ratio: number) => void,
    ref: React.RefObject<HTMLDivElement>
  ) => (
    <SplitHandle
      direction={direction}
      ratio={ratio}
      onRatioChange={onRatioChange}
      containerRef={ref}
    />
  );

  switch (splitMode) {
    case 'none':
      return (
        <div ref={containerRef} className="canvas-editor-area">
          {renderPane('primary', primaryGroup)}
        </div>
      );

    case 'horizontal':
      return (
        <div ref={containerRef} className="canvas-editor-area is-split is-horizontal">
          {renderPane('primary', primaryGroup, { width: `${splitRatio * 100}%` })}
          {renderSplitHandle('horizontal', splitRatio, setSplitRatio, containerRef)}
          {renderPane('secondary', secondaryGroup, { width: `${(1 - splitRatio) * 100}%` })}
        </div>
      );

    case 'vertical':
      return (
        <div ref={containerRef} className="canvas-editor-area is-split is-vertical">
          {renderPane('primary', primaryGroup, { height: `${splitRatio * 100}%` })}
          {renderSplitHandle('vertical', splitRatio, setSplitRatio, containerRef)}
          {renderPane('secondary', secondaryGroup, { height: `${(1 - splitRatio) * 100}%` })}
        </div>
      );

    case 'grid':
      return (
        <div ref={containerRef} className="canvas-editor-area is-grid">
          <div
            ref={topRowRef}
            className="canvas-editor-area__top-row"
            style={{ flex: `0 0 calc(${splitRatio * 100}% - 2px)` }}
          >
            {renderPane('primary', primaryGroup, {
              flex: `0 0 calc(${splitRatio2 * 100}% - 2px)`,
            })}
            {renderSplitHandle('horizontal', splitRatio2, setSplitRatio2, topRowRef)}
            {renderPane('secondary', secondaryGroup, { flex: 1, minWidth: 0 })}
          </div>
          {renderSplitHandle('vertical', splitRatio, setSplitRatio, containerRef)}
          {renderPane('tertiary', tertiaryGroup, { flex: 1, minHeight: 0 })}
        </div>
      );

    default:
      return null;
  }
};

EditorArea.displayName = 'EditorArea';

export default EditorArea;
