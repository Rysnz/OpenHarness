import type * as monaco from 'monaco-editor';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('EditorExtensionManager');

type ExtensionDisposable = monaco.IDisposable | (() => void);

export interface EditorExtension {
  id: string;
  name: string;
  priority: number;

  onEditorCreated?(
    editor: monaco.editor.IStandaloneCodeEditor,
    model: monaco.editor.ITextModel,
    context: EditorExtensionContext
  ): void | ExtensionDisposable;

  onEditorWillDispose?(
    editor: monaco.editor.IStandaloneCodeEditor,
    model: monaco.editor.ITextModel,
    context: EditorExtensionContext
  ): void;

  onModelChanged?(
    editor: monaco.editor.IStandaloneCodeEditor,
    oldModel: monaco.editor.ITextModel | null,
    newModel: monaco.editor.ITextModel | null,
    context: EditorExtensionContext
  ): void;

  onContentChanged?(
    editor: monaco.editor.IStandaloneCodeEditor,
    model: monaco.editor.ITextModel,
    event: monaco.editor.IModelContentChangedEvent,
    context: EditorExtensionContext
  ): void;
}

export interface EditorExtensionContext {
  filePath: string;
  language: string;
  workspacePath?: string;
  readOnly: boolean;
  enableLsp: boolean;
}

interface ExtensionRegistration {
  extension: EditorExtension;
  disposables: Map<string, ExtensionDisposable>;
}

const disposeExtensionResource = (
  extensionId: string,
  disposable: ExtensionDisposable
): void => {
  try {
    if (typeof disposable === 'function') {
      disposable();
    } else {
      disposable.dispose();
    }
  } catch (error) {
    log.error('Error disposing extension', { extensionId, error });
  }
};

class EditorExtensionManager {
  private static instance: EditorExtensionManager;

  private readonly extensions = new Map<string, ExtensionRegistration>();
  private editorIdCounter = 0;

  private constructor() {}

  public static getInstance(): EditorExtensionManager {
    EditorExtensionManager.instance ??= new EditorExtensionManager();
    return EditorExtensionManager.instance;
  }

  public register(extension: EditorExtension): () => void {
    if (this.extensions.has(extension.id)) {
      log.warn('Extension already registered, replacing', { extensionId: extension.id });
      this.unregister(extension.id);
    }

    this.extensions.set(extension.id, {
      extension,
      disposables: new Map(),
    });

    log.debug('Extension registered', { extensionId: extension.id, priority: extension.priority });
    return () => this.unregister(extension.id);
  }

  public unregister(extensionId: string): void {
    const registration = this.extensions.get(extensionId);
    if (!registration) {
      return;
    }

    registration.disposables.forEach((disposable) => {
      disposeExtensionResource(extensionId, disposable);
    });
    this.extensions.delete(extensionId);
  }

  public notifyEditorCreated(
    editor: monaco.editor.IStandaloneCodeEditor,
    model: monaco.editor.ITextModel,
    context: EditorExtensionContext
  ): string {
    const editorId = this.createEditorId();

    this.forEachExtension('onEditorCreated', (registration) => {
      const result = registration.extension.onEditorCreated?.(editor, model, context);
      if (result) {
        registration.disposables.set(editorId, result);
      }
    });

    return editorId;
  }

  public notifyEditorWillDispose(
    editorId: string,
    editor: monaco.editor.IStandaloneCodeEditor,
    model: monaco.editor.ITextModel,
    context: EditorExtensionContext
  ): void {
    this.forEachExtension('onEditorWillDispose', (registration) => {
      registration.extension.onEditorWillDispose?.(editor, model, context);
      this.disposeEditorScopedResource(registration, editorId);
    });
  }

  public notifyModelChanged(
    editor: monaco.editor.IStandaloneCodeEditor,
    oldModel: monaco.editor.ITextModel | null,
    newModel: monaco.editor.ITextModel | null,
    context: EditorExtensionContext
  ): void {
    this.forEachExtension('onModelChanged', ({ extension }) => {
      extension.onModelChanged?.(editor, oldModel, newModel, context);
    });
  }

  public notifyContentChanged(
    editor: monaco.editor.IStandaloneCodeEditor,
    model: monaco.editor.ITextModel,
    event: monaco.editor.IModelContentChangedEvent,
    context: EditorExtensionContext
  ): void {
    this.forEachExtension('onContentChanged', ({ extension }) => {
      extension.onContentChanged?.(editor, model, event, context);
    });
  }

  public getExtensions(): EditorExtension[] {
    return this.sortedRegistrations().map((registration) => registration.extension);
  }

  public hasExtension(extensionId: string): boolean {
    return this.extensions.has(extensionId);
  }

  private createEditorId(): string {
    this.editorIdCounter += 1;
    return `editor-${this.editorIdCounter}`;
  }

  private forEachExtension(
    hookName: keyof Pick<
      EditorExtension,
      'onEditorCreated' | 'onEditorWillDispose' | 'onModelChanged' | 'onContentChanged'
    >,
    invoke: (registration: ExtensionRegistration) => void
  ): void {
    for (const registration of this.sortedRegistrations()) {
      try {
        invoke(registration);
      } catch (error) {
        log.error(`Error in extension ${hookName}`, {
          extensionId: registration.extension.id,
          error
        });
      }
    }
  }

  private disposeEditorScopedResource(
    registration: ExtensionRegistration,
    editorId: string
  ): void {
    const disposable = registration.disposables.get(editorId);
    if (!disposable) {
      return;
    }

    disposeExtensionResource(registration.extension.id, disposable);
    registration.disposables.delete(editorId);
  }

  private sortedRegistrations(): ExtensionRegistration[] {
    return Array.from(this.extensions.values()).sort(
      (left, right) => left.extension.priority - right.extension.priority
    );
  }
}

export const editorExtensionManager = EditorExtensionManager.getInstance();
export default EditorExtensionManager;
