import type { FileSystemNode } from '../../../tools/file-system/types';
import type { ContextItem, DirectoryContext, FileContext, ImageContext } from '../../types/context';
import type { DragPayload, IDragSource, PreviewData } from '../../types/drag';
import { getMimeTypeFromFilename, isImageFile } from '../../../flow_chat/utils/imageUtils';
import { i18nService } from '@/infrastructure/i18n';

type FileTreeDataType = 'file' | 'directory' | 'image';

export class FileTreeDragSource implements IDragSource<FileSystemNode> {
  readonly sourceId = 'file-tree-primary';
  readonly sourceType = 'file-tree' as const;

  createPayload(node: FileSystemNode): DragPayload<ContextItem> {
    const timestamp = Date.now();
    const id = createContextId(timestamp);
    const contextData = createContextItem(node, id, timestamp);

    return {
      id,
      sourceType: this.sourceType,
      dataType: resolveDataType(contextData),
      timestamp,
      data: contextData,
      metadata: {
        sourceId: this.sourceId,
        sourcePath: splitSourcePath(node.path),
        preview: this.generatePreview(node, contextData),
      },
    };
  }

  generatePreview(node: FileSystemNode, contextData?: ContextItem): PreviewData {
    return {
      type: 'text',
      title: node.name,
      subtitle: previewSubtitle(node, contextData),
    };
  }

  onDragStart(): void {}

  onDragEnd(): void {}
}

export const fileTreeDragSource = new FileTreeDragSource();

function createContextId(timestamp: number): string {
  return `context-${timestamp}-${Math.random().toString(36).slice(2, 11)}`;
}

function createContextItem(
  node: FileSystemNode,
  id: string,
  timestamp: number,
): ContextItem {
  if (node.isDirectory) {
    return createDirectoryContext(node, id, timestamp);
  }

  return isImageFile(node.name)
    ? createImageContext(node, id, timestamp)
    : createFileContext(node, id, timestamp);
}

function createDirectoryContext(
  node: FileSystemNode,
  id: string,
  timestamp: number,
): DirectoryContext {
  return {
    id,
    type: 'directory',
    directoryPath: node.path,
    directoryName: node.name,
    recursive: false,
    timestamp,
    metadata: {
      isDirectory: true,
    },
  };
}

function createImageContext(node: FileSystemNode, id: string, timestamp: number): ImageContext {
  return {
    id,
    type: 'image',
    imagePath: node.path,
    imageName: node.name,
    fileSize: node.size || 0,
    mimeType: getMimeTypeFromFilename(node.name),
    source: 'file',
    isLocal: true,
    timestamp,
    metadata: {
      isDirectory: false,
      isImage: true,
    },
  };
}

function createFileContext(node: FileSystemNode, id: string, timestamp: number): FileContext {
  return {
    id,
    type: 'file',
    filePath: node.path,
    fileName: node.name,
    fileSize: node.size,
    timestamp,
    metadata: {
      isDirectory: false,
    },
  };
}

function resolveDataType(contextData: ContextItem): FileTreeDataType {
  if (contextData.type === 'directory' || contextData.type === 'image') {
    return contextData.type;
  }

  return 'file';
}

function splitSourcePath(path: string): string[] {
  return path.split(/[/\\]/);
}

function previewSubtitle(node: FileSystemNode, contextData?: ContextItem): string {
  if (contextData?.type === 'image') {
    return formatFileSize(node.size || 0);
  }

  return node.isDirectory ? i18nService.t('common:file.folder') : formatFileSize(node.size || 0);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
