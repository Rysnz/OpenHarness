/**
 * Workspace management feature contracts.
 */

import type React from 'react';

export type WorkspaceLineEnding = 'auto' | 'lf' | 'crlf';
export type FileSystemItemType = 'file' | 'directory';
export type FileWatchEventType = 'created' | 'modified' | 'deleted' | 'renamed';
export type WorkspaceSortField = 'name' | 'type' | 'size' | 'modified';
export type SortOrder = 'asc' | 'desc';

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  lastOpened: Date;
  settings?: WorkspaceSettings;
  metadata?: WorkspaceMetadata;
}

export interface WorkspaceSettings {
  excludePatterns: string[];
  includePatterns: string[];
  watchIgnore: string[];
  maxFileSize: number;
  encoding: string;
  lineEnding: WorkspaceLineEnding;
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
  autoSave: boolean;
  autoSaveDelay: number;
  fileAssociations: Record<string, string>;
  searchExclude: string[];
  filesExclude: string[];
}

export interface WorkspaceMetadata {
  description?: string;
  version?: string;
  author?: string;
  createdAt: Date;
  lastModified: Date;
  fileCount?: number;
  totalSize?: number;
  languages?: string[];
  gitRepository?: GitRepositoryInfo;
}

export interface GitRepositoryInfo {
  url: string;
  branch: string;
  commit: string;
  isDirty: boolean;
  hasUnpushedCommits: boolean;
}

export interface FilePermissions {
  readable: boolean;
  writable: boolean;
  executable: boolean;
}

export interface FileSystemItem {
  id: string;
  name: string;
  path: string;
  type: FileSystemItemType;
  size?: number;
  lastModified: Date;
  isHidden: boolean;
  children?: FileSystemItem[];
  extension?: string;
  language?: string;
  encoding?: string;
  permissions?: FilePermissions;
}

export interface WorkspaceState {
  currentWorkspace: Workspace | null;
  recentWorkspaces: Workspace[];
  fileTree: FileSystemItem[];
  selectedItems: string[];
  expandedItems: string[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  searchResults: FileSystemItem[];
  isSearching: boolean;
}

interface WorkspaceEventPayloads {
  'workspace:opened': Workspace;
  'workspace:closed': { workspaceId: string };
  'workspace:changed': Workspace;
  'file:created': FileSystemItem;
  'file:deleted': { path: string };
  'file:renamed': { oldPath: string; newPath: string };
  'file:modified': FileSystemItem;
  'directory:created': FileSystemItem;
  'directory:deleted': { path: string };
  'search:started': { query: string };
  'search:completed': { query: string; results: FileSystemItem[] };
  'error:occurred': { error: string };
}

export type WorkspaceEvent = {
  [Type in keyof WorkspaceEventPayloads]: {
    type: Type;
    payload: WorkspaceEventPayloads[Type];
  };
}[keyof WorkspaceEventPayloads];

export interface FileOperationOptions {
  overwrite?: boolean;
  recursive?: boolean;
  preserveTimestamps?: boolean;
  encoding?: string;
}

export interface WorkspaceSearchOptions {
  includePatterns?: string[];
  excludePatterns?: string[];
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  includeHidden?: boolean;
  maxResults?: number;
  maxDepth?: number;
}

export interface FileWatchOptions {
  recursive?: boolean;
  ignorePatterns?: string[];
  debounceDelay?: number;
}

export interface IWorkspaceManager {
  openWorkspace(path: string): Promise<Workspace>;
  closeWorkspace(): Promise<void>;
  getCurrentWorkspace(): Workspace | null;
  getRecentWorkspaces(): Workspace[];

  getFileTree(path?: string): Promise<FileSystemItem[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string, options?: FileOperationOptions): Promise<void>;
  createFile(path: string, content?: string): Promise<FileSystemItem>;
  deleteFile(path: string): Promise<void>;
  renameFile(oldPath: string, newPath: string): Promise<void>;
  copyFile(sourcePath: string, destPath: string, options?: FileOperationOptions): Promise<void>;

  createDirectory(path: string): Promise<FileSystemItem>;
  deleteDirectory(path: string, recursive?: boolean): Promise<void>;
  listDirectory(path: string): Promise<FileSystemItem[]>;

  searchFiles(query: string, options?: WorkspaceSearchOptions): Promise<FileSystemItem[]>;
  searchInFiles(query: string, options?: WorkspaceSearchOptions): Promise<SearchInFilesResult[]>;

  watchFile(path: string, callback: (event: FileWatchEvent) => void, options?: FileWatchOptions): () => void;
  watchDirectory(path: string, callback: (event: FileWatchEvent) => void, options?: FileWatchOptions): () => void;

  getWorkspaceSettings(): WorkspaceSettings;
  updateWorkspaceSettings(settings: Partial<WorkspaceSettings>): Promise<void>;

  addEventListener(listener: (event: WorkspaceEvent) => void): () => void;
}

export interface FileWatchEvent {
  type: FileWatchEventType;
  path: string;
  newPath?: string;
  timestamp: Date;
}

export interface SearchInFilesResult {
  file: FileSystemItem;
  matches: SearchMatch[];
  totalMatches: number;
}

export interface SearchMatch {
  line: number;
  column: number;
  length: number;
  text: string;
  context: string;
}

export interface WorkspaceExplorerProps {
  onFileSelect?: (file: FileSystemItem) => void;
  onDirectorySelect?: (directory: FileSystemItem) => void;
  onFileOpen?: (file: FileSystemItem) => void;
  onFileContextMenu?: (file: FileSystemItem, event: React.MouseEvent) => void;
  showHidden?: boolean;
  sortBy?: WorkspaceSortField;
  sortOrder?: SortOrder;
  className?: string;
}

export interface FileTreeProps {
  items: FileSystemItem[];
  selectedItems: string[];
  expandedItems: string[];
  onItemSelect?: (item: FileSystemItem) => void;
  onItemExpand?: (item: FileSystemItem, expanded: boolean) => void;
  onItemContextMenu?: (item: FileSystemItem, event: React.MouseEvent) => void;
  renderItem?: (item: FileSystemItem) => React.ReactNode;
  className?: string;
}

export interface UseWorkspaceReturn extends Pick<
  WorkspaceState,
  | 'currentWorkspace'
  | 'recentWorkspaces'
  | 'fileTree'
  | 'selectedItems'
  | 'loading'
  | 'error'
  | 'searchResults'
  | 'isSearching'
> {
  openWorkspace: (path: string) => Promise<Workspace>;
  closeWorkspace: () => Promise<void>;
  refreshFileTree: () => Promise<void>;
  selectItem: (itemId: string, multi?: boolean) => void;
  expandItem: (itemId: string, expanded: boolean) => void;
  createFile: (path: string, content?: string) => Promise<FileSystemItem>;
  createDirectory: (path: string) => Promise<FileSystemItem>;
  deleteItem: (path: string) => Promise<void>;
  renameItem: (oldPath: string, newPath: string) => Promise<void>;
  searchFiles: (query: string, options?: WorkspaceSearchOptions) => Promise<FileSystemItem[]>;
  clearError: () => void;
}

export interface FileContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  action: (item: FileSystemItem) => void;
  separator?: boolean;
  disabled?: boolean;
  submenu?: FileContextMenuItem[];
}

export interface WorkspaceConfig {
  maxFileSize: number;
  maxSearchResults: number;
  watcherIgnorePatterns: string[];
  autoRefreshInterval: number;
  enableFileWatcher: boolean;
  showHiddenFiles: boolean;
  sortFilesBy: WorkspaceSortField;
  sortOrder: SortOrder;
}

export interface WorkspaceStats {
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  filesByType: Record<string, number>;
  largestFiles: Array<{ path: string; size: number }>;
  recentlyModified: Array<{ path: string; modified: Date }>;
}
