import { useCallback } from 'react';
import { useCanvasStore } from '../stores';
import type { SplitMode, AnchorPosition } from '../types';
import { LAYOUT_CONFIG } from '../types';

interface UseLayoutStateReturn {
  splitMode: SplitMode;
  splitRatio: number;
  anchorPosition: AnchorPosition;
  anchorSize: number;
  isMaximized: boolean;
  setSplitMode: (mode: SplitMode) => void;
  setSplitRatio: (ratio: number) => void;
  setAnchorPosition: (position: AnchorPosition) => void;
  setAnchorSize: (size: number) => void;
  toggleMaximize: () => void;
  enableHorizontalSplit: () => void;
  enableVerticalSplit: () => void;
  disableSplit: () => void;
  toggleSplit: () => void;
  showAnchor: (position?: AnchorPosition) => void;
  hideAnchor: () => void;
  toggleAnchor: () => void;
  resetLayout: () => void;
}

export const useLayoutState = (): UseLayoutStateReturn => {
  const {
    layout,
    setSplitMode,
    setSplitRatio,
    setAnchorPosition,
    setAnchorSize,
    toggleMaximize,
  } = useCanvasStore();

  const applySplitMode = useCallback((mode: SplitMode) => () => setSplitMode(mode), [setSplitMode]);

  const toggleSplit = useCallback(() => {
    setSplitMode(layout.splitMode === 'none' ? 'horizontal' : 'none');
  }, [layout.splitMode, setSplitMode]);

  const showAnchor = useCallback(
    (position: AnchorPosition = 'bottom') => setAnchorPosition(position),
    [setAnchorPosition]
  );

  const hideAnchor = useCallback(() => setAnchorPosition('hidden'), [setAnchorPosition]);

  const toggleAnchor = useCallback(() => {
    setAnchorPosition(layout.anchorPosition === 'hidden' ? 'bottom' : 'hidden');
  }, [layout.anchorPosition, setAnchorPosition]);

  const resetLayout = useCallback(() => {
    setSplitMode('none');
    setSplitRatio(LAYOUT_CONFIG.DEFAULT_SPLIT_RATIO);
    setAnchorPosition('hidden');
    setAnchorSize(LAYOUT_CONFIG.DEFAULT_ANCHOR_SIZE);
  }, [setSplitMode, setSplitRatio, setAnchorPosition, setAnchorSize]);

  return {
    splitMode: layout.splitMode,
    splitRatio: layout.splitRatio,
    anchorPosition: layout.anchorPosition,
    anchorSize: layout.anchorSize,
    isMaximized: layout.isMaximized,
    setSplitMode,
    setSplitRatio,
    setAnchorPosition,
    setAnchorSize,
    toggleMaximize,
    enableHorizontalSplit: applySplitMode('horizontal'),
    enableVerticalSplit: applySplitMode('vertical'),
    disableSplit: applySplitMode('none'),
    toggleSplit,
    showAnchor,
    hideAnchor,
    toggleAnchor,
    resetLayout,
  };
};

export default useLayoutState;
