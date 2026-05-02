import React, { useCallback, useState } from 'react';
import { Check, Copy, Edit } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/component-library';
import { i18nService } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import { createMarkdownEditorTab } from '@/shared/utils/tabUtils';
import type { DialogTurn, FlowTextItem, FlowThinkingItem, FlowToolItem } from '../types/flow-chat';
import './CopyOutputButton.css';

const log = createLogger('CopyOutputButton');
const COPY_RESET_DELAY_MS = 2000;
const EDITOR_OPEN_DELAY_MS = 250;

interface CopyOutputButtonProps {
  dialogTurn: DialogTurn;
  className?: string;
}

type Translate = ReturnType<typeof useTranslation>['t'];

function stringifyBlock(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function toolOutput(toolItem: FlowToolItem, t: Translate): string | null {
  if (!toolItem.toolCall) {
    return null;
  }

  const toolName = toolItem.toolName || t('copyOutput.unknownTool');
  const sections = [t('copyOutput.toolCall', { name: toolName })];

  if (toolItem.toolCall.input) {
    sections.push(`[Input]\n\`\`\`json\n${stringifyBlock(toolItem.toolCall.input)}\n\`\`\``);
  }

  if (toolItem.toolResult?.error) {
    sections.push(`[Error]\n${toolItem.toolResult.error}`);
  } else if (toolItem.toolResult?.result !== undefined) {
    sections.push(`[Result]\n\`\`\`\n${stringifyBlock(toolItem.toolResult.result)}\n\`\`\``);
  }

  return sections.join('\n\n').trim();
}

function itemOutput(item: DialogTurn['modelRounds'][number]['items'][number], t: Translate): string | null {
  if (item.type === 'text') {
    const content = (item as FlowTextItem).content.trim();
    return content || null;
  }

  if (item.type === 'thinking') {
    const content = (item as FlowThinkingItem).content.trim();
    return content ? `[Thinking]\n${content}` : null;
  }

  if (item.type === 'tool') {
    return toolOutput(item as FlowToolItem, t);
  }

  return null;
}

function extractOutputContent(dialogTurn: DialogTurn, t: Translate): string {
  const contentParts = dialogTurn.modelRounds.flatMap((modelRound) =>
    [...modelRound.items]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((item) => itemOutput(item, t))
      .filter((content): content is string => Boolean(content))
  );

  return contentParts.join('\n\n');
}

function hasCopyableContent(dialogTurn: DialogTurn): boolean {
  return dialogTurn.modelRounds.some((round) =>
    round.items.some((item) =>
      (item.type === 'text' && (item as FlowTextItem).content.trim()) ||
      (item.type === 'tool' && (item as FlowToolItem).toolCall)
    )
  );
}

function timestampLabel(): string {
  return i18nService
    .formatDate(new Date(), {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(/\//g, '-');
}

interface ActionButtonProps {
  className: string;
  onClick: () => void;
  ariaLabel: string;
  title?: string;
  icon: React.ReactNode;
  label: string;
}

function ActionButton({ className, onClick, ariaLabel, title, icon, label }: ActionButtonProps): React.ReactElement {
  return (
    <button className={className} onClick={onClick} title={title} aria-label={ariaLabel}>
      <span className="button-icon">{icon}</span>
      <span className="button-text">{label}</span>
    </button>
  );
}

export const CopyOutputButton: React.FC<CopyOutputButtonProps> = ({
  dialogTurn,
  className = '',
}) => {
  const { t } = useTranslation('flow-chat');
  const [copied, setCopied] = useState(false);

  const getContent = useCallback(() => extractOutputContent(dialogTurn, t), [dialogTurn, t]);

  const handleCopy = useCallback(async () => {
    try {
      const content = getContent();
      if (!content.trim()) {
        log.warn('No content to copy');
        return;
      }

      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_RESET_DELAY_MS);
    } catch (error) {
      log.error('Failed to copy', error);
    }
  }, [getContent]);

  const handleOpenInEditor = useCallback(() => {
    try {
      const content = getContent();
      if (!content.trim()) {
        log.warn('No content to edit');
        return;
      }

      window.dispatchEvent(new CustomEvent('expand-right-panel'));
      setTimeout(() => {
        createMarkdownEditorTab(
          t('copyOutput.aiReply', { timestamp: timestampLabel() }),
          content,
          undefined,
          undefined,
          'agent'
        );
        log.debug('AI reply opened in editor');
      }, EDITOR_OPEN_DELAY_MS);
    } catch (error) {
      log.error('Failed to open editor', error);
    }
  }, [getContent, t]);

  if (!hasCopyableContent(dialogTurn)) {
    return null;
  }

  const copyLabel = copied ? t('copyOutput.copiedOutputContent') : t('copyOutput.copyOutputContent');

  return (
    <div className={`copy-output-button-group ${className}`}>
      <ActionButton
        className={`copy-output-button ${copied ? 'copied' : ''}`}
        onClick={handleCopy}
        title={copyLabel}
        ariaLabel={copyLabel}
        icon={copied ? <Check size={14} /> : <Copy size={14} />}
        label={copied ? t('copyOutput.copied') : t('copyOutput.copy')}
      />

      <Tooltip content={t('copyOutput.openInEditor')}>
        <ActionButton
          className="copy-output-button edit-button"
          onClick={handleOpenInEditor}
          ariaLabel={t('copyOutput.openInEditor')}
          icon={<Edit size={14} />}
          label={t('copyOutput.edit')}
        />
      </Tooltip>
    </div>
  );
};
