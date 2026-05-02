import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle, XCircle } from 'lucide-react';
import { Tooltip } from '@/component-library';
import { useI18n } from '@/infrastructure/i18n';
import { DiffEditor } from '../../../tools/editor';
import './DiffFullscreenViewer.css';

type HeaderAction = {
  key: 'accept' | 'reject';
  className: string;
  icon: React.ReactNode;
  tooltipKey: string;
  labelKey: string;
  onClick: () => void;
};

interface DiffFullscreenViewerProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  onAcceptFile: () => void;
  onRejectFile: () => void;
  onAcceptBlock: (blockId: string) => void;
  onRejectBlock: (blockId: string) => void;
  loading?: boolean;
}

function DiffFileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
    </svg>
  );
}

export const DiffFullscreenViewer: React.FC<DiffFullscreenViewerProps> = ({
  isOpen,
  onClose,
  filePath,
  originalContent,
  modifiedContent,
  onAcceptFile,
  onRejectFile,
  onAcceptBlock: _onAcceptBlock,
  onRejectBlock: _onRejectBlock,
  loading = false
}) => {
  const { t } = useI18n('components');
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const fileActions: HeaderAction[] = [
    {
      key: 'accept',
      className: 'accept-btn',
      icon: <CheckCircle size={16} />,
      tooltipKey: 'diffFullscreen.acceptFileTooltip',
      labelKey: 'diffFullscreen.acceptFile',
      onClick: onAcceptFile,
    },
    {
      key: 'reject',
      className: 'reject-btn',
      icon: <XCircle size={16} />,
      tooltipKey: 'diffFullscreen.rejectFileTooltip',
      labelKey: 'diffFullscreen.rejectFile',
      onClick: onRejectFile,
    },
  ];

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // Disable page scrolling
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  const fullscreenContent = (
    <div className="diff-fullscreen-overlay" onClick={handleBackdropClick}>
      <div className="diff-fullscreen-container">
        {/* Top toolbar */}
        <div className="diff-fullscreen-header">
          <div className="file-info">
            <div className="file-icon">
              <DiffFileIcon />
            </div>
            <div className="file-details">
              <div className="file-name">{fileName}</div>
              <div className="file-path-full">{filePath}</div>
            </div>
          </div>

          <div className="header-actions">
            {fileActions.map((action) => (
              <Tooltip key={action.key} content={t(action.tooltipKey)}>
                <button
                  className={`header-btn ${action.className}`}
                  onClick={action.onClick}
                  disabled={loading}
                >
                  {action.icon}
                  <span>{t(action.labelKey)}</span>
                </button>
              </Tooltip>
            ))}

            <div className="header-divider" />

            <Tooltip content={t('tooltip.close')}>
              <button
                className="header-btn close-btn"
                onClick={onClose}
              >
                <X size={16} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Diff content */}
        <div className="diff-fullscreen-content">
          <DiffEditor
            originalContent={originalContent}
            modifiedContent={modifiedContent}
            filePath={filePath}
            readOnly={false}
            renderSideBySide={true}
            showMinimap={false}
          />
        </div>

        {/* Loading overlay */}
        {loading && (
          <div className="fullscreen-loading-overlay">
            <div className="loading-spinner" />
            <span>{t('diffFullscreen.processing')}</span>
          </div>
        )}
      </div>
    </div>
  );

  // Render via portal to body for top-level stacking.
  return createPortal(fullscreenContent, document.body);
};
