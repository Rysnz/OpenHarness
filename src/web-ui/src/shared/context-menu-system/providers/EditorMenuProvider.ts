import { IMenuProvider } from '../types/provider.types';
import { MenuItem } from '../types/menu.types';
import { MenuContext, ContextType, EditorContext } from '../types/context.types';
import { commandExecutor } from '../commands/CommandExecutor';
import { globalEventBus } from '@/infrastructure/event-bus';
import { i18nService } from '@/infrastructure/i18n';
import { lspExtensionRegistry } from '@/tools/lsp/services/LspExtensionRegistry';
import type { CodeSnippetContext } from '@/shared/types/context';
import { useContextStore } from '@/shared/stores/contextStore';

type EditorPosition = {
  line: number;
  column: number;
};

type EditorEventPayload = {
  filePath?: string;
  editorId?: string;
  line?: number;
  column?: number;
};

type EditorEventName =
  | 'editor:format-document'
  | 'editor:goto-definition'
  | 'editor:goto-type-definition'
  | 'editor:find-references'
  | 'editor:rename-symbol'
  | 'editor:code-action'
  | 'editor:document-symbols'
  | 'editor:document-highlight';

type CommandMenuSpec = {
  id: string;
  labelKey: string;
  command: string;
  icon?: string;
  shortcut?: string;
};

type EditorEventSpec = {
  id: string;
  labelKey: string;
  event: EditorEventName;
  icon: string;
  shortcut?: string;
  includePosition?: boolean;
};

const LANGUAGE_HINT_BY_EXTENSION: Record<string, string> = {
  bash: 'shell',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cts: 'typescript',
  cxx: 'cpp',
  fs: 'fsharp',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  php: 'php',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scala: 'scala',
  scss: 'scss',
  sh: 'shell',
  sql: 'sql',
  svelte: 'svelte',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
};

const SELECTED_TEXT_COMMANDS: CommandMenuSpec[] = [
  {
    id: 'editor-copy',
    labelKey: 'common:actions.copy',
    icon: 'Copy',
    shortcut: 'Ctrl+C',
    command: 'copy',
  },
  {
    id: 'editor-cut',
    labelKey: 'common:actions.cut',
    icon: 'Scissors',
    shortcut: 'Ctrl+X',
    command: 'cut',
  },
];

const ALWAYS_AVAILABLE_COMMAND: CommandMenuSpec = {
  id: 'editor-select-all',
  labelKey: 'common:actions.selectAll',
  shortcut: 'Ctrl+A',
  command: 'select-all',
};

const PASTE_COMMAND: CommandMenuSpec = {
  id: 'editor-paste',
  labelKey: 'common:actions.paste',
  icon: 'Clipboard',
  shortcut: 'Ctrl+V',
  command: 'paste',
};

const FORMAT_DOCUMENT_ACTION: EditorEventSpec = {
  id: 'editor-format',
  labelKey: 'common:editor.formatDocument',
  event: 'editor:format-document',
  icon: 'Code',
  shortcut: 'Shift+Alt+F',
};

const POSITIONED_LSP_ACTIONS: EditorEventSpec[] = [
  {
    id: 'editor-goto-definition',
    labelKey: 'common:editor.goToDefinition',
    event: 'editor:goto-definition',
    icon: 'Navigation',
    shortcut: 'F12',
    includePosition: true,
  },
  {
    id: 'editor-goto-type-definition',
    labelKey: 'common:editor.goToTypeDefinition',
    event: 'editor:goto-type-definition',
    icon: 'FileType',
    includePosition: true,
  },
  {
    id: 'editor-find-references',
    labelKey: 'common:editor.findAllReferences',
    event: 'editor:find-references',
    icon: 'Search',
    shortcut: 'Shift+F12',
    includePosition: true,
  },
];

const WRITABLE_LSP_ACTIONS: EditorEventSpec[] = [
  {
    id: 'editor-rename-symbol',
    labelKey: 'common:editor.renameSymbol',
    event: 'editor:rename-symbol',
    icon: 'Edit',
    shortcut: 'F2',
    includePosition: true,
  },
  {
    id: 'editor-code-action',
    labelKey: 'common:editor.quickFix',
    event: 'editor:code-action',
    icon: 'Lightbulb',
    shortcut: 'Ctrl+.',
    includePosition: true,
  },
];

const DOCUMENT_LSP_ACTIONS: EditorEventSpec[] = [
  {
    id: 'editor-document-symbols',
    labelKey: 'common:editor.goToSymbol',
    event: 'editor:document-symbols',
    icon: 'List',
    shortcut: 'Ctrl+Shift+O',
  },
  {
    id: 'editor-document-highlight',
    labelKey: 'common:editor.highlightAllOccurrences',
    event: 'editor:document-highlight',
    icon: 'Highlighter',
    includePosition: true,
  },
];

function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function languageHintFromPath(filePath: string): string | undefined {
  const fileName = fileNameFromPath(filePath);
  const extensionStart = fileName.lastIndexOf('.');

  if (extensionStart < 0) {
    return undefined;
  }

  return LANGUAGE_HINT_BY_EXTENSION[fileName.slice(extensionStart + 1).toLowerCase()];
}

function newSnippetContextId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `code-snippet-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function separator(id: string): MenuItem {
  return {
    id,
    label: '',
    separator: true,
  };
}

function commandItem(spec: CommandMenuSpec): MenuItem {
  return {
    id: spec.id,
    label: i18nService.t(spec.labelKey),
    icon: spec.icon,
    shortcut: spec.shortcut,
    command: spec.command,
    onClick: async (ctx) => {
      await commandExecutor.execute(spec.command, ctx);
    },
  };
}

function editorPosition(editorContext: EditorContext): EditorPosition {
  return editorContext.cursorPosition ?? { line: 1, column: 1 };
}

function emitEditorAction(
  event: EditorEventName,
  editorContext: EditorContext,
  position?: EditorPosition
): void {
  const payload: EditorEventPayload = {
    filePath: editorContext.filePath,
    editorId: editorContext.editorId,
  };

  if (position) {
    payload.line = position.line;
    payload.column = position.column;
  }

  globalEventBus.emit(event, payload);
}

function eventItem(
  spec: EditorEventSpec,
  editorContext: EditorContext,
  position: EditorPosition
): MenuItem {
  return {
    id: spec.id,
    label: i18nService.t(spec.labelKey),
    icon: spec.icon,
    shortcut: spec.shortcut,
    onClick: () => {
      emitEditorAction(
        spec.event,
        editorContext,
        spec.includePosition ? position : undefined
      );
    },
  };
}

function createSnippetContext(editorContext: EditorContext): CodeSnippetContext {
  const filePath = editorContext.filePath!;
  const startLine =
    editorContext.selectionRange?.startLine ??
    editorContext.cursorPosition?.line ??
    1;
  const endLine =
    editorContext.selectionRange?.endLine ??
    editorContext.cursorPosition?.line ??
    startLine;

  return {
    type: 'code-snippet',
    id: newSnippetContextId(),
    timestamp: Date.now(),
    filePath,
    fileName: fileNameFromPath(filePath),
    startLine,
    endLine,
    selectedText: editorContext.selectedText!,
    language: languageHintFromPath(filePath),
  };
}

function addSnippetToChat(editorContext: EditorContext): void {
  const context = createSnippetContext(editorContext);

  useContextStore.getState().addContext(context);
  window.dispatchEvent(
    new CustomEvent('insert-context-tag', { detail: { context } })
  );
}

function appendSelectionCommands(items: MenuItem[], editorContext: EditorContext): void {
  if (!editorContext.selectedText) {
    return;
  }

  for (const spec of SELECTED_TEXT_COMMANDS) {
    if (spec.command === 'cut' && editorContext.isReadOnly) {
      continue;
    }

    items.push(commandItem(spec));
  }
}

function appendCoreEditCommands(items: MenuItem[], editorContext: EditorContext): void {
  if (!editorContext.isReadOnly) {
    items.push(commandItem(PASTE_COMMAND));
  }

  items.push(separator('editor-separator-1'));
  items.push(commandItem(ALWAYS_AVAILABLE_COMMAND));
}

function appendChatContextAction(items: MenuItem[], editorContext: EditorContext): void {
  if (!editorContext.selectedText || !editorContext.filePath) {
    return;
  }

  items.push(separator('editor-separator-add-to-chat'));
  items.push({
    id: 'editor-add-to-chat',
    label: i18nService.t('common:editor.addToChat'),
    icon: 'MessageSquarePlus',
    onClick: () => addSnippetToChat(editorContext),
  });
}

function editorFileHasLsp(filePath?: string): boolean {
  return Boolean(filePath && lspExtensionRegistry.isFileSupported(filePath));
}

function appendFormatAction(items: MenuItem[], editorContext: EditorContext): void {
  if (editorContext.isReadOnly || !editorFileHasLsp(editorContext.filePath)) {
    return;
  }

  items.push(separator('editor-separator-2'));
  items.push(eventItem(FORMAT_DOCUMENT_ACTION, editorContext, editorPosition(editorContext)));
}

function appendLspActions(items: MenuItem[], editorContext: EditorContext): void {
  if (!editorContext.filePath || !editorFileHasLsp(editorContext.filePath)) {
    return;
  }

  const position = editorPosition(editorContext);

  items.push(separator('editor-separator-lsp'));
  for (const action of POSITIONED_LSP_ACTIONS) {
    items.push(eventItem(action, editorContext, position));
  }

  if (!editorContext.isReadOnly) {
    for (const action of WRITABLE_LSP_ACTIONS) {
      items.push(eventItem(action, editorContext, position));
    }
  }

  items.push(separator('editor-separator-more'));
  for (const action of DOCUMENT_LSP_ACTIONS) {
    items.push(eventItem(action, editorContext, position));
  }
}

export class EditorMenuProvider implements IMenuProvider {
  readonly id = 'editor';
  readonly name = i18nService.t('common:contextMenu.editorMenu.name');
  readonly description = i18nService.t('common:contextMenu.editorMenu.description');
  readonly priority = 50;

  matches(context: MenuContext): boolean {
    return context.type === ContextType.EDITOR;
  }

  async getMenuItems(context: MenuContext): Promise<MenuItem[]> {
    const editorContext = context as EditorContext;
    const items: MenuItem[] = [];

    appendSelectionCommands(items, editorContext);
    appendCoreEditCommands(items, editorContext);
    appendChatContextAction(items, editorContext);
    appendFormatAction(items, editorContext);
    appendLspActions(items, editorContext);

    return items;
  }

  isEnabled(): boolean {
    return true;
  }
}
