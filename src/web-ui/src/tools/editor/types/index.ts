import type { CSSProperties } from 'react';

export type {
  EditorConfig,
  EditorConfigPartial,
  EditorPresetName,
  EditorPresetConfig,
  MinimapConfig,
  GuidesConfig,
  ScrollbarConfig,
  HoverConfig,
  SuggestConfig,
  QuickSuggestionsConfig,
  InlayHintsConfig,
  DeepPartial,
  EditorConfigChangeEvent,
} from '../config/types';

export type LineEnding = 'lf' | 'crlf' | 'auto';
export type EditorActionType = 'insert' | 'delete' | 'replace' | 'format';
export type EditorThemeType = 'light' | 'dark' | 'high-contrast';
export type MarkdownPreviewPosition = 'right' | 'bottom';
export type MarkdownTheme = 'light' | 'dark' | 'nord';

export interface Position {
  line: number;
  column: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface FileContent {
  name: string;
  content: string;
  language: string;
  encoding?: string;
  lineEnding?: LineEnding;
  isReadOnly?: boolean;
  isDirty?: boolean;
  lastModified?: Date;
  size?: number;
}

export interface SearchResult {
  fileIndex: number;
  line: number;
  column: number;
  length: number;
  match: string;
  context: string;
}

export interface EditorState {
  openFiles: FileContent[];
  activeFileIndex: number;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  replaceQuery: string;
  searchResults: SearchResult[];
  currentSearchIndex: number;
}

export interface EditorAction {
  type: EditorActionType;
  position: Position;
  content?: string;
  range?: Range;
  timestamp: Date;
}

type EditorEventMap = {
  'file:opened': FileContent;
  'file:closed': { index: number };
  'file:saved': { index: number; content: string };
  'file:changed': { index: number; content: string };
  'file:save-error': { index: number; fileName: string; error: string };
  'selection:changed': { range: Range };
  'cursor:moved': { position: Position };
  'search:performed': { query: string; results: SearchResult[] };
  'config:changed': Record<string, unknown>;
};

export type EditorEvent = {
  [Type in keyof EditorEventMap]: {
    type: Type;
    payload: EditorEventMap[Type];
  }
}[keyof EditorEventMap];

export interface EditorProps {
  content?: string;
  fileName?: string;
  language?: string;
  readOnly?: boolean;
  onContentChange?: (content: string) => void;
  onSave?: (content: string) => void;
  onSelectionChange?: (range: Range) => void;
  onCursorMove?: (position: Position) => void;
  className?: string;
  style?: CSSProperties;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  fileIndex?: number;
}

export interface ReplaceOptions extends SearchOptions {
  replaceAll?: boolean;
}

export interface IEditorManager {
  openFile(file: FileContent): Promise<number>;
  closeFile(index: number): Promise<void>;
  saveFile(index: number): Promise<void>;
  saveAllFiles(): Promise<void>;
  getActiveFile(): FileContent | null;
  getFile(index: number): FileContent | null;
  getAllFiles(): FileContent[];
  isFileDirty(index: number): boolean;
  search(query: string, options?: SearchOptions): SearchResult[];
  replace(query: string, replacement: string, options?: ReplaceOptions): number;
  addEventListener(listener: (event: EditorEvent) => void): () => void;
}

export interface UseEditorReturn {
  openFiles: FileContent[];
  activeFile: FileContent | null;
  activeFileIndex: number;
  isLoading: boolean;
  error: string | null;
  searchResults: SearchResult[];
  openFile: (file: FileContent) => Promise<number>;
  closeFile: (index: number) => Promise<void>;
  saveFile: (index?: number) => Promise<void>;
  switchToFile: (index: number) => void;
  updateFileContent: (index: number, content: string) => void;
  search: (query: string, options?: SearchOptions) => SearchResult[];
  replace: (query: string, replacement: string, options?: ReplaceOptions) => number;
  clearError: () => void;
}

export interface LanguageDetectionResult {
  language: string;
  confidence: number;
  detected: boolean;
}

export interface EditorTheme {
  id: string;
  name: string;
  type: EditorThemeType;
  colors: {
    background: string;
    foreground: string;
    selection: string;
    lineHighlight: string;
    cursor: string;
    gutter: string;
    gutterForeground: string;
  };
  tokenColors: TokenColor[];
}

export interface TokenColor {
  name: string;
  scope: string | string[];
  settings: {
    foreground?: string;
    background?: string;
    fontStyle?: 'italic' | 'bold' | 'underline';
  };
}

export interface CompletionItem {
  label: string;
  kind: CompletionItemKind;
  detail?: string;
  documentation?: string;
  insertText: string;
  range: Range;
}

export enum CompletionItemKind {
  Text = 1,
  Method = 2,
  Function = 3,
  Constructor = 4,
  Field = 5,
  Variable = 6,
  Class = 7,
  Interface = 8,
  Module = 9,
  Property = 10,
  Unit = 11,
  Value = 12,
  Enum = 13,
  Keyword = 14,
  Snippet = 15,
  Color = 16,
  File = 17,
  Reference = 18,
  Folder = 19,
  EnumMember = 20,
  Constant = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25
}

export interface Diagnostic {
  range: Range;
  severity: DiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
  relatedInformation?: DiagnosticRelatedInformation[];
}

export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4
}

export interface DiagnosticRelatedInformation {
  location: {
    uri: string;
    range: Range;
  };
  message: string;
}

export interface MarkdownEditorConfig {
  showPreview: boolean;
  previewPosition: MarkdownPreviewPosition;
  enableAutoSave: boolean;
  autoSaveDelay: number;
  theme: MarkdownTheme;
  fontSize: number;
  lineHeight: number;
  enableSpellCheck: boolean;
  enableTableOfContents: boolean;
}

export interface MarkdownEditorProps {
  content?: string;
  fileName?: string;
  filePath?: string;
  workspacePath?: string;
  readOnly?: boolean;
  config?: Partial<MarkdownEditorConfig>;
  onContentChange?: (content: string, hasChanges: boolean) => void;
  onSave?: (content: string) => void;
  className?: string;
  style?: CSSProperties;
}

export interface MarkdownRenderOptions {
  enableGFM: boolean;
  enableMath: boolean;
  enableDiagram: boolean;
  enableCodeHighlight: boolean;
  codeTheme: string;
}

export interface MarkdownMetadata {
  title?: string;
  author?: string;
  date?: Date;
  tags?: string[];
  description?: string;
  wordCount?: number;
  readingTime?: number;
}
