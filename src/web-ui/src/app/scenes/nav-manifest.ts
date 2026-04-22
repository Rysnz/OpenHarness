import type { SceneTabId } from '../components/SceneBar/types';

const REGISTERED_NAV_SCENE_IDS = new Set<SceneTabId>([
  'settings',
  'file-viewer',
  'shell',
]);

export function hasSceneNav(sceneId: SceneTabId): boolean {
  return REGISTERED_NAV_SCENE_IDS.has(sceneId);
}
