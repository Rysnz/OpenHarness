import {
  BarChart3,
  Boxes,
  CircleUserRound,
  ExternalLink,
  FileCode2,
  GitBranch,
  Globe,
  MessageSquare,
  Network,
  Puzzle,
  Settings,
  Terminal,
  User,
  Users,
} from 'lucide-react';
import type { SceneTabDef, SceneTabId } from '@/app/components/SceneBar/types';

export const MAX_OPEN_SCENES = 3;

type SceneCatalogItem = Omit<SceneTabDef, 'id'> & { id: SceneTabId };

const SCENE_CATALOG: SceneCatalogItem[] = [
  {
    id: 'welcome',
    label: 'Welcome',
    labelKey: 'welcomeScene.tabLabel',
    pinned: false,
    singleton: true,
    defaultOpen: true,
  },
  {
    id: 'session',
    label: 'Session',
    labelKey: 'scenes.aiAgent',
    Icon: MessageSquare,
    pinned: true,
    fixed: true,
    closable: false,
    singleton: true,
    defaultOpen: false,
  },
  {
    id: 'terminal',
    label: 'Terminal',
    Icon: Terminal,
    pinned: false,
    singleton: true,
    defaultOpen: false,
  },
  {
    id: 'git',
    label: 'Git',
    Icon: GitBranch,
    pinned: false,
    singleton: true,
    defaultOpen: false,
  },
  {
    id: 'settings',
    label: 'Settings',
    Icon: Settings,
    pinned: false,
    singleton: true,
    defaultOpen: false,
  },
  {
    id: 'file-viewer',
    label: 'File Viewer',
    Icon: FileCode2,
    pinned: false,
    singleton: true,
    defaultOpen: false,
  },
  {
    id: 'profile',
    label: 'Profile',
    Icon: CircleUserRound,
    pinned: false,
    singleton: true,
    defaultOpen: false,
  },
  {
    id: 'agents',
    label: 'Agents',
    labelKey: 'scenes.agents',
    Icon: Users,
    pinned: false,
    singleton: true,
    defaultOpen: false,
  },
  {
    id: 'skills',
    label: 'Skills',
    labelKey: 'scenes.skills',
    Icon: Puzzle,
    pinned: false,
    singleton: true,
    defaultOpen: false,
  },
  {
    id: 'miniapps',
    label: 'Mini App',
    labelKey: 'scenes.miniApps',
    Icon: Boxes,
    pinned: false,
    singleton: true,
    defaultOpen: false,
  },
  {
    id: 'browser',
    label: 'Browser',
    labelKey: 'scenes.browser',
    Icon: Globe,
    pinned: false,
    singleton: true,
    defaultOpen: false,
  },
  {
    id: 'mermaid',
    label: 'Mermaid',
    labelKey: 'scenes.mermaidEditor',
    Icon: Network,
    pinned: false,
    singleton: true,
    defaultOpen: false,
  },
  {
    id: 'partner',
    label: 'Partner',
    labelKey: 'scenes.partner',
    Icon: User,
    pinned: false,
    singleton: true,
    defaultOpen: false,
  },
  {
    id: 'insights',
    label: 'Insights',
    labelKey: 'scenes.insights',
    Icon: BarChart3,
    pinned: false,
    singleton: true,
    defaultOpen: false,
  },
  {
    id: 'shell',
    label: 'Shell',
    labelKey: 'scenes.shell',
    Icon: Terminal,
    pinned: false,
    singleton: true,
    defaultOpen: false,
  },
  {
    id: 'panel-view',
    label: 'Panel View',
    labelKey: 'scenes.panelView',
    Icon: ExternalLink,
    pinned: false,
    fixed: false,
    closable: true,
    singleton: true,
    defaultOpen: false,
  },
];

export const SCENE_TAB_REGISTRY: SceneTabDef[] = SCENE_CATALOG.map((scene) => ({ ...scene }));

const SCENE_DEFS_BY_ID = new Map<SceneTabId, SceneTabDef>(
  SCENE_TAB_REGISTRY.map((scene) => [scene.id, scene])
);

export function getSceneDef(id: SceneTabId): SceneTabDef | undefined {
  return SCENE_DEFS_BY_ID.get(id);
}

export const PANEL_VIEW_SCENE_DEF: SceneTabDef = getSceneDef('panel-view')!;

export function getMiniAppSceneDef(appId: string, appName?: string): SceneTabDef {
  return {
    id: `miniapp:${appId}`,
    label: appName ?? appId,
    Icon: Puzzle,
    pinned: false,
    fixed: false,
    closable: true,
    singleton: false,
    defaultOpen: false,
  };
}
