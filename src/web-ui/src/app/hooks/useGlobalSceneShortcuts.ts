import { useCallback } from 'react';
import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import { useSceneStore } from '@/app/stores/sceneStore';
import type { SceneTabId } from '@/app/components/SceneBar/types';

const SCENE_SHORTCUT_PRIORITY = 10;
const SCENE_FOCUS_PRIORITY = 12;

const useOpenSceneShortcut = (
  id: string,
  shortcut: Parameters<typeof useShortcut>[1],
  sceneId: SceneTabId,
  description: string
) => {
  useShortcut(id, shortcut, () => openSceneById(sceneId), {
    priority: SCENE_SHORTCUT_PRIORITY,
    description
  });
};

const useSceneFocusShortcut = (index: number, handler: () => void) => {
  useShortcut(
    `scene.focus${index + 1}`,
    { key: String(index + 1), alt: true, scope: 'app', allowInInput: true },
    handler,
    {
      priority: SCENE_FOCUS_PRIORITY,
      description: 'keyboard.shortcuts.scene.focusMerged',
    }
  );
};

function activateSceneByStripIndex(index: number): void {
  const { openTabs, activateScene } = useSceneStore.getState();
  const tab = openTabs[index];

  if (tab) {
    activateScene(tab.id);
  }
}

function openSceneById(id: SceneTabId): void {
  useSceneStore.getState().openScene(id);
}

export function useGlobalSceneShortcuts(): void {
  const byIndex = useCallback((index: number) => () => activateSceneByStripIndex(index), []);

  useSceneFocusShortcut(0, byIndex(0));
  useSceneFocusShortcut(1, byIndex(1));
  useSceneFocusShortcut(2, byIndex(2));

  useOpenSceneShortcut(
    'scene.openSession',
    { key: 'A', ctrl: true, shift: true, scope: 'app', allowInInput: true },
    'session',
    'keyboard.shortcuts.scene.openSession'
  );

  useOpenSceneShortcut(
    'scene.openGit',
    { key: 'G', ctrl: true, shift: true, scope: 'app', allowInInput: true },
    'git',
    'keyboard.shortcuts.scene.openGit'
  );

  useOpenSceneShortcut(
    'scene.openSettings',
    { key: ',', ctrl: true, scope: 'app', allowInInput: true },
    'settings',
    'keyboard.shortcuts.scene.openSettings'
  );

  useOpenSceneShortcut(
    'scene.openTerminal',
    { key: '`', ctrl: true, shift: true, scope: 'app', allowInInput: true },
    'terminal',
    'keyboard.shortcuts.scene.openTerminal'
  );
}
