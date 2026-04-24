/**
 * Pan and zoom hook.
 * Centralizes SVG container zoom and drag behavior.
 *
 * Features:
 * - Mouse wheel zoom (centered on cursor)
 * - Mouse drag panning
 * - Zoom controls (in, out, reset)
 * - Prevent drag vs click conflicts
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';

type Point = { x: number; y: number };
type Size = { width: number; height: number };

const DEFAULT_TRANSFORM: PanZoomState = {
  scale: 1,
  translateX: 0,
  translateY: 0,
};
const FIT_PADDING = 0.9;
const MAX_FIT_SCALE = 1.5;
const DRAG_RESET_DELAY_MS = 50;

const clampScale = (scale: number, minScale: number, maxScale: number) =>
  Math.max(minScale, Math.min(maxScale, scale));

const distanceBetween = (a: Point, b: Point) => {
  const deltaX = a.x - b.x;
  const deltaY = a.y - b.y;
  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
};

const fitTransformToContainer = (
  content: Size,
  container: Size,
  minScale: number,
  maxScale: number
): PanZoomState => {
  const scaleX = (container.width * FIT_PADDING) / content.width;
  const scaleY = (container.height * FIT_PADDING) / content.height;
  const scale = clampScale(Math.min(scaleX, scaleY, MAX_FIT_SCALE), minScale, maxScale);
  const scaledWidth = content.width * scale;
  const scaledHeight = content.height * scale;

  return {
    scale,
    translateX: (container.width - scaledWidth) / 2,
    translateY: (container.height - scaledHeight) / 2,
  };
};

const zoomAroundPoint = (
  prev: PanZoomState,
  nextScale: number,
  origin: Point,
  cursor: Point
): PanZoomState => {
  const scaleRatio = nextScale / prev.scale;

  return {
    scale: nextScale,
    translateX: origin.x + (prev.translateX - origin.x) * scaleRatio + (cursor.x - origin.x) * (1 - scaleRatio),
    translateY: origin.y + (prev.translateY - origin.y) * scaleRatio + (cursor.y - origin.y) * (1 - scaleRatio),
  };
};

const isInteractivePanTarget = (target: Element) => Boolean(target.closest(
  'g[id*="flowchart-"], .node, g[class*="node"], ' +
  '.edgeLabel, path[id*="L_"], g.edgePath, ' +
  'g[id*="subGraph"], .subgraph, g[class*="cluster"], .cluster, ' +
  '.interactive-node'
));

export interface PanZoomState {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface PanZoomOptions {
  /** Minimum scale, default 0.1. */
  minScale?: number;
  /** Maximum scale, default 5. */
  maxScale?: number;
  /** Zoom step factor, default 1.2. */
  scaleFactor?: number;
  /** Enable wheel zoom, default true. */
  enableWheelZoom?: boolean;
  /** Enable drag panning, default true. */
  enableDrag?: boolean;
  /** Drag distance threshold (px) before considered a drag, default 5. */
  dragThreshold?: number;
  /** Zoom change callback. */
  onZoomChange?: (zoomLevel: number) => void;
}

export interface PanZoomControls {
  /** Zoom in. */
  zoomIn: () => void;
  /** Zoom out. */
  zoomOut: () => void;
  /** Reset view. */
  resetView: () => void;
  /** Fit content into container: auto zoom and center. */
  fitToContainer: (contentWidth: number, contentHeight: number) => void;
  /** Get current zoom percentage. */
  getZoomLevel: () => number;
  /** Set scale directly. */
  setScale: (scale: number) => void;
}

export interface PanZoomHandlers {
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  onDoubleClick: () => void;
}

export interface UsePanZoomReturn {
  /** Current transform state. */
  transform: PanZoomState;
  /** Whether dragging is active. */
  isDragging: boolean;
  /** Whether a drag just finished (used to suppress clicks). */
  hasDragged: boolean;
  /** Event handlers. */
  handlers: PanZoomHandlers;
  /** Control helpers. */
  controls: PanZoomControls;
  /** Container ref for wheel events. */
  containerRef: React.RefObject<HTMLDivElement>;
  /** Reset drag state manually. */
  resetDragState: () => void;
}

export function usePanZoom(options: PanZoomOptions = {}): UsePanZoomReturn {
  const {
    minScale = 0.1,
    maxScale = 5,
    scaleFactor = 1.2,
    enableWheelZoom = true,
    enableDrag = true,
    dragThreshold = 5,
    onZoomChange,
  } = options;

  const [transform, setTransform] = useState<PanZoomState>(DEFAULT_TRANSFORM);

  const [isDragging, setIsDragging] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const hasDraggedRef = useRef(false);

  // ==================== Controls ====================
  
  const zoomIn = useCallback(() => {
    setTransform(prev => {
      const newScale = clampScale(prev.scale * scaleFactor, minScale, maxScale);
      return { ...prev, scale: newScale };
    });
  }, [minScale, maxScale, scaleFactor]);

  const zoomOut = useCallback(() => {
    setTransform(prev => {
      const newScale = clampScale(prev.scale / scaleFactor, minScale, maxScale);
      return { ...prev, scale: newScale };
    });
  }, [minScale, maxScale, scaleFactor]);

  const resetView = useCallback(() => {
    setTransform(DEFAULT_TRANSFORM);
  }, []);

  /**
   * Fit content into the container with auto zoom and centering.
   * @param contentWidth Original SVG content width.
   * @param contentHeight Original SVG content height.
   */
  const fitToContainer = useCallback((contentWidth: number, contentHeight: number) => {
    const container = containerRef.current;
    if (!container || contentWidth <= 0 || contentHeight <= 0) return;
    
    const rect = container.getBoundingClientRect();
    setTransform(fitTransformToContainer(
      { width: contentWidth, height: contentHeight },
      { width: rect.width, height: rect.height },
      minScale,
      maxScale
    ));
  }, [minScale, maxScale]);

  const getZoomLevel = useCallback(() => {
    return Math.round(transform.scale * 100);
  }, [transform.scale]);

  const setScale = useCallback((scale: number) => {
    const clampedScale = clampScale(scale, minScale, maxScale);
    setTransform(prev => ({ ...prev, scale: clampedScale }));
  }, [minScale, maxScale]);

  const resetDragState = useCallback(() => {
    hasDraggedRef.current = false;
    setHasDragged(false);
  }, []);

  // ==================== Drag handling ====================

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!enableDrag) return;
    
    // Skip drag when interacting with nodes or edges.
    if (isInteractivePanTarget(e.target as Element)) {
      // Reset drag state to allow click handling.
      hasDraggedRef.current = false;
      setHasDragged(false);
      return;
    }
    
    // Support left and middle button drag.
    if (e.button === 0 || e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      
      setIsDragging(true);
      hasDraggedRef.current = false;
      dragStartPosRef.current = { x: e.clientX, y: e.clientY };
      dragStartRef.current = {
        x: e.clientX - transform.translateX,
        y: e.clientY - transform.translateY,
      };
    }
  }, [enableDrag, transform.translateX, transform.translateY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // Compute drag distance.
    const dragDistance = distanceBetween(
      { x: e.clientX, y: e.clientY },
      dragStartPosRef.current
    );
    
    // Treat as drag only after threshold.
    if (dragDistance > dragThreshold) {
      hasDraggedRef.current = true;
      setHasDragged(true);
    }
    
    setTransform(prev => ({
      ...prev,
      translateX: e.clientX - dragStartRef.current.x,
      translateY: e.clientY - dragStartRef.current.y,
    }));
  }, [isDragging, dragThreshold]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    
    // Delay reset so click handlers can check drag state.
    if (hasDraggedRef.current) {
      setTimeout(() => {
        hasDraggedRef.current = false;
        setHasDragged(false);
      }, DRAG_RESET_DELAY_MS);
    }
  }, []);

  // Double-click reset callback (overridable by consumer).
  const handleDoubleClick = useCallback(() => {
    resetView();
  }, [resetView]);
  // ==================== Global mouse events ====================

  useEffect(() => {
    if (!isDragging) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      
      const dragDistance = distanceBetween(
        { x: e.clientX, y: e.clientY },
        dragStartPosRef.current
      );
      
      if (dragDistance > dragThreshold) {
        hasDraggedRef.current = true;
        setHasDragged(true);
      }
      
      setTransform(prev => ({
        ...prev,
        translateX: e.clientX - dragStartRef.current.x,
        translateY: e.clientY - dragStartRef.current.y,
      }));
    };

    const handleGlobalMouseUp = () => {
      setIsDragging(false);
      
      if (hasDraggedRef.current) {
        setTimeout(() => {
          hasDraggedRef.current = false;
          setHasDragged(false);
        }, DRAG_RESET_DELAY_MS);
      }
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, dragThreshold]);

  // ==================== Wheel zoom ====================

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enableWheelZoom) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      const rect = container.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      const zoomFactor = e.deltaY > 0 ? 1 / scaleFactor : scaleFactor;
      
      setTransform(prev => {
        const newScale = clampScale(prev.scale * zoomFactor, minScale, maxScale);
        return zoomAroundPoint(
          prev,
          newScale,
          { x: centerX, y: centerY },
          { x: mouseX, y: mouseY }
        );
      });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [enableWheelZoom, minScale, maxScale, scaleFactor]);

  // ==================== Zoom change notification ====================

  useEffect(() => {
    if (onZoomChange) {
      onZoomChange(Math.round(transform.scale * 100));
    }
  }, [transform.scale, onZoomChange]);

  // ==================== Return ====================

  const handlers = useMemo<PanZoomHandlers>(() => ({
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseUp: handleMouseUp,
    onDoubleClick: handleDoubleClick,
  }), [handleMouseDown, handleMouseMove, handleMouseUp, handleDoubleClick]);

  const controls = useMemo<PanZoomControls>(() => ({
    zoomIn,
    zoomOut,
    resetView,
    fitToContainer,
    getZoomLevel,
    setScale,
  }), [zoomIn, zoomOut, resetView, fitToContainer, getZoomLevel, setScale]);

  return {
    transform,
    isDragging,
    hasDragged,
    handlers,
    controls,
    containerRef,
    resetDragState,
  };
}
