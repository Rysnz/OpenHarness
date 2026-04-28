 

import { IMenuProvider } from '../types/provider.types';
import { MenuItem } from '../types/menu.types';
import { MenuContext, ContextType, FileNodeContext } from '../types/context.types';
import { commandExecutor } from '../commands/CommandExecutor';
import { globalEventBus } from '../../../infrastructure/event-bus';
import { i18nService } from '../../../infrastructure/i18n';
import { workspaceManager } from '../../../infrastructure/services/business/workspaceManager';
import { isRemoteWorkspace } from '../../../shared/types';
import { addFileMentionToChat } from '@/shared/utils/chatContext';

const separator = (id: string): MenuItem => ({
  id,
  label: '',
  separator: true
});

export class FileExplorerMenuProvider implements IMenuProvider {
  readonly id = 'file-explorer';
  readonly name = i18nService.t('common:contextMenu.fileExplorerMenu.name');
  readonly description = i18nService.t('common:contextMenu.fileExplorerMenu.description');
  readonly priority = 80;

  matches(context: MenuContext): boolean {
    
    if (context.type === ContextType.FILE_NODE || context.type === ContextType.FOLDER_NODE) {
      return true;
    }
    
    
    if (context.type === ContextType.EMPTY_SPACE) {
      const emptyContext = context as any;
      return emptyContext.area === 'file-explorer';
    }
    
    return false;
  }

  async getMenuItems(context: MenuContext): Promise<MenuItem[]> {
    const revealInExplorerDisabled = isRemoteWorkspace(workspaceManager.getState().currentWorkspace);

    if (context.type === ContextType.EMPTY_SPACE) {
      return this.getEmptySpaceItems(context as any);
    }

    const fileContext = context as FileNodeContext;
    const isDirectory = Boolean(fileContext.isDirectory);
    const isReadOnly = Boolean(fileContext.isReadOnly);
    const items: MenuItem[] = [
      ...this.getOpenItems(fileContext),
      ...this.getWriteItems(fileContext, isReadOnly),
      ...this.getChatItems(fileContext, isDirectory),
      ...this.getPathItems(revealInExplorerDisabled),
    ];

    return items;
  }

  private getEmptySpaceItems(context: { targetElement?: HTMLElement | null }): MenuItem[] {
    const parentPath = this.findWorkspaceRoot(context.targetElement ?? null);

    if (!parentPath) {
      return [];
    }

    return [
      {
        id: 'file-new-file',
        label: i18nService.t('common:file.newFile'),
        icon: 'FilePlus',
        onClick: () => {
          globalEventBus.emit('file:new-file', { parentPath });
        }
      },
      {
        id: 'file-new-folder',
        label: i18nService.t('common:file.newFolder'),
        icon: 'FolderPlus',
        onClick: () => {
          globalEventBus.emit('file:new-folder', { parentPath });
        }
      },
      separator('file-separator-paste'),
      {
        id: 'file-paste',
        label: i18nService.t('common:actions.paste'),
        icon: 'Clipboard',
        shortcut: 'Ctrl+V',
        onClick: async () => {
          globalEventBus.emit('file:paste', { targetDirectory: parentPath });
        }
      }
    ];
  }

  private getOpenItems(fileContext: FileNodeContext): MenuItem[] {
    if (fileContext.isDirectory) {
      return [];
    }

    return [
      {
        id: 'file-open',
        label: i18nService.t('common:actions.open'),
        icon: 'FileText',
        onClick: () => {
            globalEventBus.emit('file:open', { path: fileContext.filePath });
          }
      },
      {
        id: 'file-download',
        label: i18nService.t('common:file.download'),
        icon: 'Download',
        onClick: () => {
            globalEventBus.emit('file:download', { path: fileContext.filePath });
          }
      },
      separator('file-separator-1')
    ];
  }

  private getWriteItems(fileContext: FileNodeContext, isReadOnly: boolean): MenuItem[] {
    if (isReadOnly) {
      return [];
    }

    const items: MenuItem[] = [];

    if (fileContext.isDirectory) {
      items.push({
          id: 'file-new',
          label: i18nService.t('common:actions.new'),
          icon: 'Plus',
          submenu: [
            {
              id: 'file-new-file',
              label: i18nService.t('common:file.file'),
              icon: 'FilePlus',
              command: 'file.new-file',
              onClick: async (ctx) => {
                await commandExecutor.execute('file.new-file', ctx);
              }
            },
            {
              id: 'file-new-folder',
              label: i18nService.t('common:file.folder'),
              icon: 'FolderPlus',
              command: 'file.new-folder',
              onClick: async (ctx) => {
                await commandExecutor.execute('file.new-folder', ctx);
              }
            }
          ]
      });
    }

    items.push(
      {
        id: 'file-rename',
        label: i18nService.t('common:file.rename'),
        icon: 'Edit',
        shortcut: 'F2',
        command: 'file.rename',
        onClick: async (ctx) => {
          await commandExecutor.execute('file.rename', ctx);
        }
      },
      {
        id: 'file-delete',
        label: i18nService.t('common:file.delete'),
        icon: 'Trash2',
        command: 'file.delete',
        onClick: async (ctx) => {
          await commandExecutor.execute('file.delete', ctx);
        }
      },
      separator('file-separator-3'),
      {
        id: 'file-paste',
        label: i18nService.t('common:actions.paste'),
        icon: 'Clipboard',
        shortcut: 'Ctrl+V',
        onClick: async () => {
          globalEventBus.emit('file:paste', {
            targetDirectory: this.getPasteTargetDirectory(fileContext)
          });
        }
      },
      separator('file-separator-paste')
    );

    return items;
  }

  private getChatItems(fileContext: FileNodeContext, isDirectory: boolean): MenuItem[] {
    return [
      {
      id: 'file-add-to-chat',
      label: i18nService.t('common:editor.addToChat'),
      icon: 'MessageSquarePlus',
      onClick: () => {
        addFileMentionToChat(
          {
            path: fileContext.filePath,
            name: fileContext.fileName,
            isDirectory,
          },
          fileContext.workspacePath,
        );
      }
      },
      separator('file-separator-chat')
    ];
  }

  private getPathItems(revealInExplorerDisabled: boolean): MenuItem[] {
    return [
      {
      id: 'file-copy-path',
      label: i18nService.t('common:file.copyPath'),
      icon: 'Copy',
      command: 'file.copy-path',
      onClick: async (ctx) => {
        await commandExecutor.execute('file.copy-path', ctx);
      }
      },
      {
      id: 'file-copy-relative-path',
      label: i18nService.t('common:file.copyRelativePath'),
      icon: 'Copy',
      command: 'file.copy-relative-path',
      onClick: async (ctx) => {
        await commandExecutor.execute('file.copy-relative-path', ctx);
      }
      },
      {
      id: 'file-reveal',
      label: i18nService.t('common:file.reveal'),
      icon: 'FolderOpen',
      command: 'file.reveal-in-explorer',
      disabled: revealInExplorerDisabled,
      onClick: async (ctx) => {
        await commandExecutor.execute('file.reveal-in-explorer', ctx);
      }
      }
    ];
  }

  isEnabled(): boolean {
    return true;
  }

   
  private findWorkspaceRoot(element: HTMLElement | null): string | null {
    let current = element;
    
    while (current && current !== document.body) {
      const workspaceRoot = current.getAttribute('data-workspace-root');
      if (workspaceRoot) {
        return workspaceRoot;
      }
      current = current.parentElement;
    }
    
    return null;
  }

   
  private getParentDirectory(filePath: string): string {
    const isWindows = filePath.includes('\\');
    const separator = isWindows ? '\\' : '/';
    const parts = filePath.split(separator);
    parts.pop();
    return parts.join(separator);
  }

  private getPasteTargetDirectory(fileContext: FileNodeContext): string {
    return fileContext.isDirectory
      ? fileContext.filePath
      : this.getParentDirectory(fileContext.filePath);
  }
}
