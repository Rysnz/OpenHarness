/**
 * useKeyboardShortcuts Hook
 *
 * Registers canvas-level keyboard shortcuts via ShortcutManager.
 * All shortcuts use scope 'canvas' so they only fire when focus is inside
 * the editor canvas area (data-shortcut-scope="canvas").
 */

import { useCallback } from 'react';
import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import { useCanvasStore } from '../stores';
import type { EditorGroupId } from '../types';

interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
  handleCloseWithDirtyCheck?: (tabId: string, groupId: EditorGroupId) => Promise<boolean>;
}

const canvasScope = 'canvas' as const;
const tabSwitchShortcutOptions = {
  key: '',
  ctrl: true,
  scope: canvasScope,
  allowInInput: true,
} as const;

export const useKeyboardShortcuts = (options: UseKeyboardShortcutsOptions = {}) => {
  const { enabled = true, handleCloseWithDirtyCheck } = options;

  const {
    primaryGroup,
    secondaryGroup,
    activeGroupId,
    layout,
    closeTab,
    switchToTab,
    reopenClosedTab,
    setSplitMode,
    setAnchorPosition,
    toggleMaximize,
    toggleMissionControl,
  } = useCanvasStore();

  const getActiveGroup = useCallback(() => {
    return activeGroupId === 'primary' ? primaryGroup : secondaryGroup;
  }, [activeGroupId, primaryGroup, secondaryGroup]);

  const getVisibleTabs = useCallback(() => {
    return getActiveGroup().tabs.filter((t) => !t.isHidden);
  }, [getActiveGroup]);

  // Mission control
  useShortcut(
    'canvas.missionControl',
    { key: 'Tab', ctrl: true, scope: canvasScope, allowInInput: true },
    () => toggleMissionControl(),
    { enabled, priority: 10, description: 'keyboard.shortcuts.canvas.missionControl' }
  );

  // Horizontal split: mod+\
  useShortcut(
    'canvas.splitHorizontal',
    { key: '\\', ctrl: true, scope: canvasScope },
    () => setSplitMode(layout.splitMode === 'horizontal' ? 'none' : 'horizontal'),
    { enabled, description: 'keyboard.shortcuts.canvas.splitHorizontal' }
  );

  // Vertical split: mod+Shift+\
  useShortcut(
    'canvas.splitVertical',
    { key: '\\', ctrl: true, shift: true, scope: canvasScope },
    () => setSplitMode(layout.splitMode === 'vertical' ? 'none' : 'vertical'),
    { enabled, description: 'keyboard.shortcuts.canvas.splitVertical' }
  );

  // Anchor zone: mod+`
  useShortcut(
    'canvas.anchorZone',
    { key: '`', ctrl: true, scope: canvasScope },
    () => setAnchorPosition(layout.anchorPosition === 'hidden' ? 'bottom' : 'hidden'),
    { enabled, description: 'keyboard.shortcuts.canvas.anchorZone' }
  );

  // Maximize: mod+Shift+M
  useShortcut(
    'canvas.maximize',
    { key: 'M', ctrl: true, shift: true, scope: canvasScope },
    () => toggleMaximize(),
    { enabled, description: 'keyboard.shortcuts.canvas.maximize' }
  );

  // Close canvas preview/modal overlay: Escape
  useShortcut(
    'canvas.closePreview',
    { key: 'Escape', scope: canvasScope, allowInInput: true },
    () => window.dispatchEvent(new CustomEvent('closePreview')),
    { enabled, priority: 5, description: 'keyboard.shortcuts.canvas.closePreview' }
  );

  // Close current tab: mod+W
  useShortcut(
    'tab.close',
    { key: 'W', ctrl: true, scope: canvasScope, allowInInput: true },
    () => {
      const activeGroup = getActiveGroup();
      if (!activeGroup.activeTabId) return;
      if (handleCloseWithDirtyCheck) {
        handleCloseWithDirtyCheck(activeGroup.activeTabId, activeGroupId);
      } else {
        closeTab(activeGroup.activeTabId, activeGroupId);
      }
    },
    { enabled, priority: 10, description: 'keyboard.shortcuts.tab.close' }
  );

  // Reopen closed tab: mod+Shift+T
  useShortcut(
    'tab.reopenClosed',
    { key: 'T', ctrl: true, shift: true, scope: canvasScope, allowInInput: true },
    () => reopenClosedTab(),
    { enabled, priority: 10, description: 'keyboard.shortcuts.tab.reopenClosed' }
  );

  // Switch to tab by number: mod+1~9
  const switchToTabByIndex = useCallback(
    (index: number) => {
      const tabs = getVisibleTabs();
      const target = index === -1 ? tabs[tabs.length - 1] : tabs[index];
      if (target) switchToTab(target.id, activeGroupId);
    },
    [getVisibleTabs, switchToTab, activeGroupId]
  );

  const tabSwitchOptions = { enabled, description: 'keyboard.shortcuts.tab.switchMerged' };
  const useTabSwitchShortcut = (id: string, key: string, index: number) => {
    useShortcut(id, { ...tabSwitchShortcutOptions, key }, () => switchToTabByIndex(index), tabSwitchOptions);
  };

  useTabSwitchShortcut('tab.switch1', '1', 0);
  useTabSwitchShortcut('tab.switch2', '2', 1);
  useTabSwitchShortcut('tab.switch3', '3', 2);
  useTabSwitchShortcut('tab.switch4', '4', 3);
  useTabSwitchShortcut('tab.switch5', '5', 4);
  useTabSwitchShortcut('tab.switch6', '6', 5);
  useTabSwitchShortcut('tab.switch7', '7', 6);
  useTabSwitchShortcut('tab.switch8', '8', 7);
  useTabSwitchShortcut('tab.switchLast', '9', -1);
};

export default useKeyboardShortcuts;
