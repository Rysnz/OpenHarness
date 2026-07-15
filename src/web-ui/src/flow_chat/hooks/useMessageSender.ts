/**
 * Message sending hook.
 * Encapsulates session creation, image uploads, and message assembly.
 *
 * Image handling is fully delegated to the backend coordinator which
 * decides whether to pre-analyse via a vision model or attach images
 * directly.  The frontend only uploads clipboard images and passes
 * ImageContextData[] through to the backend.
 */

import { useCallback, useState, useRef } from 'react';
import { FlowChatManager } from '../services/FlowChatManager';
import { notificationService } from '@/shared/notification-system';
import type { ContextItem, ImageContext } from '@/shared/types/context';
import type { AIModelConfig, DefaultModelsConfig } from '@/infrastructure/config/types';
import { createLogger } from '@/shared/utils/logger';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import { api } from '@/infrastructure/api/service-api/ApiClient';

const log = createLogger('FlowChat');

function normalizeModelSelection(
  modelId: string | undefined,
  models: AIModelConfig[],
  _defaultModels: DefaultModelsConfig,
): string {
  const value = modelId?.trim();
  if (!value || value === 'auto') return 'auto';

  const matchedModel = models.find(model =>
    model.id === value || model.name === value || model.model_name === value,
  );
  if (!matchedModel) {
    log.warn('Model selection unresolved: model not found in available models', {
      selectedValue: value,
      availableModelIds: models.map(m => m.id),
    });
    return 'auto';
  }
  return matchedModel.id || 'auto';
}

interface UseMessageSenderProps {
  /** Current session ID */
  currentSessionId?: string;
  /** Context items */
  contexts: ContextItem[];
  /** Clear contexts callback */
  onClearContexts: () => void;
  /** Success callback */
  onSuccess?: (message: string) => void;
  /** Exit template mode callback */
  onExitTemplateMode?: () => void;
  /** Selected agent type (mode) */
  currentAgentType?: string;
}

interface UseMessageSenderReturn {
  /** Send a message */
  sendMessage: (
    message: string,
    options?: {
      displayMessage?: string;
    }
  ) => Promise<void>;
  /** Whether a send is in progress */
  isSending: boolean;
}

export function useMessageSender(props: UseMessageSenderProps): UseMessageSenderReturn {
  const {
    currentSessionId,
    contexts,
    onClearContexts,
    onSuccess,
    onExitTemplateMode,
    currentAgentType,
  } = props;

  const [isSending, setIsSending] = useState(false);
  // Track whether a new session was created during this send so we can roll it back on failure.
  const createdSessionIdRef = useRef<string | null>(null);

  const sendMessage = useCallback(async (
    message: string,
    options?: {
      displayMessage?: string;
    }
  ) => {
    if (!message.trim()) {
      return;
    }

    const trimmedMessage = message.trim();
    let sessionId = currentSessionId;
    createdSessionIdRef.current = null;
    log.debug('Send message initiated', {
      textLength: trimmedMessage.length,
      contextCount: contexts.length,
      hasSession: !!sessionId,
      agentType: currentAgentType || 'agentic',
    });

    setIsSending(true);
    try {
      const flowChatManager = FlowChatManager.getInstance();

      if (!sessionId) {
        const [agentModels, allModels, defaultModels] = await Promise.all([
          configManager.getConfig<Record<string, string>>('ai.agent_models') || {},
          configManager.getConfig<AIModelConfig[]>('ai.models') || [],
          configManager.getConfig<DefaultModelsConfig>('ai.default_models') || {},
        ]);
        const agentType = currentAgentType || 'agentic';
        const modelId = normalizeModelSelection(agentModels[agentType], allModels, defaultModels);

        sessionId = await flowChatManager.createChatSession({
          modelName: modelId || undefined
        }, agentType);
        createdSessionIdRef.current = sessionId;
        log.debug('Session created', { sessionId, modelId, agentType });
      } else {
        log.debug('Reusing existing session', { sessionId });
      }

      const imageContexts = contexts.filter(ctx => ctx.type === 'image') as ImageContext[];
      const clipboardImages = imageContexts.filter(ctx => !ctx.isLocal && ctx.dataUrl);

      if (clipboardImages.length > 0) {
        try {
          const uploadData = {
            request: {
              images: clipboardImages.map(ctx => ({
                id: ctx.id,
                image_path: ctx.imagePath || null,
                data_url: ctx.dataUrl || null,
                mime_type: ctx.mimeType,
                image_name: ctx.imageName,
                file_size: ctx.fileSize,
                width: ctx.width || null,
                height: ctx.height || null,
                source: ctx.source,
              }))
            }
          };

          await api.invoke('upload_image_contexts', uploadData);
          log.debug('Clipboard images uploaded', {
            imageCount: clipboardImages.length,
            ids: clipboardImages.map(img => img.id),
          });
        } catch (error) {
          log.error('Failed to upload clipboard images', {
            imageCount: clipboardImages.length,
            error: (error as Error)?.message ?? 'unknown',
          });
          // Roll back the newly-created session so we don't leave an empty session behind.
          if (createdSessionIdRef.current) {
            try {
              await FlowChatManager.getInstance().deleteChatSession(createdSessionIdRef.current);
            } catch (cleanupErr) {
              log.warn('Failed to clean up empty session after image upload failure', { sessionId: createdSessionIdRef.current, error: cleanupErr });
            }
          }
          notificationService.error('Image upload failed. Please try again.', { duration: 3000 });
          throw error;
        }
      }

      let fullMessage = trimmedMessage;
      const displayMessage = options?.displayMessage?.trim() || trimmedMessage;

      if (contexts.length > 0) {
        const fullContextSection = contexts.map(ctx => {
          switch (ctx.type) {
            case 'file':
              return `[File: ${ctx.relativePath || ctx.filePath}]`;
            case 'directory':
              return `[Directory: ${ctx.directoryPath}]`;
            case 'code-snippet':
              return `[Code Snippet: ${ctx.filePath}:${ctx.startLine}-${ctx.endLine}]`;
            case 'image':
              // Images are sent out-of-band via `imageContexts` so the backend can attach them
              // for multimodal models or convert to text placeholders for text-only models. Avoid embedding
              // "Image ID" references into the user prompt, which can cause redundant tool calls.
              return '';
            case 'terminal-command':
              return `[Command: ${ctx.command}]`;
            case 'mermaid-node':
              return `[Mermaid Node: ${ctx.nodeText}]`;
            case 'mermaid-diagram':
              return `[Mermaid Diagram${ctx.diagramTitle ? ': ' + ctx.diagramTitle : ''}]\n\`\`\`mermaid\n${ctx.diagramCode}\n\`\`\``;
            case 'git-ref':
              return `[Git Ref: ${ctx.refValue}]`;
            case 'url':
              return `[URL: ${ctx.url}]`;
            case 'web-element': {
              const attrStr = Object.entries(ctx.attributes)
                .map(([k, v]) => `${k}="${v}"`)
                .join(' ');
              const lines = [
                `[Web Element: <${ctx.tagName}${attrStr ? ' ' + attrStr : ''}>]`,
                `CSS Path: ${ctx.path}`,
              ];
              if (ctx.sourceUrl) lines.push(`Source URL: ${ctx.sourceUrl}`);
              if (ctx.textContent) lines.push(`Text Content: ${ctx.textContent}`);
              if (ctx.outerHTML) lines.push(`Outer HTML:\n\`\`\`html\n${ctx.outerHTML}\n\`\`\``);
              return lines.join('\n');
            }
            default:
              return '';
          }
        }).filter(Boolean).join('\n');

        fullMessage = `${fullContextSection}\n\n${trimmedMessage}`;
      }

      // Always pass imageContexts to the backend; the coordinator decides
      // whether to pre-analyse via a vision model or attach directly.
      const imageContextsForBackend = imageContexts.length > 0
        ? {
            imageContexts: imageContexts.map(ctx => ({
              id: ctx.id,
              image_path: ctx.isLocal ? ctx.imagePath : undefined,
              data_url: undefined,
              mime_type: ctx.mimeType,
              metadata: {
                name: ctx.imageName,
                width: ctx.width,
                height: ctx.height,
                file_size: ctx.fileSize,
                source: ctx.source,
              },
            })),
            imageDisplayData: imageContexts.map(ctx => ({
              id: ctx.id,
              name: ctx.imageName || 'Image',
              dataUrl: ctx.dataUrl,
              imagePath: ctx.isLocal ? ctx.imagePath : undefined,
              mimeType: ctx.mimeType,
            })),
          }
        : undefined;

      await flowChatManager.sendMessage(
        fullMessage,
        sessionId || undefined,
        displayMessage,
        currentAgentType || 'agentic',
        undefined,
        imageContextsForBackend
      );

      onClearContexts();

      onExitTemplateMode?.();

      onSuccess?.(trimmedMessage);
      log.info('Message sent successfully', {
        sessionId,
        agentType: currentAgentType || 'agentic',
        contextCount: contexts.length,
        imageCount: imageContexts.length,
      });
    } catch (error) {
      log.error('Failed to send message', {
        sessionId,
        agentType: currentAgentType || 'agentic',
        contextCount: contexts.length,
        error: (error as Error)?.message ?? 'unknown',
      });
      throw error;
    } finally {
      setIsSending(false);
    }
  }, [currentSessionId, contexts, onClearContexts, onSuccess, onExitTemplateMode, currentAgentType]);

  return {
    sendMessage,
    isSending,
  };
}
