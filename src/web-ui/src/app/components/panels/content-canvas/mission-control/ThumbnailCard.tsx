/**
 * ThumbnailCard component.
 * File thumbnail card in mission control.
 */

import React, { useCallback, useMemo } from 'react';
import { X, Pin, FileCode, FileText, Image, Terminal, GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/component-library';
import type { CanvasTab, EditorGroupId } from '../types';
import { isFileViewerType } from '../types';
import './ThumbnailCard.scss';

const PREVIEW_LINE_LIMIT = 5;

export interface ThumbnailCardProps {
  /** Tab data */
  tab: CanvasTab;
  /** Editor group */
  groupId: EditorGroupId;
  /** Whether active tab */
  isActive: boolean;
  /** Click callback */
  onClick: () => void;
  /** Close callback */
  onClose: () => void;
  /** Pin callback */
  onPin: () => void;
  /** Drag start */
  onDragStart: (e: React.DragEvent) => void;
  /** Drag end */
  onDragEnd: () => void;
}

const CONTENT_ICON_RULES: Array<[(type: string) => boolean, React.ReactNode]> = [
  [(type) => type.includes('code') || type.includes('editor'), <FileCode size={16} />],
  [(type) => type.includes('markdown') || type.includes('text'), <FileText size={16} />],
  [(type) => type.includes('image'), <Image size={16} />],
  [(type) => type === 'terminal', <Terminal size={16} />],
  [(type) => type.includes('git'), <GitBranch size={16} />],
];

const getContentIcon = (type: string): React.ReactNode => {
  return CONTENT_ICON_RULES.find(([matches]) => matches(type))?.[1] ?? <FileCode size={16} />;
};

const readPreviewText = (tab: CanvasTab): string => {
  const payload = tab.content.data;

  if (typeof payload === 'string') {
    return payload;
  }

  return payload?.content ?? payload?.sourceCode ?? payload?.initialContent ?? '';
};

const getPreviewContent = (tab: CanvasTab, noPreviewText: string): string[] => {
  const content = readPreviewText(tab);

  if (content.length === 0) {
    return [noPreviewText];
  }

  return content.split('\n').slice(0, PREVIEW_LINE_LIMIT);
};

const getGroupLabelKey = (groupId: EditorGroupId): string => {
  const labels: Record<EditorGroupId, string> = {
    primary: 'canvas.groupPrimary',
    secondary: 'canvas.groupSecondary',
    tertiary: 'canvas.groupTertiary',
  };

  return labels[groupId] ?? 'canvas.groupTertiary';
};

export const ThumbnailCard: React.FC<ThumbnailCardProps> = ({
  tab,
  groupId,
  isActive,
  onClick,
  onClose,
  onPin,
  onDragStart,
  onDragEnd,
}) => {
  const { t } = useTranslation('components');

  const previewLines = useMemo(() => getPreviewContent(tab, t('canvas.noPreview')), [tab, t]);
  const isFileType = useMemo(() => isFileViewerType(tab.content.type), [tab.content.type]);
  const groupLabel = useMemo(() => t(getGroupLabelKey(groupId)), [groupId, t]);

  const titleWithDeleted = useMemo(() => {
    const suffix = tab.fileDeletedFromDisk ? ` - ${t('tabs.fileDeleted')}` : '';
    return `${tab.title}${suffix}`;
  }, [tab.fileDeletedFromDisk, tab.title, t]);

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  }, [onClose]);

  const handlePin = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onPin();
  }, [onPin]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      tabId: tab.id,
      sourceGroupId: groupId,
    }));
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(e);
  }, [tab.id, groupId, onDragStart]);

  const classNames = [
    'canvas-thumbnail-card',
    isActive ? 'is-active' : '',
    tab.state === 'pinned' ? 'is-pinned' : '',
    tab.state === 'preview' ? 'is-preview' : '',
    tab.isDirty ? 'is-dirty' : '',
    tab.fileDeletedFromDisk ? 'is-file-deleted' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classNames}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
    >
      {/* Header */}
      <div className="canvas-thumbnail-card__header">
        <div className="canvas-thumbnail-card__icon">
          {getContentIcon(tab.content.type)}
        </div>
        <div className="canvas-thumbnail-card__title">
          {tab.state === 'pinned' && <Pin size={10} className="canvas-thumbnail-card__pin-icon" />}
          <span className={tab.state === 'preview' ? 'is-preview' : ''}>
            {titleWithDeleted}
          </span>
          {tab.isDirty && <span className="canvas-thumbnail-card__dirty">●</span>}
        </div>
        <div className="canvas-thumbnail-card__actions">
          <Tooltip content={tab.state === 'pinned' ? t('tabs.unpin') : t('tabs.pin')}>
            <button
              className={`canvas-thumbnail-card__action-btn ${tab.state === 'pinned' ? 'is-active' : ''}`}
              onClick={handlePin}
            >
              <Pin size={12} />
            </button>
          </Tooltip>
          <Tooltip content={t('tabs.close')}>
            <button
              className="canvas-thumbnail-card__action-btn canvas-thumbnail-card__close-btn"
              onClick={handleClose}
            >
              <X size={12} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Preview area */}
      <div className="canvas-thumbnail-card__preview">
        {isFileType ? (
          <pre className="canvas-thumbnail-card__code">
            {previewLines.map((line, index) => (
              <div key={index} className="canvas-thumbnail-card__code-line">
                {line || ' '}
              </div>
            ))}
          </pre>
        ) : (
          <div className="canvas-thumbnail-card__placeholder">
            {getContentIcon(tab.content.type)}
            <span>{tab.content.type}</span>
          </div>
        )}
      </div>

      {/* Group badge */}
      <div 
        className={`canvas-thumbnail-card__group-badge canvas-thumbnail-card__group-badge--${groupId}`}
      >
        {groupLabel}
      </div>
    </div>
  );
};

ThumbnailCard.displayName = 'ThumbnailCard';

export default ThumbnailCard;
