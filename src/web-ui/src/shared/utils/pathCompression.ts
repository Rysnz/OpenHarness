import { i18nService } from '@/infrastructure/i18n';
import { FileTreeNode } from '../types/project-view';

export interface CompressedNode extends Omit<FileTreeNode, 'children'> {
  children?: CompressedNode[];
  isCompressed?: boolean;
  compressedPath?: string;
  originalNodes?: FileTreeNode[];
}

function hasSingleDirectoryChild(node: FileTreeNode): boolean {
  return (
    node.isDirectory &&
    Array.isArray(node.children) &&
    node.children.length === 1 &&
    node.children[0].isDirectory
  );
}

function compressChildren(children: FileTreeNode[] | undefined): CompressedNode[] | undefined {
  return children?.map((child) => compressNodePath(child));
}

function collectCompressibleChain(root: FileTreeNode) {
  const segments = [root.name];
  const originalNodes = [root];
  let tail = root;

  while (hasSingleDirectoryChild(tail)) {
    const child = tail.children![0];
    segments.push(child.name);
    originalNodes.push(child);
    tail = child;
  }

  return { segments, originalNodes, tail };
}

function compressNodePath(node: FileTreeNode): CompressedNode {
  if (!hasSingleDirectoryChild(node)) {
    return {
      ...node,
      children: compressChildren(node.children),
    };
  }

  const { segments, originalNodes, tail } = collectCompressibleChain(node);
  const compressedPath = segments.join('/');

  return {
    ...node,
    name: compressedPath,
    path: tail.path,
    isCompressed: true,
    compressedPath,
    originalNodes,
    children: compressChildren(tail.children),
  };
}

export function compressFileTree(fileTree: FileTreeNode[]): CompressedNode[] {
  return fileTree.map((node) => compressNodePath(node));
}

export function lazyCompressFileTree(fileTree: FileTreeNode[], expandedFolders: Set<string>): CompressedNode[] {
  return fileTree.map((node) => lazyCompressNodePath(node, expandedFolders));
}

function shallowCloneChildren(children: FileTreeNode[] | undefined): CompressedNode[] | undefined {
  return children?.map((child) => ({
    ...child,
    children: child.children,
  }));
}

function lazyCompressNodePath(node: FileTreeNode, expandedFolders: Set<string>): CompressedNode {
  if (!expandedFolders.has(node.path)) {
    return {
      ...node,
      children: shallowCloneChildren(node.children),
    };
  }

  if (!node.children?.length) {
    return { ...node };
  }

  return {
    ...node,
    children: node.children.map((child) =>
      child.isDirectory && hasSingleDirectoryChild(child)
        ? compressNodePath(child)
        : lazyCompressNodePath(child, expandedFolders)
    ),
  };
}

export function expandCompressedNode(compressedNode: CompressedNode): FileTreeNode[] {
  if (!compressedNode.isCompressed || !compressedNode.originalNodes) {
    return [{
      ...compressedNode,
      children: compressedNode.children?.flatMap((child) => expandCompressedNode(child)),
    }];
  }

  const nodes = [...compressedNode.originalNodes];
  for (let index = nodes.length - 1; index >= 0; index--) {
    const currentNode = nodes[index];
    currentNode.children = index === nodes.length - 1
      ? compressedNode.children?.flatMap((child) => expandCompressedNode(child))
      : [nodes[index + 1]];
  }

  return [nodes[0]];
}

export function shouldCompressPaths(options?: {
  enabled?: boolean;
  minDepth?: number;
  maxCompressedSegments?: number;
}): boolean {
  const finalOptions = {
    enabled: true,
    minDepth: 2,
    maxCompressedSegments: 5,
    ...options,
  };

  return finalOptions.enabled ?? true;
}

export function getCompressionTooltip(compressedNode: CompressedNode): string {
  if (!compressedNode.isCompressed || !compressedNode.originalNodes) {
    return compressedNode.path;
  }

  const compressed = compressedNode.originalNodes.map((node) => node.name).join(' > ');
  return i18nService.t('common:file.compressedPathTooltip', {
    compressed,
    full: compressedNode.path,
  });
}
