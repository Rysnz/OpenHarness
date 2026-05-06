import { BaseCommand } from '../BaseCommand';
import { CommandResult } from '../../types/command.types';
import { MenuContext, ContextType, EditorContext } from '../../types/context.types';
import { MonacoHelper } from '@/shared/helpers/MonacoHelper';
import { createLogger } from '@/shared/utils/logger';
import { i18nService } from '@/infrastructure/i18n';

const log = createLogger('SelectAllCommand');

export class SelectAllCommand extends BaseCommand {
  constructor() {
    const t = i18nService.getT();
    super({
      id: 'select-all',
      label: t('common:actions.selectAll'),
      description: t('common:contextMenu.descriptions.selectAll'),
      icon: 'SelectAll',
      shortcut: 'Ctrl+A',
      category: 'edit'
    });
  }

  canExecute(context: MenuContext): boolean {
    return context.type === ContextType.EDITOR || context.type === ContextType.SELECTION;
  }

  async execute(context: MenuContext): Promise<CommandResult> {
    try {
      const t = i18nService.getT();

      if (context.type === ContextType.EDITOR) {
        return await this.executeForEditor(context as EditorContext);
      }

      selectDocumentTarget(context.targetElement);
      return this.success(t('common:contextMenu.status.selectAllSuccess'));
    } catch (error) {
      const t = i18nService.getT();
      return this.failure(t('errors:contextMenu.selectAllFailed'), error as Error);
    }
  }

  private async executeForEditor(context: EditorContext): Promise<CommandResult> {
    try {
      const t = i18nService.getT();
      const editor = MonacoHelper.getEditorFromElement(context.targetElement);

      if (!editor) {
        log.warn('Editor instance not found, using fallback method');

        return tryLegacySelectAll()
          ? this.success(t('common:contextMenu.status.selectAllSuccess'))
          : this.failure(t('errors:contextMenu.selectAllFailed'));
      }

      const model = editor.getModel();
      if (!model) {
        return this.failure(t('errors:contextMenu.editorModelUnavailable'));
      }

      const lastLine = model.getLineCount();
      editor.setSelection({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: lastLine,
        endColumn: model.getLineMaxColumn(lastLine)
      });
      editor.focus();

      return this.success(t('common:contextMenu.status.selectAllSuccess'));
    } catch (error) {
      log.error('Failed to select all in Monaco editor', error as Error);
      const t = i18nService.getT();
      return this.failure(t('errors:contextMenu.selectAllFailed'), error as Error);
    }
  }
}

function tryLegacySelectAll(): boolean {
  return document.execCommand('selectAll');
}

function selectDocumentTarget(target: HTMLElement): void {
  if (tryLegacySelectAll()) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(target);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

