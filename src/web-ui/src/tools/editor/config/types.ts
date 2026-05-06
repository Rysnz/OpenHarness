export type MinimapSide = 'left' | 'right';
export type MinimapSize = 'proportional' | 'fill' | 'fit';
export type BooleanishMode = 'active' | 'true' | 'false';
export type ScrollbarVisibility = 'auto' | 'visible' | 'hidden';
export type InlayHintsMode = 'on' | 'off' | 'offUnlessPressed' | 'onUnlessPressed';
export type EditorFontWeight = 'normal' | 'bold';
export type EditorCursorStyle =
  | 'line'
  | 'block'
  | 'underline'
  | 'line-thin'
  | 'block-outline'
  | 'underline-thin';
export type EditorCursorBlinking = 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
export type EditorWhitespaceRendering = 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
export type EditorLineHighlight = 'none' | 'gutter' | 'line' | 'all';
export type EditorWordWrap = 'off' | 'on' | 'wordWrapColumn' | 'bounded';
export type EditorAutoSave = 'off' | 'afterDelay' | 'onFocusChange' | 'onWindowChange';
export type EditorLineNumbers = 'on' | 'off' | 'relative' | 'interval';
export type EditorPresetName = 'readonly' | 'minimal' | 'standard' | 'full' | 'diff';

export interface MinimapConfig {
  enabled: boolean;
  side: MinimapSide;
  size: MinimapSize;
}

export interface GuidesConfig {
  indentation: boolean;
  bracketPairs: boolean;
  bracketPairsHorizontal: BooleanishMode;
  highlightActiveBracketPair: boolean;
  highlightActiveIndentation: boolean;
}

export interface ScrollbarConfig {
  vertical: ScrollbarVisibility;
  horizontal: ScrollbarVisibility;
  verticalScrollbarSize: number;
  horizontalScrollbarSize: number;
  useShadows: boolean;
}

export interface HoverConfig {
  enabled: boolean;
  delay: number;
  sticky: boolean;
  above: boolean;
}

export interface SuggestConfig {
  showKeywords: boolean;
  showSnippets: boolean;
  preview: boolean;
  showInlineDetails: boolean;
}

export interface QuickSuggestionsConfig {
  other: boolean;
  comments: boolean;
  strings: boolean;
}

export interface InlayHintsConfig {
  enabled: InlayHintsMode;
  fontSize: number;
  fontFamily: string;
  padding: boolean;
}

export interface EditorConfig {
  fontSize: number;
  fontFamily: string;
  fontWeight: EditorFontWeight;
  lineHeight: number;
  theme: string;
  cursorStyle: EditorCursorStyle;
  cursorBlinking: EditorCursorBlinking;
  renderWhitespace: EditorWhitespaceRendering;
  renderLineHighlight: EditorLineHighlight;

  tabSize: number;
  insertSpaces: boolean;
  wordWrap: EditorWordWrap;
  autoSave: EditorAutoSave;
  autoSaveDelay: number;
  scrollBeyondLastLine: boolean;
  smoothScrolling: boolean;

  lineNumbers: EditorLineNumbers;
  minimap: MinimapConfig;
  formatOnSave: boolean;
  formatOnPaste: boolean;
  trimAutoWhitespace: boolean;

  semanticHighlighting: boolean;
  bracketPairColorization: boolean;
  guides: GuidesConfig;
  scrollbar: ScrollbarConfig;
  hover: HoverConfig;
  suggest: SuggestConfig;
  quickSuggestions: QuickSuggestionsConfig;
  inlayHints: InlayHintsConfig;
}

export type EditorConfigPartial = Partial<EditorConfig> & {
  minimap?: Partial<MinimapConfig>;
  guides?: Partial<GuidesConfig>;
  scrollbar?: Partial<ScrollbarConfig>;
  hover?: Partial<HoverConfig>;
  suggest?: Partial<SuggestConfig>;
  quickSuggestions?: Partial<QuickSuggestionsConfig>;
  inlayHints?: Partial<InlayHintsConfig>;
};

export interface EditorPresetConfig extends EditorConfigPartial {
  readOnly?: boolean;
  enableLsp?: boolean;
  contextmenu?: boolean;
  links?: boolean;
  folding?: boolean;
  codeLens?: boolean;
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface EditorConfigChangeEvent {
  previousConfig: EditorConfig;
  currentConfig: EditorConfig;
  changedKeys: (keyof EditorConfig)[];
}
