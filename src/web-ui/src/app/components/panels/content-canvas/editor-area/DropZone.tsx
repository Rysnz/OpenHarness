import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { DropPosition, EditorGroupId } from '../types';
import './DropZone.scss';

export interface DropZoneProps {
  groupId: EditorGroupId;
  isDragging: boolean;
  draggingFromGroupId: EditorGroupId | null;
  splitMode: 'none' | 'horizontal' | 'vertical' | 'grid';
  onDrop: (position: DropPosition) => void;
  children: React.ReactNode;
}

interface ZoneConfig {
  position: DropPosition;
  label: string;
  show: boolean;
}

type DropLabels = Record<'left' | 'right' | 'bottom' | 'center', string>;

const zoneBaseStyle: React.CSSProperties = { position: 'absolute' };
const zoneStyles: Record<DropPosition, React.CSSProperties> = {
  left: { left: 0, top: 0, bottom: 0, width: '25%' },
  right: { right: 0, top: 0, bottom: 0, width: '25%' },
  top: { top: 0, left: 0, right: 0, height: '25%' },
  bottom: { bottom: 0, left: 0, right: 0, height: '25%' },
  center: { left: '25%', right: '25%', top: '25%', bottom: '25%' },
};

function visibleZones(
  splitMode: DropZoneProps['splitMode'],
  groupId: EditorGroupId,
  isFromSameGroup: boolean,
  isFromDifferentGroup: boolean,
  labels: DropLabels
): ZoneConfig[] {
  if (splitMode === 'none') {
    return [
      { position: 'left', label: labels.left, show: true },
      { position: 'right', label: labels.right, show: true },
      { position: 'bottom', label: labels.bottom, show: true },
    ];
  }

  if (splitMode === 'horizontal') {
    const sameGroupEdge = groupId === 'primary'
      ? { position: 'right' as const, label: labels.right, show: true }
      : { position: 'left' as const, label: labels.left, show: true };

    return [
      { position: 'center', label: labels.center, show: isFromDifferentGroup },
      { position: 'bottom', label: labels.bottom, show: true },
      isFromSameGroup && sameGroupEdge,
    ].filter(Boolean) as ZoneConfig[];
  }

  if (splitMode === 'vertical') {
    const sameGroupEdge = groupId === 'primary'
      ? { position: 'bottom' as const, label: labels.bottom, show: true }
      : { position: 'left' as const, label: labels.left, show: true };

    return [
      { position: 'center', label: labels.center, show: isFromDifferentGroup },
      isFromSameGroup && sameGroupEdge,
    ].filter(Boolean) as ZoneConfig[];
  }

  if (splitMode === 'grid') {
    return [{ position: 'center', label: labels.center, show: true }];
  }

  return [];
}

function dropZoneStyle(position: DropPosition, zoneCount: number): React.CSSProperties {
  if (zoneCount === 1 && position === 'center') {
    return { ...zoneBaseStyle, inset: 0 };
  }

  return { ...zoneBaseStyle, ...zoneStyles[position] };
}

function pointerLeftElement(e: React.DragEvent): boolean {
  const rect = e.currentTarget.getBoundingClientRect();
  const { clientX: x, clientY: y } = e;
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}

export const DropZone: React.FC<DropZoneProps> = ({
  groupId,
  isDragging,
  draggingFromGroupId,
  splitMode,
  onDrop,
  children,
}) => {
  const { t } = useTranslation('components');
  const [activeZone, setActiveZone] = useState<DropPosition | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);

  const isFromSameGroup = draggingFromGroupId === groupId;
  const isFromDifferentGroup = draggingFromGroupId !== null && !isFromSameGroup;
  const labels = {
    left: t('canvas.dropLeft'),
    right: t('canvas.dropRight'),
    bottom: t('canvas.dropBottom'),
    center: t('canvas.dropCenter'),
  };

  useEffect(() => {
    if (isDragging) {
      const timer = setTimeout(() => setShowOverlay(true), 100);
      return () => clearTimeout(timer);
    }
    setShowOverlay(false);
    setActiveZone(null);
  }, [isDragging]);

  const zones = isDragging
    ? visibleZones(splitMode, groupId, isFromSameGroup, isFromDifferentGroup, labels).filter((zone) => zone.show)
    : [];

  const handleDragEnter = useCallback((position: DropPosition) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveZone(position);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (pointerLeftElement(e)) {
      setActiveZone(null);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((position: DropPosition) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveZone(null);
    setShowOverlay(false);
    onDrop(position);
  }, [onDrop]);

  return (
    <div className={`canvas-drop-zone-container ${showOverlay ? 'is-dragging' : ''}`}>
      <div className="canvas-drop-zone-container__content">
        {children}
      </div>

      {showOverlay && zones.length > 0 && (
        <div className="canvas-drop-zone-overlay">
          {zones.map(({ position, label }) => (
            <div
              key={position}
              className={`canvas-drop-zone canvas-drop-zone--${position} ${activeZone === position ? 'is-active' : ''}`}
              style={dropZoneStyle(position, zones.length)}
              onDragEnter={handleDragEnter(position)}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop(position)}
            >
              <div className="canvas-drop-zone__indicator">
                <span>{label}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

DropZone.displayName = 'DropZone';

export default DropZone;
