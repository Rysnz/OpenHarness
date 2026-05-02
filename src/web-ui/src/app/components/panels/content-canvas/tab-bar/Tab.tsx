import React, { useCallback, useState } from 'react';
import { ExternalLink, Pin, Split, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/component-library';
import type { CanvasTab, EditorGroupId, TabState } from '../types';
import './Tab.scss';

const UNSAVED_MARK = '\u2022';
const MIDDLE_CLICK_CONTROL_SELECTOR = '.canvas-tab__pin-icon, .canvas-tab__popout-btn';

export interface TabProps {
  tab: CanvasTab;
  groupId: EditorGroupId;
  isActive: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onClose: () => Promise<void> | void;
  onPin: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  isDragging?: boolean;
  onPopOut?: () => void;
}

function getStateClassName(state: TabState): string {
  switch (state) {
    case 'preview':
      return 'is-preview';
    case 'pinned':
      return 'is-pinned';
    default:
      return '';
  }
}

function buildTabClassName(tab: CanvasTab, isActive: boolean, isDragging: boolean): string {
  return [
    'canvas-tab',
    isActive && 'is-active',
    tab.isDirty && 'is-dirty',
    tab.fileDeletedFromDisk && 'is-file-deleted',
    isDragging && 'is-dragging',
    getStateClassName(tab.state),
    tab.content.type === 'task-detail' && 'is-task-detail',
  ].filter(Boolean).join(' ');
}

function createDragPayload(tab: CanvasTab, groupId: EditorGroupId): string {
  return JSON.stringify({
    tabId: tab.id,
    sourceGroupId: groupId,
  });
}

function shouldSkipMiddleClick(e: React.MouseEvent, isPinned: boolean): boolean {
  if (e.button !== 1 || isPinned) {
    return true;
  }

  return Boolean((e.target as HTMLElement).closest(MIDDLE_CLICK_CONTROL_SELECTOR));
}

interface IconButtonProps {
  className: string;
  tooltip: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}

function IconButton({ className, tooltip, onClick, children }: IconButtonProps): React.ReactElement {
  return (
    <Tooltip content={tooltip}>
      <button className={className} onClick={onClick}>
        {children}
      </button>
    </Tooltip>
  );
}

export const Tab: React.FC<TabProps> = ({
  tab,
  groupId,
  isActive,
  onClick,
  onDoubleClick,
  onClose,
  onPin,
  onDragStart,
  onDragEnd,
  isDragging = false,
  onPopOut,
}) => {
  const { t } = useTranslation('components');
  const [isHovered, setIsHovered] = useState(false);
  const isPinned = tab.state === 'pinned';
  const isTaskDetail = tab.content.type === 'task-detail';
  const showHoverActions = isHovered;

  const deletedSuffix = tab.fileDeletedFromDisk ? ` - ${t('tabs.fileDeleted')}` : '';
  const titleDisplay = `${tab.title}${deletedSuffix}`;
  const unsavedSuffix = tab.isDirty ? ` (${t('tabs.unsaved')})` : '';
  const tooltipText = tab.content.data?.filePath
    ? `${tab.content.data.filePath}${deletedSuffix}${unsavedSuffix}`
    : `${titleDisplay}${unsavedSuffix}`;

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClick();
  }, [onClick]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick();
  }, [onDoubleClick]);

  const handleCloseClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await onClose();
  }, [onClose]);

  const handlePinClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onPin();
  }, [onPin]);

  const handlePopOutClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onPopOut?.();
  }, [onPopOut]);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', createDragPayload(tab, groupId));
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(e);
  }, [groupId, onDragStart, tab]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const handleMiddleMouseDown = useCallback((e: React.MouseEvent) => {
    if (shouldSkipMiddleClick(e, isPinned)) return;
    e.preventDefault();
  }, [isPinned]);

  const handleAuxClick = useCallback((e: React.MouseEvent) => {
    if (shouldSkipMiddleClick(e, isPinned)) return;
    e.preventDefault();
    e.stopPropagation();
    void onClose();
  }, [isPinned, onClose]);

  return (
    <Tooltip content={tooltipText} placement="bottom">
      <div
        className={buildTabClassName(tab, isActive, isDragging)}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMiddleMouseDown}
        onAuxClick={handleAuxClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
      >
        {isPinned && (
          <IconButton className="canvas-tab__pin-icon" tooltip={t('tabs.unpin')} onClick={handlePinClick}>
            <Pin size={12} />
          </IconButton>
        )}

        {isTaskDetail && <Split size={12} className="canvas-tab__type-icon" aria-hidden />}
        <span className="canvas-tab__title">{titleDisplay}</span>

        {tab.isDirty && (
          <span className="canvas-tab__dirty-indicator" title={t('tabs.unsaved')}>
            {UNSAVED_MARK}
          </span>
        )}

        {showHoverActions && onPopOut && (
          <IconButton
            className="canvas-tab__popout-btn"
            tooltip={t('tabs.popOut', 'Pop out as scene')}
            onClick={handlePopOutClick}
          >
            <ExternalLink size={12} />
          </IconButton>
        )}

        {showHoverActions && (
          <IconButton className="canvas-tab__close-btn" tooltip={t('tabs.close')} onClick={handleCloseClick}>
            <X size={12} />
          </IconButton>
        )}
      </div>
    </Tooltip>
  );
};

Tab.displayName = 'Tab';

export default Tab;
