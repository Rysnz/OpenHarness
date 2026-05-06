import { FileSystemNode, FlatFileNode } from '../types';
import { expandedFoldersContains } from '@/shared/utils/pathUtils';

interface FlattenCursor {
  parentPath: string | null;
  depth: number;
}

function nodeToFlatNode(
  node: FileSystemNode,
  cursor: FlattenCursor,
  childrenLoaded: boolean
): FlatFileNode {
  return {
    path: node.path,
    name: node.name,
    parentPath: cursor.parentPath,
    isDirectory: node.isDirectory,
    depth: cursor.depth,
    childrenLoaded,
    isLoading: false,
    size: node.size,
    extension: node.extension,
    lastModified: node.lastModified,
    isCompressed: node.isCompressed,
    originalNode: node,
  };
}

function hasLoadedChildren(node: FileSystemNode): boolean {
  return Boolean(node.children?.length);
}

function childCursor(node: FileSystemNode, cursor: FlattenCursor): FlattenCursor {
  return {
    parentPath: node.path,
    depth: cursor.depth + 1,
  };
}

export function flattenFileTree(
  nodes: FileSystemNode[],
  expandedFolders: Set<string>,
  loadingPaths: Set<string> = new Set(),
  parentPath: string | null = null,
  depth: number = 0
): FlatFileNode[] {
  const result: FlatFileNode[] = [];
  const cursor = { parentPath, depth };

  for (const node of nodes) {
    const isExpanded = expandedFoldersContains(expandedFolders, node.path);
    const hasChildren = hasLoadedChildren(node);
    const childrenLoaded = node.isDirectory ? (node.children !== undefined) : true;

    result.push({
      ...nodeToFlatNode(node, cursor, childrenLoaded),
      isLoading: loadingPaths.has(node.path),
    });

    if (node.isDirectory && isExpanded && hasChildren) {
      const next = childCursor(node, cursor);
      const childNodes = flattenFileTree(
        node.children!,
        expandedFolders,
        loadingPaths,
        next.parentPath,
        next.depth
      );
      result.push(...childNodes);
    }

  }

  return result;
}

export function countVisibleNodes(
  nodes: FileSystemNode[],
  expandedFolders: Set<string>
): number {
  let count = 0;

  for (const node of nodes) {
    count++;
    if (node.isDirectory && expandedFoldersContains(expandedFolders, node.path) && node.children) {
      count += countVisibleNodes(node.children, expandedFolders);
    }
  }

  return count;
}

export function findNodeIndex(flatNodes: FlatFileNode[], path: string): number {
  return flatNodes.findIndex(node => node.path === path);
}

export function getAncestorPaths(path: string, workspacePath?: string): string[] {
  const ancestors: string[] = [];
  const normalizedPath = path.replace(/\\/g, '/');
  const normalizedWorkspace = workspacePath?.replace(/\\/g, '/') || '';
  let currentPath = normalizedPath;
  
  while (currentPath && currentPath !== normalizedWorkspace) {
    const lastSlash = currentPath.lastIndexOf('/');
    if (lastSlash <= 0) break;
    
    currentPath = currentPath.substring(0, lastSlash);
    if (currentPath && currentPath !== normalizedWorkspace) {
      ancestors.push(currentPath);
    }
  }
  
  return ancestors.reverse();
}

export function updateNodeChildren(
  nodes: FileSystemNode[],
  targetPath: string,
  children: FileSystemNode[]
): FileSystemNode[] {
  return nodes.map(node => {
    if (node.path === targetPath) {
      return {
        ...node,
        children,
      };
    }
    
    if (node.children && node.path !== targetPath) {
      const updatedChildren = updateNodeChildren(node.children, targetPath, children);
      if (updatedChildren !== node.children) {
        return {
          ...node,
          children: updatedChildren,
        };
      }
    }
    
    return node;
  });
}

export function markNodeLoading(
  flatNodes: FlatFileNode[],
  path: string,
  isLoading: boolean
): FlatFileNode[] {
  return flatNodes.map(node => {
    if (node.path === path) {
      return { ...node, isLoading };
    }
    return node;
  });
}
