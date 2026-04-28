/**
 * Centralized terminal action manager.
 * Keeps a fixed number of EventBus listeners regardless of instance count.
 * Adds multi-line paste confirmation similar to VS Code.
 */

import { Terminal as XTerm } from '@xterm/xterm';
import { globalEventBus } from '@/infrastructure/event-bus';
import { confirmWarning } from '@/component-library';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('TerminalActionManager');

/** Line threshold for multi-line paste confirmation. */
const MULTILINE_PASTE_THRESHOLD = 1;
const PASTE_PREVIEW_LINE_LIMIT = 10;

const TERMINAL_SHORTCUTS: Record<string, TerminalShortcutAction> = {
  a: 'select-all',
  c: 'copy',
  v: 'paste',
};

export interface TerminalActionHandler {
  getTerminal: () => XTerm | null;
  /** Read-only terminals cannot paste or clear. */
  isReadOnly?: boolean;
  write?: (data: string) => Promise<void> | void;
  clear?: () => void;
}

type TerminalShortcutAction = 'copy' | 'paste' | 'select-all';
type TerminalActionPayload = { terminalId: string };
type TerminalCopyPayload = TerminalActionPayload & { selectedText?: string };
type TerminalEventName = 'terminal:copy' | 'terminal:paste' | 'terminal:select-all' | 'terminal:clear';

type TerminalEventSubscription = {
  event: TerminalEventName;
  handler: (payload: any) => void | Promise<void>;
};

class TerminalActionManager {
  private static instance: TerminalActionManager;
  
  private handlers = new Map<string, TerminalActionHandler>();
  
  private unsubscribers: (() => void)[] = [];

  private keyboardListenerAttached = false;
  
  private initialized = false;

  private constructor() {
  }

  static getInstance(): TerminalActionManager {
    if (!TerminalActionManager.instance) {
      TerminalActionManager.instance = new TerminalActionManager();
    }
    return TerminalActionManager.instance;
  }

  init(): void {
    if (this.initialized) {
      return;
    }

    this.unsubscribers = this.eventSubscriptions().map(({ event, handler }) =>
      globalEventBus.on(event, handler)
    );
    this.attachKeyboardListener();
    this.initialized = true;
  }

  destroy(): void {
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];
    this.detachKeyboardListener();
    this.handlers.clear();
    this.initialized = false;
  }

  register(terminalId: string, handler: TerminalActionHandler): void {
    if (!this.initialized) {
      this.init();
    }

    this.handlers.set(terminalId, handler);
    log.debug('Terminal registered', { terminalId, total: this.handlers.size });
  }

  unregister(terminalId: string): void {
    const deleted = this.handlers.delete(terminalId);
    if (deleted) {
      log.debug('Terminal unregistered', { terminalId, total: this.handlers.size });
    }
  }

  getRegisteredCount(): number {
    return this.handlers.size;
  }

  private attachKeyboardListener(): void {
    if (this.keyboardListenerAttached || typeof window === 'undefined') {
      return;
    }

    window.addEventListener('keydown', this.handleKeyDown, true);
    this.keyboardListenerAttached = true;
  }

  private detachKeyboardListener(): void {
    if (!this.keyboardListenerAttached || typeof window === 'undefined') {
      return;
    }

    window.removeEventListener('keydown', this.handleKeyDown, true);
    this.keyboardListenerAttached = false;
  }

  private eventSubscriptions(): TerminalEventSubscription[] {
    return [
      { event: 'terminal:copy', handler: this.handleCopy },
      { event: 'terminal:paste', handler: this.handlePaste },
      { event: 'terminal:select-all', handler: this.handleSelectAll },
      { event: 'terminal:clear', handler: this.handleClear },
    ];
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    const shortcutAction = this.getShortcutAction(event);
    if (!shortcutAction) {
      return;
    }

    const terminalId = this.resolveTerminalIdForEvent(event);
    if (!terminalId) {
      return;
    }

    const handler = this.findHandler(terminalId);
    if (!handler) {
      return;
    }

    if (shortcutAction === 'paste' && !this.canWrite(handler)) {
      return;
    }

    this.stopKeyboardEvent(event);

    if (shortcutAction === 'copy') {
      void this.handleCopy({
        terminalId,
        selectedText: this.getSelectedTextFromTerminal(handler),
      });
      return;
    }

    if (shortcutAction === 'paste') {
      void this.handlePaste({ terminalId });
      return;
    }

    this.handleSelectAll({ terminalId });
  };

  private getShortcutAction(event: KeyboardEvent): TerminalShortcutAction | null {
    if (event.type !== 'keydown' || !this.isTerminalShortcutChord(event)) {
      return null;
    }

    return TERMINAL_SHORTCUTS[event.key.toLowerCase()] ?? null;
  }

  private isTerminalShortcutChord(event: KeyboardEvent): boolean {
    return event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;
  }

  private stopKeyboardEvent(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  private resolveTerminalIdForEvent(event: KeyboardEvent): string | null {
    for (const candidate of this.eventElementCandidates(event)) {
      const terminalId = this.getTerminalIdFromElement(candidate);
      if (terminalId) {
        return terminalId;
      }
    }

    let matchedTerminalId: string | null = null;
    for (const [terminalId, handler] of this.handlers.entries()) {
      const selectedText = this.getSelectedTextFromTerminal(handler);
      if (!selectedText) {
        continue;
      }

      if (matchedTerminalId) {
        return null;
      }

      matchedTerminalId = terminalId;
    }

    return matchedTerminalId;
  }

  private eventElementCandidates(event: KeyboardEvent): Array<Element | null> {
    return [
      event.target instanceof Element ? event.target : null,
      typeof document !== 'undefined' && document.activeElement instanceof Element
        ? document.activeElement
        : null,
      this.getSelectionElement(),
    ];
  }

  private getSelectionElement(): Element | null {
    if (typeof window === 'undefined') {
      return null;
    }

    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    if (!anchorNode) {
      return null;
    }

    return anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
  }

  private getTerminalIdFromElement(element: Element | null): string | null {
    if (!(element instanceof Element)) {
      return null;
    }

    return element.closest('[data-terminal-id]')?.getAttribute('data-terminal-id') || null;
  }

  private getSelectedTextFromTerminal(handler: TerminalActionHandler): string {
    return handler.getTerminal()?.getSelection() || '';
  }

  private findHandler(terminalId: string): TerminalActionHandler | null {
    return this.handlers.get(terminalId) ?? null;
  }

  private canWrite(handler: TerminalActionHandler): boolean {
    return !handler.isReadOnly && Boolean(handler.write);
  }

  private handleCopy = async (data: TerminalCopyPayload): Promise<void> => {
    const handler = this.findHandler(data.terminalId);
    if (!handler) {
      return;
    }

    const terminal = handler.getTerminal();
    if (!terminal) {
      return;
    }

    const selection = terminal.getSelection() || data.selectedText || '';
    if (selection) {
      try {
        await navigator.clipboard.writeText(selection);
      } catch (err) {
        log.error('Copy failed', { terminalId: data.terminalId, error: err });
      }
    }
  };

  /**
   * Paste handler with multi-line confirmation.
   */
  private handlePaste = async (data: TerminalActionPayload): Promise<void> => {
    const handler = this.findHandler(data.terminalId);
    if (!handler || !this.canWrite(handler)) {
      return;
    }
    const write = handler.write!;

    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        return;
      }

      const pastePreview = this.buildPastePreview(text);
      if (pastePreview && !(await this.confirmMultilinePaste(pastePreview))) {
        return;
      }

      await write(text);
      
    } catch (err) {
      log.error('Paste failed', { terminalId: data.terminalId, error: err });
    }
  };

  private buildPastePreview(text: string): { lineCount: number; preview: string } | null {
    const lines = text.split('\n');
    const lineCount = lines.length;

    if (lineCount <= MULTILINE_PASTE_THRESHOLD) {
      return null;
    }

    const previewLines = lines.slice(0, PASTE_PREVIEW_LINE_LIMIT);
    const suffix =
      lineCount > PASTE_PREVIEW_LINE_LIMIT ? `\n... (${lineCount} lines total)` : '';

    return {
      lineCount,
      preview: `${previewLines.join('\n')}${suffix}`,
    };
  }

  private async confirmMultilinePaste(details: {
    lineCount: number;
    preview: string;
  }): Promise<boolean> {
    return confirmWarning(
      'Paste multiple lines',
      `The clipboard contains ${details.lineCount} lines. Pasting multiple lines in a terminal may execute multiple commands.`,
      {
        confirmText: 'Paste',
        cancelText: 'Cancel',
        preview: details.preview,
        previewMaxHeight: 150,
      }
    );
  }

  private handleSelectAll = (data: TerminalActionPayload): void => {
    const handler = this.findHandler(data.terminalId);
    if (!handler) {
      return;
    }

    const terminal = handler.getTerminal();
    if (terminal) {
      terminal.selectAll();
    }
  };

  private handleClear = (data: TerminalActionPayload): void => {
    const handler = this.findHandler(data.terminalId);
    if (!handler) {
      return;
    }

    if (handler.isReadOnly || !handler.clear) {
      return;
    }

    handler.clear();
  };
}

export const terminalActionManager = TerminalActionManager.getInstance();

export function registerTerminalActions(terminalId: string, handler: TerminalActionHandler): void {
  terminalActionManager.register(terminalId, handler);
}

export function unregisterTerminalActions(terminalId: string): void {
  terminalActionManager.unregister(terminalId);
}
