import { lazy } from 'react';
import type { ComponentType } from 'react';
import type { SceneTabId } from '@/app/components/SceneBar/types';

type LazyNavComponent = ReturnType<typeof lazy<ComponentType>>;

const REGISTERED_NAV_SCENE_IDS = new Set<SceneTabId>([
  'settings',
  'file-viewer',
  'shell',
]);

const SCENE_NAV_COMPONENTS: Partial<Record<SceneTabId, LazyNavComponent>> = {
  settings: lazy(() => import('@/app/scenes/settings/SettingsNav')),
  'file-viewer': lazy(() => import('@/app/scenes/file-viewer/FileViewerNav')),
  shell: lazy(() => import('@/app/scenes/shell/ShellNav')),
};

export function getSceneNav(sceneId: SceneTabId): LazyNavComponent | null {
  return SCENE_NAV_COMPONENTS[sceneId] ?? null;
}

export function hasSceneNav(sceneId: SceneTabId): boolean {
  return REGISTERED_NAV_SCENE_IDS.has(sceneId);
}
