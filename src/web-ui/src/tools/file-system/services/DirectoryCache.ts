import { FileSystemNode, DirectoryCacheEntry } from '../types';
interface DirectoryCacheConfig {
  maxEntries: number;
  ttl: number;
}

const DEFAULT_CONFIG: DirectoryCacheConfig = {
  maxEntries: 200,
  ttl: 0,
};

const normalizeCachePath = (path: string): string => path.replace(/\\/g, '/');

class DirectoryCacheClass {
  private readonly cache = new Map<string, DirectoryCacheEntry>();
  private accessOrder: string[] = [];
  private readonly config: DirectoryCacheConfig;
  private readonly invalidationCallbacks = new Set<(path: string) => void>();

  constructor(config: Partial<DirectoryCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get(path: string): FileSystemNode[] | null {
    const entry = this.cache.get(path);

    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      this.delete(path);
      return null;
    }

    this.updateAccessOrder(path);

    return entry.children;
  }

  set(path: string, children: FileSystemNode[], isComplete: boolean = true): void {
    if (this.cache.size >= this.config.maxEntries && !this.cache.has(path)) {
      this.evictLRU();
    }

    const entry: DirectoryCacheEntry = {
      path,
      children,
      timestamp: Date.now(),
      isComplete,
    };

    this.cache.set(path, entry);
    this.updateAccessOrder(path);
  }

  delete(path: string): boolean {
    const deleted = this.cache.delete(path);

    if (deleted) {
      this.removeFromAccessOrder(path);
    }

    return deleted;
  }

  invalidate(path: string): void {
    const normalizedPath = normalizeCachePath(path);
    const parentPath = this.getParentPath(normalizedPath);

    if (parentPath) {
      this.delete(parentPath);
    }

    this.findDescendantEntries(normalizedPath).forEach(p => this.delete(p));

    this.invalidationCallbacks.forEach(callback => callback(path));
  }

  invalidateBatch(paths: string[]): void {
    const affectedParents = new Set<string>();

    paths.forEach(path => {
      const normalizedPath = normalizeCachePath(path);
      const parentPath = this.getParentPath(normalizedPath);
      if (parentPath) {
        affectedParents.add(parentPath);
      }

      this.delete(path);
    });

    affectedParents.forEach(parent => this.delete(parent));
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  has(path: string): boolean {
    const entry = this.cache.get(path);
    if (!entry) return false;

    if (this.isExpired(entry)) {
      this.delete(path);
      return false;
    }

    return true;
  }

  getStats(): { size: number; maxEntries: number; hitRate?: number } {
    return {
      size: this.cache.size,
      maxEntries: this.config.maxEntries,
    };
  }

  onInvalidate(callback: (path: string) => void): () => void {
    this.invalidationCallbacks.add(callback);
    return () => {
      this.invalidationCallbacks.delete(callback);
    };
  }

  private updateAccessOrder(path: string): void {
    this.removeFromAccessOrder(path);
    this.accessOrder.push(path);
  }

  private removeFromAccessOrder(path: string): void {
    const index = this.accessOrder.indexOf(path);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  private evictLRU(): void {
    const lruPath = this.accessOrder.shift();
    if (lruPath) {
      this.cache.delete(lruPath);
    }
  }

  private getParentPath(path: string): string | null {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash <= 0) return null;
    return path.substring(0, lastSlash);
  }

  private isExpired(entry: DirectoryCacheEntry): boolean {
    return this.config.ttl > 0 && Date.now() - entry.timestamp > this.config.ttl;
  }

  private findDescendantEntries(normalizedPath: string): string[] {
    const pathsToDelete: string[] = [];

    this.cache.forEach((_, cachedPath) => {
      const normalizedCached = normalizeCachePath(cachedPath);
      if (normalizedCached === normalizedPath || normalizedCached.startsWith(`${normalizedPath}/`)) {
        pathsToDelete.push(cachedPath);
      }
    });

    return pathsToDelete;
  }
}

export const directoryCache = new DirectoryCacheClass();

export { DirectoryCacheClass };
