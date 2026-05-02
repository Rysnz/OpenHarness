import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Eye, Image as ImageIcon } from 'lucide-react';
import { Button, Modal } from '@/component-library';
import { i18nService } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import type { ImageContext, RenderOptions, ValidationResult } from '../../../types/context';
import type {
  ContextCardRenderer,
  ContextTransformer,
  ContextValidator,
} from '../../../services/ContextRegistry';

const log = createLogger('ImageContextValidator');
const SUPPORTED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function createImagePayload(context: ImageContext): unknown {
  return {
    type: 'image',
    id: context.id,
    image_path: context.imagePath || null,
    data_url: context.dataUrl || null,
    mime_type: context.mimeType,
    metadata: {
      name: context.imageName,
      width: context.width,
      height: context.height,
      file_size: context.fileSize,
      source: context.source,
      is_local: context.isLocal,
    },
  };
}

function previewSourceFor(context: ImageContext): string | null {
  return context.thumbnailUrl || context.dataUrl || null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function localImageExists(imagePath: string): Promise<boolean> {
  return invoke<boolean>('check_path_exists', { path: imagePath });
}

export class ImageContextTransformer implements ContextTransformer<'image'> {
  readonly type = 'image' as const;

  transform(context: ImageContext): unknown {
    return createImagePayload(context);
  }

  estimateSize(context: ImageContext): number {
    return context.dataUrl?.length ?? context.imagePath?.length ?? 100;
  }
}

export class ImageContextValidator implements ContextValidator<'image'> {
  readonly type = 'image' as const;

  async validate(context: ImageContext): Promise<ValidationResult> {
    try {
      const baseError = this.validateMetadata(context);
      if (baseError) {
        return baseError;
      }

      if (context.isLocal && context.imagePath) {
        const exists = await this.validateLocalFile(context.imagePath);
        if (!exists.valid) {
          return exists;
        }
      }

      return {
        valid: true,
        metadata: {
          size: context.fileSize,
          format: context.mimeType,
        },
      };
    } catch (error) {
      log.error('Validation failed', error as Error);
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Validation failed.',
      };
    }
  }

  private validateMetadata(context: ImageContext): ValidationResult | null {
    if (!context.imagePath && !context.dataUrl) {
      return {
        valid: false,
        error: 'Image path or data must not be empty.',
      };
    }

    if (!SUPPORTED_IMAGE_MIME_TYPES.includes(context.mimeType)) {
      return {
        valid: false,
        error: `Unsupported image format: ${context.mimeType}`,
      };
    }

    if (context.fileSize && context.fileSize > MAX_IMAGE_BYTES) {
      return {
        valid: false,
        error: `Image is too large (${(context.fileSize / 1024 / 1024).toFixed(2)}MB). Max supported size is 20MB.`,
      };
    }

    return null;
  }

  private async validateLocalFile(imagePath: string): Promise<ValidationResult> {
    try {
      if (await localImageExists(imagePath)) {
        return { valid: true };
      }

      return {
        valid: false,
        error: 'Image file does not exist.',
      };
    } catch (error) {
      log.error('Failed to check image file existence', error as Error);
      return {
        valid: false,
        error: 'Unable to check image file.',
      };
    }
  }
}

export class ImageCardRenderer implements ContextCardRenderer<'image'> {
  readonly type = 'image' as const;

  render(context: ImageContext, options?: RenderOptions): React.ReactElement {
    return <ImageContextCard context={context} options={options} />;
  }
}

interface ImageContextCardProps {
  context: ImageContext;
  options?: RenderOptions;
}

function ImageContextCard({ context, options }: ImageContextCardProps): React.ReactElement {
  const { compact = false, interactive = true } = options || {};
  const [imagePreview, setImagePreview] = React.useState<string | null>(() => previewSourceFor(context));
  const [showFullImage, setShowFullImage] = React.useState(false);

  React.useEffect(() => {
    setImagePreview(previewSourceFor(context));
  }, [context]);

  const openFullImage = () => {
    if (interactive) {
      setShowFullImage(true);
    }
  };

  return (
    <div className="context-card image-context-card" data-compact={compact}>
      <div className="context-card__header">
        <div className="context-card__icon">
          <ImageIcon size={16} />
        </div>
        <div className="context-card__info">
          <div className="context-card__title">{context.imageName}</div>
          {!compact && <ImageMetadata context={context} />}
        </div>
      </div>

      {!compact && imagePreview && (
        <ImagePreview
          context={context}
          imagePreview={imagePreview}
          interactive={interactive}
          onOpen={openFullImage}
        />
      )}

      <Modal
        isOpen={showFullImage && !!imagePreview}
        onClose={() => setShowFullImage(false)}
        title={context.imageName}
        size="large"
      >
        <div className="image-context-card__modal-content">
          <img
            src={imagePreview || ''}
            alt={context.imageName}
            style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
          />
        </div>
      </Modal>
    </div>
  );
}

function ImageMetadata({ context }: { context: ImageContext }): React.ReactElement {
  const hasDimensions = Boolean(context.width && context.height);

  return (
    <div className="context-card__meta">
      {hasDimensions && <span>{context.width} x {context.height}</span>}
      {hasDimensions && context.fileSize && <span className="context-card__meta-separator"> / </span>}
      {context.fileSize && <span>{formatFileSize(context.fileSize)}</span>}
    </div>
  );
}

interface ImagePreviewProps {
  context: ImageContext;
  imagePreview: string;
  interactive: boolean;
  onOpen: () => void;
}

function ImagePreview({ context, imagePreview, interactive, onOpen }: ImagePreviewProps): React.ReactElement {
  return (
    <div className="context-card__preview">
      <div
        className="image-context-card__thumbnail"
        onClick={onOpen}
        style={{ cursor: interactive ? 'pointer' : 'default' }}
      >
        <img
          src={imagePreview}
          alt={context.imageName}
          style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain' }}
        />
      </div>
      {interactive && (
        <div className="image-context-card__actions">
          <Button variant="ghost" size="small" onClick={onOpen}>
            <Eye size={14} />
            <span>{i18nService.t('components:contextSystem.contextCard.viewLargeImage')}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
