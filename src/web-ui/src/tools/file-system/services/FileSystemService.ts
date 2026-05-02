import { FileSystemNode, FileSystemOptions, IFileSystemService, FileSystemChangeEvent } from '../types';
import { workspaceAPI } from '@/infrastructure/api';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('FileSystemService');

type RawFileNode = {
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number | null;
  extension?: string | null;
  lastModified?: string | number | Date | null;
  children?: RawFileNode[];
};

type FileWatchEvent = {
  path: string;
  kind: string;
  timestamp: number;
  from?: string;
  to?: string;
};

type DirectoryPage = {
  children: FileSystemNode[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
};

const DEFAULT_SORT_BY: NonNullable<FileSystemOptions['sortBy']> = 'name';
const DEFAULT_SORT_ORDER: NonNullable<FileSystemOptions['sortOrder']> = 'asc';
const FILE_EVENT_TYPE_BY_KIND: Record<string, FileSystemChangeEvent['type']> = {
  create: 'created',
  modify: 'modified',
  remove: 'deleted',
  rename: 'renamed'
};

const normalizePathForWatch = (path: string): string => (
  path.replace(/\\/g, '/').replace(/\/+$/, '')
);

const isPathWithinRoot = (path: string, root: string): boolean => (
  path === root || path.startsWith(`${root}/`)
);

const mapWatchEvent = (event: FileWatchEvent): FileSystemChangeEvent => ({
  type: FILE_EVENT_TYPE_BY_KIND[event.kind] ?? 'modified',
  path: event.path,
  oldPath: event.from,
  timestamp: new Date(event.timestamp * 1000)
});

const toFileNode = (rawNode: RawFileNode): FileSystemNode => {
  const node: FileSystemNode = {
    path: rawNode.path,
    name: rawNode.name,
    isDirectory: rawNode.isDirectory,
    size: rawNode.size ?? undefined,
    extension: rawNode.extension ?? undefined,
    lastModified: rawNode.lastModified ? new Date(rawNode.lastModified) : undefined
  };

  if (Array.isArray(rawNode.children)) {
    node.children = rawNode.children.map(toFileNode);
  }

  return node;
};

const compareFileNodes = (
  first: FileSystemNode,
  second: FileSystemNode,
  sortBy: NonNullable<FileSystemOptions['sortBy']>
): number => {
  if (first.isDirectory !== second.isDirectory) {
    return first.isDirectory ? -1 : 1;
  }

  const comparisons: Record<NonNullable<FileSystemOptions['sortBy']>, () => number> = {
    name: () => first.name.localeCompare(second.name, 'zh-CN', { numeric: true }),
    size: () => (first.size || 0) - (second.size || 0),
    lastModified: () => (first.lastModified?.getTime() || 0) - (second.lastModified?.getTime() || 0),
    type: () => (first.extension || '').localeCompare(second.extension || '')
  };

  return comparisons[sortBy]();
};

const sortFileTree = (
  nodes: FileSystemNode[],
  sortBy: FileSystemOptions['sortBy'] = DEFAULT_SORT_BY,
  sortOrder: FileSystemOptions['sortOrder'] = DEFAULT_SORT_ORDER
): FileSystemNode[] => {
  const direction = sortOrder === 'desc' ? -1 : 1;
  const activeSort = sortBy ?? DEFAULT_SORT_BY;

  return [...nodes]
    .sort((first, second) => compareFileNodes(first, second, activeSort) * direction)
    .map((node) => ({
      ...node,
      children: node.children ? sortFileTree(node.children, activeSort, sortOrder) : undefined
    }));
};

class FileSystemService implements IFileSystemService {
  async loadFileTree(rootPath: string, options: FileSystemOptions = {}): Promise<FileSystemNode[]> {
    try {
      const rawTree = await workspaceAPI.getFileTree(rootPath);
      return sortFileTree(rawTree.map(toFileNode), options.sortBy, options.sortOrder);
    } catch (error) {
      log.error('Failed to load file tree', { rootPath, error });
      throw new Error(`Failed to load file tree: ${error}`);
    }
  }

  async searchFiles(rootPath: string, query: string): Promise<FileSystemNode[]> {
    try {
      const results = await workspaceAPI.searchFilenamesOnly(rootPath, query);
      return results.map((result) => ({
        path: result.path,
        name: result.name,
        isDirectory: result.isDirectory,
      }));
    } catch (error) {
      log.error('Failed to search files', { rootPath, query, error });
      throw new Error(`Failed to search files: ${error}`);
    }
  }

  async getDirectoryChildren(dirPath: string): Promise<FileSystemNode[]> {
    try {
      const rawChildren = await workspaceAPI.getDirectoryChildren(dirPath);
      return sortFileTree(rawChildren.map(toFileNode));
    } catch (error) {
      log.error('Failed to get directory children', { dirPath, error });
      throw new Error(`Failed to get directory contents: ${error}`);
    }
  }

  async getDirectoryChildrenPaginated(
    dirPath: string,
    offset = 0,
    limit = 100
  ): Promise<DirectoryPage> {
    try {
      const result = await workspaceAPI.getDirectoryChildrenPaginated(dirPath, offset, limit);

      return {
        children: sortFileTree(result.children.map(toFileNode)),
        total: result.total,
        hasMore: result.hasMore,
        offset: result.offset,
        limit: result.limit,
      };
    } catch (error) {
      log.error('Failed to get directory children (paginated)', { dirPath, offset, limit, error });
      throw new Error(`Failed to get directory contents: ${error}`);
    }
  }

  watchFileChanges(rootPath: string, callback: (event: FileSystemChangeEvent) => void): () => void {
    let unlisten: UnlistenFn | null = null;
    let isActive = true;
    const normalizedRoot = normalizePathForWatch(rootPath);

    const isRelevantEvent = (event: FileWatchEvent): boolean => {
      const currentPath = normalizePathForWatch(event.path);
      const previousPath = event.from ? normalizePathForWatch(event.from) : null;

      return (
        isPathWithinRoot(currentPath, normalizedRoot) ||
        (event.kind === 'rename' && previousPath !== null && isPathWithinRoot(previousPath, normalizedRoot))
      );
    };

    listen<FileWatchEvent[]>('file-system-changed', (event) => {
      if (!isActive) {
        return;
      }

      event.payload
        .filter(isRelevantEvent)
        .map(mapWatchEvent)
        .forEach(callback);
    })
      .then((dispose) => {
        if (isActive) {
          unlisten = dispose;
        } else {
          dispose();
        }
      })
      .catch((error) => {
        log.error('Failed to start file watcher', { rootPath, error });
      });

    return () => {
      isActive = false;
      unlisten?.();
    };
  }

  async getFileContent(filePath: string): Promise<string> {
    try {
      return await workspaceAPI.readFileContent(filePath);
    } catch (error) {
      log.error('Failed to read file content', { filePath, error });
      throw new Error(`Failed to read file: ${error}`);
    }
  }

  async getFileStats(_filePath: string): Promise<{ size: number; lastModified: Date }> {
    return {
      size: 0,
      lastModified: new Date()
    };
  }
}

export const fileSystemService = new FileSystemService();
