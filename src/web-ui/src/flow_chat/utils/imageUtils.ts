/**
 * Image processing utilities used by chat attachments.
 */

import type { ImageContext } from '@/shared/types/context';
import { isImageFile as checkIsImageFile } from '@/infrastructure/language-detection';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('imageUtils');

const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
const DEFAULT_THUMBNAIL_SIZE = 200;
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

let clipboardImageCounter = 0;

type ImageDimensions = { width: number; height: number };
type ImageSource = 'file' | 'clipboard';

interface ImageContextDraft {
  file: File;
  source: ImageSource;
  imagePath?: string;
  imageName: string;
  dataUrl?: string;
  metadata?: ImageContext['metadata'];
}

function createImageId(source: ImageSource): string {
  const suffix = Math.random().toString(36).slice(2, 11);
  return source === 'clipboard'
    ? `img-clipboard-${Date.now()}-${suffix}`
    : `img-${Date.now()}-${suffix}`;
}

function getFilePath(file: File): string {
  return ((file as File & { path?: string }).path || '').trim();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = event => {
      resolve(event.target?.result as string);
    };

    reader.onerror = () => {
      reject(new Error('File reading failed'));
    };

    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image loading failed'));
    image.src = dataUrl;
  });
}

function fitWithinBox(width: number, height: number, maxSize: number): ImageDimensions {
  if (width <= maxSize && height <= maxSize) {
    return { width, height };
  }

  const scale = maxSize / Math.max(width, height);
  return {
    width: width * scale,
    height: height * scale,
  };
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return loadImageFromDataUrl(await readFileAsDataUrl(file));
}

async function tryReadDimensions(file: File): Promise<ImageDimensions> {
  try {
    return await getImageDimensions(file);
  } catch (error) {
    log.warn('Failed to get image dimensions', { fileName: file.name, error });
    return { width: 0, height: 0 };
  }
}

async function tryGenerateThumbnail(file: File): Promise<string | undefined> {
  try {
    return await generateThumbnail(file);
  } catch (error) {
    log.warn('Failed to generate thumbnail', { fileName: file.name, error });
    return undefined;
  }
}

function getClipboardImageName(file: File): string {
  const rawName = file.name || '';
  const extension = file.type.split('/')[1] || 'png';

  if (!rawName || /^image\.\w+$/i.test(rawName)) {
    clipboardImageCounter += 1;
    return `image-${clipboardImageCounter}.${extension}`;
  }

  return rawName;
}

async function buildImageContext(draft: ImageContextDraft): Promise<ImageContext> {
  const { file, source } = draft;
  const dimensions = await tryReadDimensions(file);
  const thumbnailUrl = await tryGenerateThumbnail(file);
  const imagePath = draft.imagePath ?? '';

  return {
    id: createImageId(source),
    type: 'image',
    imagePath,
    imageName: draft.imageName,
    width: dimensions.width,
    height: dimensions.height,
    fileSize: file.size,
    mimeType: file.type,
    dataUrl: draft.dataUrl,
    source,
    isLocal: Boolean(imagePath),
    timestamp: Date.now(),
    thumbnailUrl,
    metadata: draft.metadata ?? {},
  };
}

/**
 * Generate image thumbnail.
 */
export async function generateThumbnail(
  file: File,
  maxSize: number = DEFAULT_THUMBNAIL_SIZE
): Promise<string> {
  const image = await loadImageFromFile(file);
  const { width, height } = fitWithinBox(image.width, image.height, maxSize);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Failed to get canvas context');
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', 0.8);
}

/**
 * Generate thumbnail from file path in a Tauri environment.
 */
export async function generateThumbnailFromPath(filePath: string): Promise<string> {
  return `file://${filePath}`;
}

/**
 * Validate image file.
 */
export function validateImageFile(file: File): {
  valid: boolean;
  error?: string;
} {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    return {
      valid: false,
      error: `Unsupported image format: ${file.type}`,
    };
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      error: `Image too large (${(file.size / 1024 / 1024).toFixed(2)}MB), maximum supported 20MB`,
    };
  }

  return { valid: true };
}

/**
 * Get image dimensions.
 */
export async function getImageDimensions(file: File): Promise<ImageDimensions> {
  const image = await loadImageFromFile(file);

  return {
    width: image.width,
    height: image.height,
  };
}

/**
 * Get MIME type from filename.
 */
export function getMimeTypeFromFilename(filename: string): string {
  const extension = filename.toLowerCase().split('.').pop() || '';
  return MIME_BY_EXTENSION[extension] || 'image/jpeg';
}

/**
 * Create ImageContext from a file.
 */
export async function createImageContextFromFile(file: File): Promise<ImageContext> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const imagePath = getFilePath(file);
  const dataUrl = imagePath ? undefined : await readFileAsDataUrl(file);

  return buildImageContext({
    file,
    source: 'file',
    imagePath,
    imageName: file.name,
    dataUrl,
  });
}

/**
 * Create ImageContext from clipboard.
 */
export async function createImageContextFromClipboard(file: File): Promise<ImageContext> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  return buildImageContext({
    file,
    source: 'clipboard',
    imagePath: '',
    imageName: getClipboardImageName(file),
    dataUrl: await readFileAsDataUrl(file),
    metadata: { fromClipboard: true },
  });
}

/**
 * Check whether a filename points to an image.
 */
export function isImageFile(filename: string): boolean {
  return checkIsImageFile(filename);
}

/**
 * Format file size.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
