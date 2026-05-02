import * as monaco from 'monaco-editor';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('MonacoHelper');

export interface EditorSelection {
  hasSelection: boolean;
  selectedText?: string;
  range?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

export interface EditorPosition {
  line: number;
  column: number;
}

export interface EditorFileInfo {
  uri: string;
  filePath: string;
  relativePath?: string;
  language: string;
}

export interface EditorContextInfo {
  editor: monaco.editor.IStandaloneCodeEditor;
  fileInfo: EditorFileInfo;
  selection: EditorSelection;
  cursorPosition: EditorPosition;
  wordAtCursor?: string;
}

function parentMonacoElement(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.classList.contains('monaco-editor')) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function editorAttachedToElement(element: HTMLElement): monaco.editor.IStandaloneCodeEditor | null {
  const monacoElement = parentMonacoElement(element);
  return monacoElement?.['__monaco_editor__' as keyof HTMLElement] as monaco.editor.IStandaloneCodeEditor | null;
}

function editorContainingElement(element: HTMLElement): monaco.editor.IStandaloneCodeEditor | null {
  for (const editor of monaco.editor.getEditors()) {
    const domNode = editor.getDomNode();
    if (domNode && (domNode === element || domNode.contains(element))) {
      return editor as monaco.editor.IStandaloneCodeEditor;
    }
  }
  return null;
}

function decodeFilePath(filePath: string): string {
  try {
    return decodeURIComponent(filePath);
  } catch (_error) {
    log.debug('Failed to decode URI', { filePath });
    return filePath;
  }
}

function filePathFromUri(uri: string): string {
  if (uri.startsWith('file:///')) {
    return decodeFilePath(uri.substring(8));
  }
  if (uri.startsWith('file://')) {
    return decodeFilePath(uri.substring(7));
  }
  return decodeFilePath(uri);
}

function selectionRange(selection: monaco.Selection): EditorSelection['range'] {
  return {
    startLine: selection.startLineNumber,
    startColumn: selection.startColumn,
    endLine: selection.endLineNumber,
    endColumn: selection.endColumn,
  };
}

export class MonacoHelper {
  static getEditorFromElement(element: HTMLElement): monaco.editor.IStandaloneCodeEditor | null {
    try {
      return editorAttachedToElement(element) || editorContainingElement(element);
    } catch (error) {
      log.error('Failed to get editor from element', error as Error);
      return null;
    }
  }

  static getSelection(editor: monaco.editor.IStandaloneCodeEditor): EditorSelection {
    const selection = editor.getSelection();
    const model = editor.getModel();

    if (!selection || selection.isEmpty() || !model) {
      return { hasSelection: false };
    }

    return {
      hasSelection: true,
      selectedText: model.getValueInRange(selection),
      range: selectionRange(selection),
    };
  }

  static getCursorPosition(editor: monaco.editor.IStandaloneCodeEditor): EditorPosition | null {
    const position = editor.getPosition();
    return position
      ? {
          line: position.lineNumber,
          column: position.column,
        }
      : null;
  }

  static getWordAtCursor(editor: monaco.editor.IStandaloneCodeEditor): string | undefined {
    const model = editor.getModel();
    const position = editor.getPosition();
    return model && position ? model.getWordAtPosition(position)?.word : undefined;
  }

  static getFileInfo(editor: monaco.editor.IStandaloneCodeEditor): EditorFileInfo | null {
    const model = editor.getModel();
    if (!model) {
      return null;
    }

    const uri = model.uri.toString();
    const filePath = filePathFromUri(uri);

    return {
      uri,
      filePath,
      relativePath: filePath.split('/').pop() || filePath,
      language: model.getLanguageId(),
    };
  }

  static getContextInfo(editor: monaco.editor.IStandaloneCodeEditor): EditorContextInfo | null {
    const fileInfo = this.getFileInfo(editor);
    const cursorPosition = this.getCursorPosition(editor);

    if (!fileInfo || !cursorPosition) {
      return null;
    }

    return {
      editor,
      fileInfo,
      selection: this.getSelection(editor),
      cursorPosition,
      wordAtCursor: this.getWordAtCursor(editor),
    };
  }

  static isInMonacoEditor(element: HTMLElement): boolean {
    return parentMonacoElement(element) !== null;
  }

  static getVisibleRange(editor: monaco.editor.IStandaloneCodeEditor): monaco.Range | null {
    const [firstRange] = editor.getVisibleRanges();
    return firstRange || null;
  }

  static getLineContent(editor: monaco.editor.IStandaloneCodeEditor, lineNumber: number): string | null {
    const model = editor.getModel();
    if (!model) {
      return null;
    }

    try {
      return model.getLineContent(lineNumber);
    } catch (_error) {
      log.debug('Failed to get line content', { lineNumber });
      return null;
    }
  }

  static getContextCode(
    editor: monaco.editor.IStandaloneCodeEditor,
    startLine: number,
    endLine: number,
    contextLines: number = 3
  ): string | null {
    const model = editor.getModel();
    if (!model) {
      return null;
    }

    const contextStart = Math.max(1, startLine - contextLines);
    const contextEnd = Math.min(model.getLineCount(), endLine + contextLines);

    try {
      return model.getValueInRange({
        startLineNumber: contextStart,
        startColumn: 1,
        endLineNumber: contextEnd,
        endColumn: model.getLineMaxColumn(contextEnd),
      });
    } catch (_error) {
      log.debug('Failed to get context code');
      return null;
    }
  }
}
