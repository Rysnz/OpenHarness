import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Pin, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/component-library';
import FlexiblePanel from '../../base/FlexiblePanel';
import type { PanelContent } from '../types';
import './QuickLook.scss';

const VIEWPORT_PADDING = 16;
const AUTO_PIN_DELAY_MS = 100;
const OUTSIDE_CLICK_ARM_DELAY_MS = 100;

export interface QuickLookProps {
  isOpen: boolean;
  content: PanelContent | null;
  position: { x: number; y: number };
  onClose: () => void;
  onPin: () => void;
  onContentChange?: (content: PanelContent) => void;
  workspacePath?: string;
}

function adjustedPopupPosition(
  position: QuickLookProps['position'],
  rect: DOMRect
): QuickLookProps['position'] {
  let x = position.x;
  let y = position.y;

  if (x + rect.width > window.innerWidth - VIEWPORT_PADDING) {
    x = window.innerWidth - rect.width - VIEWPORT_PADDING;
  }
  if (x < VIEWPORT_PADDING) {
    x = VIEWPORT_PADDING;
  }
  if (y + rect.height > window.innerHeight - VIEWPORT_PADDING) {
    y = position.y - rect.height - 10;
  }
  if (y < VIEWPORT_PADDING) {
    y = VIEWPORT_PADDING;
  }

  return { x, y };
}

interface QuickLookButtonProps {
  tooltip: string;
  className: string;
  onClick?: () => void;
  children: React.ReactNode;
}

function QuickLookButton({ tooltip, className, onClick, children }: QuickLookButtonProps): React.ReactElement {
  return (
    <Tooltip content={tooltip}>
      <button className={className} onClick={onClick}>
        {children}
      </button>
    </Tooltip>
  );
}

export const QuickLook: React.FC<QuickLookProps> = ({
  isOpen,
  content,
  position,
  onClose,
  onPin,
  onContentChange,
  workspacePath,
}) => {
  const { t } = useTranslation('components');
  const containerRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const [hasEdited, setHasEdited] = useState(false);

  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    setAdjustedPosition(adjustedPopupPosition(position, containerRef.current.getBoundingClientRect()));
  }, [isOpen, position]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onPin();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onPin]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, OUTSIDE_CLICK_ARM_DELAY_MS);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  const handleContentChange = useCallback((newContent: PanelContent | null) => {
    if (!newContent || !onContentChange) {
      return;
    }

    onContentChange(newContent);
    if (!hasEdited) {
      setHasEdited(true);
      setTimeout(onPin, AUTO_PIN_DELAY_MS);
    }
  }, [hasEdited, onContentChange, onPin]);

  useEffect(() => {
    if (!isOpen) {
      setHasEdited(false);
    }
  }, [isOpen]);

  if (!isOpen || !content) {
    return null;
  }

  return createPortal(
    <div
      ref={containerRef}
      className="canvas-quick-look"
      style={{ left: `${adjustedPosition.x}px`, top: `${adjustedPosition.y}px` }}
    >
      <div className="canvas-quick-look__header">
        <div className="canvas-quick-look__title">
          <span>{content.title}</span>
          {content.data?.filePath && (
            <QuickLookButton tooltip={t('canvas.openFileLocation')} className="canvas-quick-look__open-btn">
              <ExternalLink size={12} />
            </QuickLookButton>
          )}
        </div>

        <div className="canvas-quick-look__actions">
          <QuickLookButton
            tooltip={t('canvas.pinAsTab')}
            className="canvas-quick-look__action-btn canvas-quick-look__pin-btn"
            onClick={onPin}
          >
            <Pin size={14} />
          </QuickLookButton>
          <QuickLookButton
            tooltip={t('canvas.closeEsc')}
            className="canvas-quick-look__action-btn canvas-quick-look__close-btn"
            onClick={onClose}
          >
            <X size={14} />
          </QuickLookButton>
        </div>
      </div>

      <div className="canvas-quick-look__content">
        <FlexiblePanel content={content} onContentChange={handleContentChange} workspacePath={workspacePath} />
      </div>

      <div className="canvas-quick-look__footer">
        <span>{t('canvas.enterToPin')}</span>
        <span className="canvas-quick-look__separator">|</span>
        <span>{t('canvas.escToClose')}</span>
      </div>
    </div>,
    document.body
  );
};

QuickLook.displayName = 'QuickLook';

export default QuickLook;
