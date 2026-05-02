import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip } from '@/component-library';
import { useI18n } from '@/infrastructure/i18n';
import './FloatingToolbar.scss';

type ToolbarType = 'node' | 'edge';

type ToolbarData = {
  id: string;
  text: string;
  fromNode?: string;
  toNode?: string;
};

export interface FloatingToolbarProps {
  isVisible: boolean;
  position: { x: number; y: number };
  type: ToolbarType;
  data: ToolbarData;
  onSave: (data: any) => void;
  onDelete: () => void;
  onClose: () => void;
}

const PORTAL_ROOT_ID = 'floating-toolbar-root';
const TOOLBAR_EDGE_PADDING = 100;
const TOOLBAR_WIDTH_BY_TYPE: Record<ToolbarType, number> = {
  node: 300,
  edge: 400
};

const clamp = (value: number, min: number, max: number): number => (
  Math.max(min, Math.min(value, max))
);

const buildToolbarStyle = (
  position: FloatingToolbarProps['position'],
  type: ToolbarType
): React.CSSProperties => ({
  left: clamp(position.x, 0, window.innerWidth - TOOLBAR_WIDTH_BY_TYPE[type]),
  top: clamp(position.y, 0, window.innerHeight - TOOLBAR_EDGE_PADDING),
  position: 'fixed',
  zIndex: 2000
});

const syncPortalTheme = (container: HTMLElement): void => {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme) {
    container.setAttribute('data-theme', theme);
  } else {
    container.removeAttribute('data-theme');
  }
};

const getToolbarPortalContainer = (): HTMLElement => {
  let container = document.getElementById(PORTAL_ROOT_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = PORTAL_ROOT_ID;
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.left = '0';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '2000';
    document.body.appendChild(container);
  }

  syncPortalTheme(container);
  return container;
};

const cleanupToolbarPortal = (): void => {
  window.setTimeout(() => {
    const container = document.getElementById(PORTAL_ROOT_ID);
    if (container && container.children.length === 0) {
      container.remove();
    }
  }, 100);
};

const SaveIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const DeleteIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const CancelIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

interface ToolbarButtonProps {
  title: string;
  className: string;
  onClick: () => void;
  children: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ title, className, onClick, children }) => (
  <Tooltip content={title} placement="top">
    <button className={`toolbar-btn ${className}`} onClick={onClick}>
      {children}
    </button>
  </Tooltip>
);

export const FloatingToolbar: React.FC<FloatingToolbarProps> = ({
  isVisible,
  position,
  type,
  data,
  onSave,
  onDelete,
  onClose
}) => {
  const { t } = useI18n('mermaid-editor');
  const [text, setText] = useState(data.text);
  const [fromNode, setFromNode] = useState(data.fromNode || '');
  const [toNode, setToNode] = useState(data.toNode || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarStyle = useMemo(() => buildToolbarStyle(position, type), [position, type]);

  useEffect(() => {
    setText(data.text);
    setFromNode(data.fromNode || '');
    setToNode(data.toNode || '');
  }, [data]);

  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isVisible]);

  const handleSave = useCallback(() => {
    if (type === 'node') {
      onSave({ id: data.id, text });
    } else {
      onSave({ id: data.id, text, fromNode, toNode });
    }
    onClose();
  }, [type, data.id, text, fromNode, toNode, onSave, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }, [handleSave, onClose]);

  const handleDelete = useCallback(() => {
    onDelete();
    onClose();
  }, [onDelete, onClose]);

  useEffect(() => cleanupToolbarPortal, []);

  if (!isVisible) return null;

  const portalContent = (
    <div
      ref={toolbarRef}
      className="floating-toolbar"
      data-type={type}
      style={toolbarStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          e.stopPropagation();
        }
      }}
    >
      <div className="toolbar-content">
        {type === 'node' ? (
          <div className="toolbar-row">
            <span className="toolbar-label">{t('floatingToolbar.node')} [{data.id}]:</span>
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('floatingToolbar.nodeTextPlaceholder')}
              className="toolbar-input"
            />
          </div>
        ) : (
          <>
            <div className="toolbar-row">
              <span className="toolbar-label">{t('floatingToolbar.connection')}:</span>
              <input
                type="text"
                value={fromNode}
                onChange={(e) => setFromNode(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('floatingToolbar.startNodePlaceholder')}
                className="toolbar-input node-input"
              />
              <span className="toolbar-arrow">{'->'}</span>
              <input
                type="text"
                value={toNode}
                onChange={(e) => setToNode(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('floatingToolbar.targetNodePlaceholder')}
                className="toolbar-input node-input"
              />
            </div>
            <div className="toolbar-row">
              <span className="toolbar-label">{t('floatingToolbar.text')}:</span>
              <input
                ref={inputRef}
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('floatingToolbar.connectionTextPlaceholder')}
                className="toolbar-input"
              />
            </div>
          </>
        )}

        <div className="toolbar-buttons">
          <ToolbarButton title={t('floatingToolbar.saveEnter')} className="save" onClick={handleSave}>
            <SaveIcon />
          </ToolbarButton>
          <ToolbarButton title={t('floatingToolbar.delete')} className="delete" onClick={handleDelete}>
            <DeleteIcon />
          </ToolbarButton>
          <ToolbarButton title={t('floatingToolbar.cancelEsc')} className="cancel" onClick={onClose}>
            <CancelIcon />
          </ToolbarButton>
        </div>
      </div>
    </div>
  );

  return createPortal(portalContent, getToolbarPortalContainer());
};
