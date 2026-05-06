import type { EditorPresetConfig, EditorPresetName } from './types';

const DEFAULT_MINIMAP = {
  enabled: true,
  side: 'right' as const,
  size: 'proportional' as const,
};

const DISABLED_MINIMAP = {
  ...DEFAULT_MINIMAP,
  enabled: false,
};

const DISABLED_INLAY_HINTS = {
  enabled: 'off' as const,
  fontSize: 12,
  fontFamily: "'Fira Code', Consolas, 'Courier New', monospace",
  padding: false,
};

const BASE_INTERACTIVE_PRESET = {
  readOnly: false,
  contextmenu: true,
  links: true,
} satisfies EditorPresetConfig;

export const PRESET_READONLY: EditorPresetConfig = {
  readOnly: true,
  enableLsp: false,
  contextmenu: false,
  links: true,
  folding: true,
  codeLens: false,
  minimap: DISABLED_MINIMAP,
  lineNumbers: 'on',
  renderLineHighlight: 'none',
  formatOnSave: false,
  formatOnPaste: false,
  hover: {
    enabled: true,
    delay: 300,
    sticky: false,
    above: false,
  },
  inlayHints: DISABLED_INLAY_HINTS,
};

export const PRESET_MINIMAL: EditorPresetConfig = {
  ...BASE_INTERACTIVE_PRESET,
  enableLsp: false,
  folding: false,
  codeLens: false,
  minimap: DISABLED_MINIMAP,
  lineNumbers: 'on',
  semanticHighlighting: false,
  inlayHints: DISABLED_INLAY_HINTS,
};

export const PRESET_STANDARD: EditorPresetConfig = {
  ...BASE_INTERACTIVE_PRESET,
  enableLsp: true,
  folding: true,
  codeLens: true,
  minimap: DEFAULT_MINIMAP,
  lineNumbers: 'on',
};

export const PRESET_FULL: EditorPresetConfig = {
  ...PRESET_STANDARD,
  semanticHighlighting: true,
  bracketPairColorization: true,
  hover: {
    enabled: true,
    delay: 100,
    sticky: true,
    above: false,
  },
  inlayHints: {
    ...DISABLED_INLAY_HINTS,
    enabled: 'on',
  },
  guides: {
    indentation: true,
    bracketPairs: true,
    bracketPairsHorizontal: 'active',
    highlightActiveBracketPair: true,
    highlightActiveIndentation: true,
  },
};

export const PRESET_DIFF: EditorPresetConfig = {
  ...BASE_INTERACTIVE_PRESET,
  enableLsp: true,
  contextmenu: false,
  folding: false,
  codeLens: false,
  minimap: DISABLED_MINIMAP,
  lineNumbers: 'on',
  renderWhitespace: 'selection',
  scrollBeyondLastLine: false,
};

export const EDITOR_PRESETS: Record<EditorPresetName, EditorPresetConfig> = {
  readonly: PRESET_READONLY,
  minimal: PRESET_MINIMAL,
  standard: PRESET_STANDARD,
  full: PRESET_FULL,
  diff: PRESET_DIFF,
};

export function getPreset(presetName: EditorPresetName): EditorPresetConfig {
  return EDITOR_PRESETS[presetName];
}

export function getPresetNames(): EditorPresetName[] {
  return Object.keys(EDITOR_PRESETS) as EditorPresetName[];
}
