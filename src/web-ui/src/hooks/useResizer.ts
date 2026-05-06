import { useState, useCallback, useRef, useEffect, RefObject } from 'react';

export type ResizerDirection = 'horizontal' | 'vertical';

interface UseResizerOptions {
  direction: ResizerDirection;
  currentRatio: number;
  onRatioChange: (ratio: number) => void;
  containerRef: RefObject<HTMLElement | null>;
  minRatio?: number;
  maxRatio?: number;
  resetRatio?: number;
}

interface UseResizerReturn {
  handleMouseDown: (e: React.MouseEvent) => void;
  handleDoubleClick: () => void;
  isDragging: boolean;
}

const axisForDirection = (direction: ResizerDirection) =>
  direction === 'horizontal'
    ? { cursor: 'col-resize', position: 'clientX', size: 'offsetWidth' }
    : { cursor: 'row-resize', position: 'clientY', size: 'offsetHeight' };

const clampRatio = (ratio: number, minRatio: number, maxRatio: number): number =>
  Math.min(maxRatio, Math.max(minRatio, ratio));

export const useResizer = ({
  direction,
  currentRatio,
  onRatioChange,
  containerRef,
  minRatio = 0.2,
  maxRatio = 0.8,
  resetRatio = 0.5,
}: UseResizerOptions): UseResizerReturn => {
  const [isDragging, setIsDragging] = useState(false);
  const animationFrameRef = useRef<number | null>(null);

  const cancelPendingFrame = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    return cancelPendingFrame;
  }, [cancelPendingFrame]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const axis = axisForDirection(direction);
    const startPos = e[axis.position as 'clientX' | 'clientY'];
    const containerSize = container[axis.size as 'offsetWidth' | 'offsetHeight'];
    const startRatio = currentRatio;

    setIsDragging(true);
    document.body.style.cursor = axis.cursor;
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      cancelPendingFrame();

      animationFrameRef.current = requestAnimationFrame(() => {
        const currentPos = moveEvent[axis.position as 'clientX' | 'clientY'];
        const deltaPos = currentPos - startPos;
        const deltaRatio = deltaPos / containerSize;
        onRatioChange(clampRatio(startRatio + deltaRatio, minRatio, maxRatio));
        animationFrameRef.current = null;
      });
    };

    const handleMouseUp = () => {
      cancelPendingFrame();
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [direction, currentRatio, onRatioChange, containerRef, minRatio, maxRatio, cancelPendingFrame]);

  const handleDoubleClick = useCallback(() => {
    onRatioChange(resetRatio);
  }, [onRatioChange, resetRatio]);

  return {
    handleMouseDown,
    handleDoubleClick,
    isDragging,
  };
};

export default useResizer;
