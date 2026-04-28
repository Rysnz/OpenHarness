/**
 * Editor options builder.
 * Converts config to Monaco options, handles special field transforms
 * (e.g., lineHeight calculation), and merges preset and runtime config.
 */

import type * as monaco from 'monaco-editor';
import type {
  EditorConfig,
  EditorConfigPartial,
  EditorPresetConfig,
  EditorPresetName,
} from '../config/types';
import { DEFAULT_EDITOR_CONFIG, mergeConfig } from '../config/defaults';
import { getPreset } from '../config/presets';
import { themeManager } from './ThemeManager';

export interface EditorOptionsInput {
  config?: EditorConfigPartial;
  preset?: EditorPresetName;
  /** Runtime overrides from component props */
  overrides?: EditorOptionsOverrides;
}

export interface EditorOptionsOverrides {
  readOnly?: boolean;
  lineNumbers?: boolean | 'on' | 'off' | 'relative' | 'interval';
  minimap?: boolean;
  fontSize?: number;
  tabSize?: number;
  wordWrap?: 'off' | 'on' | 'wordWrapColumn' | 'bounded';
  theme?: string;
  language?: string;
}

/**
 * Build Monaco editor options from config, preset, and overrides.
 * Merge order: defaults <- preset <- user config <- runtime overrides.
 */
export function buildEditorOptions(
  input: EditorOptionsInput = {}
): monaco.editor.IStandaloneEditorConstructionOptions {
  const presetConfig = resolvePreset(input.preset);
  const mergedConfig = mergeEditorConfig(presetConfig, input.config);
  const finalConfig = applyOverrides(mergedConfig, input.overrides);

  return convertToMonacoOptions(finalConfig, presetConfig);
}

function resolvePreset(preset?: EditorPresetName): EditorPresetConfig {
  return preset ? getPreset(preset) : {};
}

function mergeEditorConfig(
  presetConfig: EditorPresetConfig,
  config?: EditorConfigPartial
): EditorConfig {
  return mergeConfig(
    mergeConfig(DEFAULT_EDITOR_CONFIG, presetConfig as EditorConfigPartial),
    config
  );
}

function applyOverrides(
  config: EditorConfig,
  overrides?: EditorOptionsOverrides
): EditorConfig {
  if (!overrides) {
    return config;
  }

  const result = { ...config };
  applyLineNumberOverride(result, overrides.lineNumbers);

  if (overrides.minimap !== undefined) {
    result.minimap = {
      ...result.minimap,
      enabled: overrides.minimap,
    };
  }

  if (overrides.fontSize !== undefined) {
    result.fontSize = overrides.fontSize;
  }
  if (overrides.tabSize !== undefined) {
    result.tabSize = overrides.tabSize;
  }
  if (overrides.wordWrap !== undefined) {
    result.wordWrap = overrides.wordWrap;
  }
  if (overrides.theme !== undefined) {
    result.theme = overrides.theme;
  }

  return result;
}

function applyLineNumberOverride(
  config: EditorConfig,
  lineNumbers: EditorOptionsOverrides['lineNumbers']
): void {
  if (lineNumbers === undefined) {
    return;
  }

  config.lineNumbers =
    typeof lineNumbers === 'boolean' ? (lineNumbers ? 'on' : 'off') : lineNumbers;
}

function calculateLineHeight(config: EditorConfig): number {
  return config.lineHeight ? Math.round(config.fontSize * config.lineHeight) : 0;
}

function buildTypographyOptions(
  config: EditorConfig
): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    fontSize: config.fontSize,
    fontFamily: config.fontFamily,
    fontWeight: config.fontWeight,
    lineHeight: calculateLineHeight(config),
    cursorStyle: config.cursorStyle,
    cursorBlinking: config.cursorBlinking,
    renderWhitespace: config.renderWhitespace,
    renderLineHighlight: config.renderLineHighlight,
  };
}

function buildEditingOptions(
  config: EditorConfig,
  presetConfig: EditorPresetConfig
): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    readOnly: presetConfig.readOnly ?? false,
    tabSize: config.tabSize,
    insertSpaces: config.insertSpaces,
    wordWrap: config.wordWrap,
    scrollBeyondLastLine: config.scrollBeyondLastLine,
    smoothScrolling: config.smoothScrolling,
    lineNumbers: config.lineNumbers,
    lineNumbersMinChars: 3,
    lineDecorationsWidth: 0,
    glyphMargin: false,
    showFoldingControls: 'never',
  };
}

function buildFeatureOptions(
  config: EditorConfig,
  presetConfig: EditorPresetConfig
): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    contextmenu: presetConfig.contextmenu ?? true,
    links: presetConfig.links ?? true,
    folding: presetConfig.folding ?? true,
    codeLens: presetConfig.codeLens ?? true,
    'semanticHighlighting.enabled': config.semanticHighlighting,
    bracketPairColorization: {
      enabled: config.bracketPairColorization,
      independentColorPoolPerBracketType: true,
    },
    guides: {
      indentation: config.guides.indentation,
      bracketPairs: config.guides.bracketPairs,
      bracketPairsHorizontal: normalizeBracketPairHorizontal(
        config.guides.bracketPairsHorizontal
      ),
      highlightActiveBracketPair: config.guides.highlightActiveBracketPair,
      highlightActiveIndentation: config.guides.highlightActiveIndentation,
    },
  };
}

function normalizeBracketPairHorizontal(value: string): boolean | 'active' {
  if (value === 'active') {
    return 'active';
  }

  return value === 'true';
}

function buildChromeOptions(
  config: EditorConfig
): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    minimap: {
      enabled: config.minimap.enabled,
      side: config.minimap.side,
      size: config.minimap.size,
    },
    scrollbar: {
      vertical: config.scrollbar.vertical,
      horizontal: config.scrollbar.horizontal,
      verticalScrollbarSize: config.scrollbar.verticalScrollbarSize,
      horizontalScrollbarSize: config.scrollbar.horizontalScrollbarSize,
      useShadows: config.scrollbar.useShadows,
    },
    hover: {
      enabled: config.hover.enabled,
      delay: config.hover.delay,
      sticky: config.hover.sticky,
      above: config.hover.above,
    },
  };
}

function buildIntelligenceOptions(
  config: EditorConfig
): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    suggest: {
      showKeywords: config.suggest.showKeywords,
      showSnippets: config.suggest.showSnippets,
      preview: config.suggest.preview,
      showInlineDetails: config.suggest.showInlineDetails,
    },
    quickSuggestions: {
      other: config.quickSuggestions.other,
      comments: config.quickSuggestions.comments,
      strings: config.quickSuggestions.strings,
    },
    inlayHints: {
      enabled: config.inlayHints.enabled,
      fontSize: config.inlayHints.fontSize,
      fontFamily: config.inlayHints.fontFamily,
      padding: config.inlayHints.padding,
    },
    gotoLocation: {
      multipleDefinitions: 'goto',
      multipleTypeDefinitions: 'goto',
      multipleDeclarations: 'goto',
      multipleImplementations: 'goto',
      multipleReferences: 'goto',
    },
  };
}

function buildRenderingGuards(): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    multiCursorModifier: 'alt',
    definitionLinkOpensInPeek: false,
    renderControlCharacters: false,
    renderValidationDecorations: 'on',
    renderFinalNewline: 'on',
    roundedSelection: false,
    disableMonospaceOptimizations: true,
    fontLigatures: false,
    stopRenderingLineAfter: -1,
  };
}

function convertToMonacoOptions(
  config: EditorConfig,
  presetConfig: EditorPresetConfig
): monaco.editor.IStandaloneEditorConstructionOptions {
  const themeId = config.theme || themeManager.getCurrentThemeId();

  return {
    theme: themeId,
    automaticLayout: true,
    ...buildTypographyOptions(config),
    ...buildEditingOptions(config, presetConfig),
    ...buildChromeOptions(config),
    ...buildFeatureOptions(config, presetConfig),
    ...buildIntelligenceOptions(config),
    ...buildRenderingGuards(),
  };
}

export function buildDiffEditorOptions(
  input: EditorOptionsInput = {}
): monaco.editor.IStandaloneDiffEditorConstructionOptions {
  const baseOptions = buildEditorOptions({
    ...input,
    preset: input.preset || 'diff',
  });

  return {
    ...baseOptions,
    renderSideBySide: true,
    renderOverviewRuler: false,
    renderIndicators: true,
    renderMarginRevertIcon: true,
    renderGutterMenu: true,
    originalEditable: false,
    ignoreTrimWhitespace: false,
    diffWordWrap: baseOptions.wordWrap as any,
    diffAlgorithm: 'advanced',
    enableSplitViewResizing: true,
    hideUnchangedRegions: {
      enabled: true,
      contextLineCount: 3,
      minimumLineCount: 5,
      revealLineCount: 20,
    },
  };
}

/** Build partial options for dynamic editor updates. */
export function buildUpdateOptions(
  config: EditorConfigPartial
): monaco.editor.IEditorOptions {
  const options: monaco.editor.IEditorOptions = {};

  if (config.fontSize !== undefined) {
    options.fontSize = config.fontSize;
  }
  if (config.fontFamily !== undefined) {
    options.fontFamily = config.fontFamily;
  }
  if (config.lineHeight !== undefined && config.fontSize !== undefined) {
    options.lineHeight = Math.round(config.fontSize * config.lineHeight);
  }
  if (config.tabSize !== undefined) {
    (options as any).tabSize = config.tabSize;
  }
  if (config.wordWrap !== undefined) {
    options.wordWrap = config.wordWrap;
  }
  if (config.lineNumbers !== undefined) {
    options.lineNumbers = config.lineNumbers;
  }
  if (config.minimap !== undefined) {
    options.minimap = config.minimap;
  }
  if (config.renderWhitespace !== undefined) {
    options.renderWhitespace = config.renderWhitespace;
  }
  if (config.renderLineHighlight !== undefined) {
    options.renderLineHighlight = config.renderLineHighlight;
  }

  return options;
}
