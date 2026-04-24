
import type { ShortcutConfig, ShortcutScope } from '@/shared/types/shortcut';

/**
 * A complete shortcut definition: default key binding + metadata.
 * The `descriptionKey` is an i18n key under the 'settings' namespace.
 */
export interface ShortcutDef {
  id: string;
  config: ShortcutConfig;
  /** i18n key for the human-readable shortcut description */
  descriptionKey: string;
}

/**
 * These bindings always use catalog defaults; user overrides in config are ignored
 * and the keyboard settings UI does not allow remapping them.
 */
export const NON_USER_CUSTOMIZABLE_SHORTCUT_IDS = new Set<string>([
  'scene.openSession',
  'chat.activateInput',
]);

// ─── Helpers ───────────────────────────────────────────────────────────────

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

type ShortcutExtras = Omit<ShortcutConfig, 'key' | 'scope'>;

function scoped(key: string, scope: ShortcutScope, extras: ShortcutExtras = {}): ShortcutConfig {
  return { key, scope, ...extras };
}

/** Build a ShortcutConfig using Ctrl (Win/Linux) or Meta (Mac) as the primary modifier. */
function mod(
  key: string,
  extras: Omit<ShortcutConfig, 'key' | 'ctrl' | 'meta'> = {}
): ShortcutConfig {
  return isMac ? { key, meta: true, ...extras } : { key, ctrl: true, ...extras };
}

/** Shortcut with no primary modifier (plain key, scope-aware). */
function plain(key: string, scope: ShortcutScope, allowInInput = false): ShortcutConfig {
  return scoped(key, scope, { allowInInput });
}

function shortcut(id: string, config: ShortcutConfig, descriptionKey: string): ShortcutDef {
  return { id, config, descriptionKey };
}

const numberedShortcuts = (
  prefix: string,
  keys: string[],
  configForKey: (key: string) => ShortcutConfig,
  descriptionKey: string
): ShortcutDef[] =>
  keys.map((key, index) => shortcut(`${prefix}${index + 1}`, configForKey(key), descriptionKey));

// ─── Global shortcuts (scope: 'app') ──────────────────────────────────────
// These fire regardless of where focus is, including inside input elements
// (where allowInInput: true) or from any scene. Use sparingly — only for
// navigation and layout operations that must always be reachable.

export const APP_SHORTCUTS: ShortcutDef[] = [
  // Panel layout
  {
    id: 'panel.toggleLeft',
    config: mod('B', { scope: 'app' }),
    descriptionKey: 'keyboard.shortcuts.panel.toggleLeft',
  },
  {
    id: 'panel.toggleBoth',
    config: mod('B', { shift: true, scope: 'app' }),
    descriptionKey: 'keyboard.shortcuts.panel.toggleBoth',
  },

  // Scene quick-open — jump to a named scene from anywhere
  {
    id: 'scene.openSession',
    config: mod('A', { shift: true, scope: 'app', allowInInput: true }),
    descriptionKey: 'keyboard.shortcuts.scene.openSession',
  },
  {
    id: 'scene.openGit',
    config: mod('G', { shift: true, scope: 'app', allowInInput: true }),
    descriptionKey: 'keyboard.shortcuts.scene.openGit',
  },
  {
    id: 'scene.openSettings',
    config: mod(',', { scope: 'app', allowInInput: true }),
    descriptionKey: 'keyboard.shortcuts.scene.openSettings',
  },

  // Left nav: workspace / session quick search (Alt+F is handled in MainNav without a second catalog id)
  {
    id: 'nav.toggleSearch',
    config: mod('k', { scope: 'app', allowInInput: true }),
    descriptionKey: 'keyboard.shortcuts.nav.toggleSearch',
  },
  {
    id: 'scene.openTerminal',
    config: mod('`', { shift: true, scope: 'app', allowInInput: true }),
    descriptionKey: 'keyboard.shortcuts.scene.openTerminal',
  },

  // App-level UI
  {
    id: 'app.closePreview',
    config: { key: 'Escape', scope: 'app', allowInInput: true },
    descriptionKey: 'keyboard.shortcuts.app.closePreview',
  },
];

// ─── Scene-bar navigation (scope: 'app', allowInInput: true) ──────────────
// Alt+1–3: switch between the top-level scene tabs; merged into one row in
// settings. Kept separate from APP_SHORTCUTS so the UI can merge them.

export const SCENE_SHORTCUTS: ShortcutDef[] = [
  ...numberedShortcuts(
    'scene.focus',
    ['1', '2', '3'],
    (key) => scoped(key, 'app', { alt: true, allowInInput: true }),
    'keyboard.shortcuts.scene.focusMerged'
  ),
];

// ─── Editor canvas shortcuts (scope: 'canvas') ────────────────────────────
// Active only when focus is inside the editor canvas area
// (data-shortcut-scope="canvas"). Tab-switch shortcuts retain allowInInput
// so they continue to work while a Monaco editor is focused.

export const CANVAS_SHORTCUTS: ShortcutDef[] = [
  // View
  {
    id: 'canvas.missionControl',
    config: mod('Tab', { scope: 'canvas', allowInInput: true }),
    descriptionKey: 'keyboard.shortcuts.canvas.missionControl',
  },
  {
    id: 'canvas.splitHorizontal',
    config: mod('\\', { scope: 'canvas' }),
    descriptionKey: 'keyboard.shortcuts.canvas.splitHorizontal',
  },
  {
    id: 'canvas.splitVertical',
    config: mod('\\', { shift: true, scope: 'canvas' }),
    descriptionKey: 'keyboard.shortcuts.canvas.splitVertical',
  },
  {
    id: 'canvas.anchorZone',
    config: mod('`', { scope: 'canvas' }),
    descriptionKey: 'keyboard.shortcuts.canvas.anchorZone',
  },
  {
    id: 'canvas.maximize',
    config: mod('M', { shift: true, scope: 'canvas' }),
    descriptionKey: 'keyboard.shortcuts.canvas.maximize',
  },
  {
    id: 'canvas.closePreview',
    config: { key: 'Escape', scope: 'canvas', allowInInput: true },
    descriptionKey: 'keyboard.shortcuts.canvas.closePreview',
  },

  // Tab management
  {
    id: 'tab.close',
    config: mod('W', { scope: 'canvas', allowInInput: true }),
    descriptionKey: 'keyboard.shortcuts.tab.close',
  },
  {
    id: 'tab.reopenClosed',
    config: mod('T', { shift: true, scope: 'canvas', allowInInput: true }),
    descriptionKey: 'keyboard.shortcuts.tab.reopenClosed',
  },
  ...numberedShortcuts(
    'tab.switch',
    ['1', '2', '3', '4', '5', '6', '7', '8'],
    (key) => mod(key, { scope: 'canvas', allowInInput: true }),
    'keyboard.shortcuts.tab.switchMerged'
  ),
  {
    id: 'tab.switchLast',
    config: mod('9', { scope: 'canvas', allowInInput: true }),
    descriptionKey: 'keyboard.shortcuts.tab.switchMerged',
  },
];

// ─── Chat shortcuts (scope: 'chat') ───────────────────────────────────────

export const CHAT_SHORTCUTS: ShortcutDef[] = [
  {
    id: 'btw-fill',
    config: { key: 'B', ctrl: true, alt: true, scope: 'chat', allowInInput: true },
    descriptionKey: 'keyboard.shortcuts.chat.btwFill',
  },
  {
    id: 'chat.stopGeneration',
    config: { key: 'Escape', scope: 'chat', allowInInput: true },
    descriptionKey: 'keyboard.shortcuts.chat.stopGeneration',
  },
  {
    id: 'chat.activateInput',
    config: plain(' ', 'chat', false),
    descriptionKey: 'keyboard.shortcuts.chat.activateInput',
  },
  {
    id: 'chat.newSession',
    config: mod('N', { scope: 'chat' }),
    descriptionKey: 'keyboard.shortcuts.chat.newSession',
  },
];

// ─── File tree shortcuts (scope: 'filetree') ──────────────────────────────

export const FILETREE_SHORTCUTS: ShortcutDef[] = [
  {
    id: 'filetree.rename',
    config: { key: 'F2', scope: 'filetree' },
    descriptionKey: 'keyboard.shortcuts.filetree.rename',
  },
  {
    id: 'filetree.delete',
    config: { key: 'Delete', scope: 'filetree' },
    descriptionKey: 'keyboard.shortcuts.filetree.delete',
  },
  {
    id: 'filetree.refresh',
    config: { key: 'F5', scope: 'filetree' },
    descriptionKey: 'keyboard.shortcuts.filetree.refresh',
  },
  {
    id: 'filetree.newFile',
    config: mod('N', { scope: 'filetree' }),
    descriptionKey: 'keyboard.shortcuts.filetree.newFile',
  },
  {
    id: 'filetree.newFolder',
    config: mod('N', { shift: true, scope: 'filetree' }),
    descriptionKey: 'keyboard.shortcuts.filetree.newFolder',
  },
  {
    id: 'filetree.collapseAll',
    config: mod('[', { shift: true, scope: 'filetree' }),
    descriptionKey: 'keyboard.shortcuts.filetree.collapseAll',
  },
];

// ─── Git shortcuts (scope: 'git') ─────────────────────────────────────────

export const GIT_SHORTCUTS: ShortcutDef[] = [
  {
    id: 'git.commit',
    config: mod('Enter', { scope: 'git', allowInInput: true }),
    descriptionKey: 'keyboard.shortcuts.git.commit',
  },
  {
    id: 'git.refresh',
    config: { key: 'F5', scope: 'git' },
    descriptionKey: 'keyboard.shortcuts.git.refresh',
  },
  {
    id: 'git.stageAll',
    config: mod('A', { shift: true, scope: 'git' }),
    descriptionKey: 'keyboard.shortcuts.git.stageAll',
  },
  {
    id: 'git.unstageAll',
    config: mod('U', { shift: true, scope: 'git' }),
    descriptionKey: 'keyboard.shortcuts.git.unstageAll',
  },
  {
    id: 'git.push',
    config: mod('P', { shift: true, scope: 'git' }),
    descriptionKey: 'keyboard.shortcuts.git.push',
  },
  {
    id: 'git.pull',
    config: mod('L', { shift: true, scope: 'git' }),
    descriptionKey: 'keyboard.shortcuts.git.pull',
  },
];

// ─── All shortcuts combined ────────────────────────────────────────────────

export const ALL_SHORTCUTS: ShortcutDef[] = [
  ...APP_SHORTCUTS,
  ...SCENE_SHORTCUTS,
  ...CANVAS_SHORTCUTS,
  ...CHAT_SHORTCUTS,
  ...FILETREE_SHORTCUTS,
  ...GIT_SHORTCUTS,
];

/** Shortcuts registered in code but not listed in ALL_SHORTCUTS (e.g. legacy ids). */
const EXTRA_SHORTCUT_DESCRIPTION_KEYS: Record<string, string> = {};

/**
 * Resolve the i18n key (settings namespace) for a shortcut id.
 * Used by the keyboard settings UI so labels always match known definitions.
 */
export function getShortcutDescriptionI18nKey(id: string): string | undefined {
  const fromCatalog = ALL_SHORTCUTS.find((d) => d.id === id)?.descriptionKey;
  if (fromCatalog) return fromCatalog;
  return EXTRA_SHORTCUT_DESCRIPTION_KEYS[id];
}

/** Scope display order for the settings UI. */
export const SCOPE_ORDER: ShortcutScope[] = ['app', 'chat', 'canvas', 'filetree', 'git'];

/** i18n keys for scope group labels in the settings UI. */
export const SCOPE_LABEL_KEYS: Record<ShortcutScope, string> = {
  app:      'keyboard.scopes.app',
  chat:     'keyboard.scopes.chat',
  canvas:   'keyboard.scopes.canvas',
  filetree: 'keyboard.scopes.filetree',
  git:      'keyboard.scopes.git',
};
