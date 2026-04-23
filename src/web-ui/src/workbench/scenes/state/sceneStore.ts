import { create } from 'zustand';
import type { SceneTab, SceneTabId } from '@/app/components/SceneBar/types';
import { useNavSceneStore } from '@/app/stores/navSceneStore';
import {
  getMiniAppSceneDef,
  getSceneDef,
  MAX_OPEN_SCENES,
  SCENE_TAB_REGISTRY,
} from '@/workbench/scenes/sceneCatalog';
import { hasSceneNav } from '@/workbench/scenes/navigation';

const AGENT_SCENE_ID: SceneTabId = 'session';
const WELCOME_SCENE_ID: SceneTabId = 'welcome';

interface SceneState {
  openTabs: SceneTab[];
  activeTabId: SceneTabId;
  navHistory: SceneTabId[];
  navCursor: number;

  openScene: (id: SceneTabId) => void;
  activateScene: (id: SceneTabId) => void;
  closeScene: (id: SceneTabId) => void;
  goBack: () => void;
  goForward: () => void;
}

function getSceneDefOrMiniapp(id: SceneTabId) {
  const definition = getSceneDef(id);
  if (definition) {
    return definition;
  }

  if (typeof id === 'string' && id.startsWith('miniapp:')) {
    return getMiniAppSceneDef(id.slice('miniapp:'.length));
  }

  return undefined;
}

function isFixedScene(id: SceneTabId): boolean {
  return getSceneDefOrMiniapp(id)?.fixed === true;
}

function isClosableScene(id: SceneTabId): boolean {
  const definition = getSceneDefOrMiniapp(id);
  return (definition?.closable ?? !definition?.pinned) !== false;
}

function selectOldestReplaceableTab(tabs: SceneTab[]): SceneTab | undefined {
  return tabs
    .filter((tab) => !isFixedScene(tab.id))
    .sort((a, b) => a.openedAt - b.openedAt)[0];
}

function buildSceneTab(id: SceneTabId, now: number): SceneTab {
  return { id, openedAt: now, lastUsed: now };
}

function resolveNavSceneId(sceneId: SceneTabId): SceneTabId | null {
  if (sceneId === 'terminal') {
    return 'shell';
  }

  return hasSceneNav(sceneId) ? sceneId : null;
}

function buildDefaultTabs(): SceneTab[] {
  const now = Date.now();
  return SCENE_TAB_REGISTRY
    .filter((definition) => definition.defaultOpen)
    .map((definition) => buildSceneTab(definition.id, now));
}

function ensureAgentFirst(tabs: SceneTab[]): SceneTab[] {
  const agentTab = tabs.find((tab) => tab.id === AGENT_SCENE_ID);
  if (!agentTab) {
    return tabs;
  }

  return [agentTab, ...tabs.filter((tab) => tab.id !== AGENT_SCENE_ID)];
}

function pushHistory(history: SceneTabId[], cursor: number, id: SceneTabId) {
  const trimmed = history.slice(0, cursor + 1);
  if (trimmed[trimmed.length - 1] === id) {
    return { navHistory: trimmed, navCursor: trimmed.length - 1 };
  }

  return { navHistory: [...trimmed, id], navCursor: trimmed.length };
}

function removeFromHistory(
  history: SceneTabId[],
  cursor: number,
  removedId: SceneTabId,
  newActiveId: SceneTabId,
) {
  const newHistory = history.filter((entry) => entry !== removedId);
  if (newHistory.length === 0) {
    return { navHistory: [] as SceneTabId[], navCursor: -1 };
  }

  const currentIndex = newHistory.lastIndexOf(newActiveId);
  const newCursor = currentIndex !== -1
    ? currentIndex
    : Math.min(cursor, newHistory.length - 1);

  return { navHistory: newHistory, navCursor: newCursor };
}

function maybeOpenCompanionAgent(id: SceneTabId, tabs: SceneTab[]): SceneTab[] {
  if (id === AGENT_SCENE_ID || tabs.some((tab) => tab.id === AGENT_SCENE_ID)) {
    return tabs;
  }

  return [buildSceneTab(AGENT_SCENE_ID, 0), ...tabs];
}

function syncSceneToNav(sceneId: SceneTabId): void {
  const navSceneId = resolveNavSceneId(sceneId);
  const navStore = useNavSceneStore.getState();

  if (navSceneId) {
    navStore.openNavScene(navSceneId);
  } else {
    navStore.closeNavScene();
  }
}

const initialTabs = buildDefaultTabs();
const initialActiveId: SceneTabId = initialTabs[0]?.id ?? WELCOME_SCENE_ID;

export const useSceneStore = create<SceneState>((set, get) => ({
  openTabs: initialTabs,
  activeTabId: initialActiveId,
  navHistory: [initialActiveId],
  navCursor: 0,

  openScene: (id) => {
    if (id !== WELCOME_SCENE_ID) {
      const state = get();
      if (state.openTabs.some((tab) => tab.id === WELCOME_SCENE_ID)) {
        const tabsWithoutWelcome = state.openTabs.filter((tab) => tab.id !== WELCOME_SCENE_ID);
        const histWithoutWelcome = state.navHistory.filter((entry) => entry !== WELCOME_SCENE_ID);

        set({
          openTabs: ensureAgentFirst(maybeOpenCompanionAgent(id, tabsWithoutWelcome)),
          navHistory: histWithoutWelcome,
          navCursor: Math.max(0, histWithoutWelcome.length - 1),
        });
      }
    }

    const { openTabs, activeTabId, navHistory, navCursor } = get();

    if (id === activeTabId) {
      const navSceneId = resolveNavSceneId(id);
      const navStore = useNavSceneStore.getState();
      if (navSceneId && (!navStore.showSceneNav || navStore.navSceneId !== navSceneId)) {
        navStore.openNavScene(navSceneId);
      }
      return;
    }

    const histUpdate = pushHistory(navHistory, navCursor, id);

    if (openTabs.find((tab) => tab.id === id)) {
      set((state) => ({
        activeTabId: id,
        openTabs: state.openTabs.map((tab) =>
          tab.id === id ? { ...tab, lastUsed: Date.now() } : tab
        ),
        ...histUpdate,
      }));
      return;
    }

    const definition = getSceneDef(id);
    const isMiniappTab = typeof id === 'string' && id.startsWith('miniapp:');
    if (!definition && !isMiniappTab) {
      return;
    }

    let nextTabs = [...openTabs];

    if (nextTabs.length >= MAX_OPEN_SCENES) {
      const victim = selectOldestReplaceableTab(nextTabs);
      if (!victim) {
        return;
      }

      nextTabs = nextTabs.filter((tab) => tab.id !== victim.id);
      Object.assign(
        histUpdate,
        removeFromHistory(histUpdate.navHistory, histUpdate.navCursor, victim.id, id),
      );
    }

    nextTabs.push(buildSceneTab(id, Date.now()));
    set({ openTabs: ensureAgentFirst(nextTabs), activeTabId: id, ...histUpdate });
  },

  activateScene: (id) => {
    get().openScene(id);
  },

  closeScene: (id) => {
    const { openTabs, activeTabId, navHistory, navCursor } = get();
    if (!isClosableScene(id)) {
      return;
    }

    const nextTabs = openTabs.filter((tab) => tab.id !== id);

    let newActiveId = activeTabId;
    if (id === activeTabId) {
      if (nextTabs.length === 0) {
        set({ openTabs: [], activeTabId: '' as SceneTabId, navHistory: [], navCursor: -1 });
        return;
      }

      newActiveId = [...nextTabs].sort((a, b) => b.lastUsed - a.lastUsed)[0].id;
    }

    set({
      openTabs: ensureAgentFirst(nextTabs),
      activeTabId: newActiveId,
      ...removeFromHistory(navHistory, navCursor, id, newActiveId),
    });
  },

  goBack: () => {
    const { navHistory, navCursor, openTabs } = get();
    for (let index = navCursor - 1; index >= 0; index -= 1) {
      const targetId = navHistory[index];
      if (openTabs.some((tab) => tab.id === targetId)) {
        set((state) => ({
          navCursor: index,
          activeTabId: targetId,
          openTabs: state.openTabs.map((tab) =>
            tab.id === targetId ? { ...tab, lastUsed: Date.now() } : tab
          ),
        }));
        return;
      }
    }
  },

  goForward: () => {
    const { navHistory, navCursor, openTabs } = get();
    for (let index = navCursor + 1; index < navHistory.length; index += 1) {
      const targetId = navHistory[index];
      if (openTabs.some((tab) => tab.id === targetId)) {
        set((state) => ({
          navCursor: index,
          activeTabId: targetId,
          openTabs: state.openTabs.map((tab) =>
            tab.id === targetId ? { ...tab, lastUsed: Date.now() } : tab
          ),
        }));
        return;
      }
    }
  },
}));

export function selectCanGoBack(state: SceneState): boolean {
  const { navHistory, navCursor, openTabs } = state;
  for (let index = navCursor - 1; index >= 0; index -= 1) {
    if (openTabs.some((tab) => tab.id === navHistory[index])) {
      return true;
    }
  }
  return false;
}

export function selectCanGoForward(state: SceneState): boolean {
  const { navHistory, navCursor, openTabs } = state;
  for (let index = navCursor + 1; index < navHistory.length; index += 1) {
    if (openTabs.some((tab) => tab.id === navHistory[index])) {
      return true;
    }
  }
  return false;
}

if (typeof window !== 'undefined') {
  window.addEventListener('scene:open', (event: Event) => {
    const sceneId = (event as CustomEvent<{ sceneId: SceneTabId }>).detail?.sceneId;
    if (sceneId) {
      useSceneStore.getState().openScene(sceneId);
    }
  });
}

{
  let previousActiveId = useSceneStore.getState().activeTabId;
  useSceneStore.subscribe((state) => {
    if (state.activeTabId !== previousActiveId) {
      previousActiveId = state.activeTabId;
      syncSceneToNav(state.activeTabId);
    }
  });
}
