import { i18nService } from '../../../infrastructure/i18n';
import { globalEventBus } from '../../../infrastructure/event-bus';
import { createLogger } from '@/shared/utils/logger';
import { commandExecutor } from '../commands/CommandExecutor';
import { ContextType, FlowChatContext, MenuContext } from '../types/context.types';
import { MenuItem } from '../types/menu.types';
import { IMenuProvider } from '../types/provider.types';

const log = createLogger('FlowChatMenuProvider');

function separator(id: string): MenuItem {
  return { id, label: '', separator: true };
}

async function copyText(text: string, copiedEvent: string, payload: Record<string, unknown>, errorLabel: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    globalEventBus.emit(copiedEvent as any, payload as any);
  } catch (error) {
    log.error(errorLabel, error as Error);
    globalEventBus.emit('toast:error', { message: i18nService.t('errors:general.copyFailed') });
  }
}

function serializeToolValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export class FlowChatMenuProvider implements IMenuProvider {
  readonly id = 'flowchat';
  readonly name = i18nService.t('common:contextMenu.flowChatMenu.name');
  readonly description = i18nService.t('common:contextMenu.flowChatMenu.description');
  readonly priority = 70;

  matches(context: MenuContext): boolean {
    return [
      ContextType.FLOWCHAT,
      ContextType.FLOWCHAT_TOOL_CARD,
      ContextType.FLOWCHAT_TEXT_BLOCK,
    ].includes(context.type);
  }

  async getMenuItems(context: MenuContext): Promise<MenuItem[]> {
    const flowChatContext = context as FlowChatContext;
    const items: MenuItem[] = [];
    const { dialogTurn, metadata } = flowChatContext;

    this.addSelectionItems(items, flowChatContext);
    this.addElementCopyItem(items, flowChatContext);

    if (dialogTurn && items.length > 0) {
      items.push(separator('flowchat-separator-1'));
      items.push({
        id: 'flowchat-copy-dialog',
        label: i18nService.t('flow-chat:contextMenu.copyDialog'),
        icon: 'MessageSquare',
        onClick: () => {
          globalEventBus.emit('flowchat:copy-dialog', {
            dialogTurn,
            context: flowChatContext,
          });
        },
      });
    }

    if (context.type === ContextType.FLOWCHAT_TOOL_CARD && metadata?.flowItem) {
      if (items.length > 0) {
        items.push(separator('flowchat-separator-2'));
      }
      items.push(...this.createToolItems(metadata.flowItem));
    }

    return items;
  }

  isEnabled(): boolean {
    return true;
  }

  private addSelectionItems(items: MenuItem[], flowChatContext: FlowChatContext): void {
    const { selectedText } = flowChatContext;
    if (!selectedText?.trim()) {
      return;
    }

    items.push({
      id: 'flowchat-copy-selected',
      label: i18nService.t('flow-chat:contextMenu.copySelection'),
      icon: 'Copy',
      shortcut: 'Ctrl+C',
      command: 'copy',
      onClick: async (ctx) => {
        await commandExecutor.execute('copy', ctx);
        globalEventBus.emit('flowchat:text-copied', {
          text: selectedText,
          type: 'selection',
        });
      },
    });
  }

  private addElementCopyItem(items: MenuItem[], flowChatContext: FlowChatContext): void {
    const { selectedText } = flowChatContext;
    const elementText = this.getElementText(flowChatContext.targetElement);
    if (!elementText || elementText === selectedText) {
      return;
    }

    items.push({
      id: 'flowchat-copy-element',
      label: selectedText
        ? i18nService.t('flow-chat:contextMenu.copyFullContent')
        : i18nService.t('flow-chat:contextMenu.copyContent'),
      icon: 'Copy',
      shortcut: selectedText ? undefined : 'Ctrl+C',
      onClick: () =>
        copyText(
          elementText,
          'flowchat:text-copied',
          { text: elementText, type: 'element' },
          'Failed to copy element text'
        ),
    });
  }

  private createToolItems(flowItem: any): MenuItem[] {
    const items: MenuItem[] = [
      {
        id: 'flowchat-copy-tool-input',
        label: i18nService.t('flow-chat:contextMenu.copyToolInput'),
        icon: 'FileInput',
        onClick: () =>
          copyText(
            JSON.stringify(flowItem.toolCall?.input || {}, null, 2),
            'flowchat:tool-data-copied',
            { type: 'input', data: JSON.stringify(flowItem.toolCall?.input || {}, null, 2) },
            'Failed to copy tool input'
          ),
      },
    ];

    if (flowItem.toolResult) {
      items.push({
        id: 'flowchat-copy-tool-output',
        label: i18nService.t('flow-chat:contextMenu.copyToolOutput'),
        icon: 'FileOutput',
        onClick: () => {
          const output = serializeToolValue(flowItem.toolResult.result);
          return copyText(
            output,
            'flowchat:tool-data-copied',
            { type: 'output', data: output },
            'Failed to copy tool output'
          );
        },
      });
    }

    return items;
  }

  private getElementText(element: HTMLElement): string {
    return (element?.textContent || element?.innerText || '').trim();
  }
}
