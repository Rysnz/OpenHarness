/**
 * Terminal resize debouncer with split X/Y strategies and visibility-aware scheduling.
 */

import type { Terminal } from '@xterm/xterm';

/** Start debouncing when buffer rows exceed this threshold. */
const START_DEBOUNCING_THRESHOLD = 200;

/** Debounce delay for X-axis resize (ms). */
const RESIZE_X_DEBOUNCE_MS = 100;

/** Backend resize merge delay (ms). */
const BACKEND_RESIZE_DEBOUNCE_MS = 50;

/** Idle callback timeout (ms). */
const IDLE_CALLBACK_TIMEOUT_MS = 2000;

interface TerminalSize {
  cols: number;
  rows: number;
}

export interface ResizeCallback {
  (cols: number, rows: number): void | Promise<void>;
}

export interface ResizeDebounceOptions {
  getTerminal: () => Terminal | null;
  isVisible: () => boolean;
  /** Local xterm resize callback. */
  onXtermResize: (cols: number, rows: number) => void;
  /** Backend PTY resize callback (debounced/merged). */
  onBackendResize: (cols: number, rows: number) => void | Promise<void>;
  /** Optional hook invoked after flush. */
  onFlush?: () => void;
  /** Optional hook invoked after resize completes. */
  onResizeComplete?: () => void;
}

// Legacy options interface.
export interface LegacyResizeDebounceOptions {
  getTerminal: () => Terminal | null;
  isVisible: () => boolean;
  onResizeBoth: ResizeCallback;
  onResizeX: (cols: number) => void | Promise<void>;
  onResizeY: (rows: number) => void | Promise<void>;
  /** Optional hook invoked after flush. */
  onFlush?: () => void;
}

/** requestIdleCallback polyfill. */
const requestIdleCallback = 
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? window.requestIdleCallback
    : (cb: IdleRequestCallback, options?: IdleRequestOptions) => {
        const start = Date.now();
        return window.setTimeout(() => {
          cb({
            didTimeout: false,
            timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
          });
        }, options?.timeout ?? 1) as unknown as number;
      };

const cancelIdleCallback =
  typeof window !== 'undefined' && 'cancelIdleCallback' in window
    ? window.cancelIdleCallback
    : (id: number) => clearTimeout(id);

/** Check whether options use the new API. */
function isNewOptions(options: ResizeDebounceOptions | LegacyResizeDebounceOptions): options is ResizeDebounceOptions {
  return 'onXtermResize' in options && 'onBackendResize' in options;
}

function getTerminalSize(terminal: Terminal): TerminalSize {
  return {
    cols: terminal.cols,
    rows: terminal.rows,
  };
}

function sameSize(size: TerminalSize, cols: number, rows: number): boolean {
  return size.cols === cols && size.rows === rows;
}

function shouldResizeImmediately(terminal: Terminal, immediate: boolean): boolean {
  return immediate || terminal.buffer.normal.length < START_DEBOUNCING_THRESHOLD;
}

/**
 * Debounced terminal resize controller.
 * Uses immediate resize for small buffers, debounced backend updates, and idle scheduling when hidden.
 */
export class TerminalResizeDebouncer {
  private latestCols = 0;
  private latestRows = 0;
  
  private resizeXTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private resizeXIdleCallbackId: number | null = null;
  private resizeYIdleCallbackId: number | null = null;
  
  private backendResizeTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private pendingBackendResize: { cols: number; rows: number } | null = null;
  
  private readonly options: ResizeDebounceOptions | LegacyResizeDebounceOptions;
  private readonly isNewApi: boolean;
  private disposed = false;

  constructor(options: ResizeDebounceOptions | LegacyResizeDebounceOptions) {
    this.options = options;
    this.isNewApi = isNewOptions(options);
  }

  private get newOptions(): ResizeDebounceOptions {
    return this.options as ResizeDebounceOptions;
  }

  private get legacyOptions(): LegacyResizeDebounceOptions {
    return this.options as LegacyResizeDebounceOptions;
  }

  /**
   * Request a resize operation.
   */
  resize(cols: number, rows: number, immediate = false): void {
    if (this.disposed) return;

    this.setLatestSize(cols, rows);

    const terminal = this.options.getTerminal();
    if (!terminal) return;

    const currentSize = getTerminalSize(terminal);
    if (sameSize(currentSize, cols, rows)) {
      return;
    }

    if (shouldResizeImmediately(terminal, immediate)) {
      this.resizeImmediately(cols, rows);
      return;
    }

    if (!this.options.isVisible()) {
      this.scheduleIdleResize(cols, rows);
      return;
    }

    this.resizeVisibleTerminal(cols, rows, currentSize);
  }

  private resizeVisibleTerminal(cols: number, rows: number, currentSize: TerminalSize): void {
    if (this.isNewApi) {
      this.resizeVisibleNewApi(cols, rows, currentSize);
    } else {
      this.resizeVisibleLegacyApi(cols, rows, currentSize);
    }
  }

  private resizeVisibleNewApi(cols: number, rows: number, currentSize: TerminalSize): void {
    const colsChanged = cols !== currentSize.cols;
    const rowsChanged = rows !== currentSize.rows;

    if (rowsChanged && !colsChanged) {
      this.newOptions.onXtermResize(currentSize.cols, rows);
      this.scheduleBackendResize(currentSize.cols, rows);
    } else if (colsChanged) {
      this.debounceXtermResizeX(cols, rows);
    }
  }

  private resizeVisibleLegacyApi(cols: number, rows: number, currentSize: TerminalSize): void {
    if (rows !== currentSize.rows) {
      this.legacyOptions.onResizeY(rows);
    }

    if (cols !== currentSize.cols) {
      this.debounceResizeXLegacy(cols);
    }
  }

  /**
   * Flush pending resize work.
   */
  flush(forceCallback = false): void {
    if (this.disposed) return;

    const hasPendingResize = this.hasPendingResize();

    if (hasPendingResize) {
      this.clearPendingJobs();
      this.executeResize(this.latestCols, this.latestRows, true);
    }
    
    if ((hasPendingResize || forceCallback) && this.options.onFlush) {
      this.options.onFlush();
    }
  }

  /**
   * Get the latest target size.
   */
  getLatestSize(): { cols: number; rows: number } {
    return {
      cols: this.latestCols,
      rows: this.latestRows,
    };
  }

  hasPendingResize(): boolean {
    return (
      this.resizeXTimeoutId !== null ||
      this.resizeXIdleCallbackId !== null ||
      this.resizeYIdleCallbackId !== null ||
      this.backendResizeTimeoutId !== null
    );
  }

  dispose(): void {
    this.disposed = true;
    this.clearPendingJobs();
  }

  private setLatestSize(cols: number, rows: number): void {
    this.latestCols = cols;
    this.latestRows = rows;
  }

  private resizeImmediately(cols: number, rows: number): void {
    this.clearPendingJobs();
    if (this.isNewApi) {
      this.newOptions.onXtermResize(cols, rows);
      this.scheduleBackendResize(cols, rows);
    } else {
      this.executeResize(cols, rows, true);
    }
  }

  private executeResize(cols: number, rows: number, includeBackend: boolean): void {
    if (this.isNewApi) {
      const opts = this.newOptions;
      opts.onXtermResize(cols, rows);
      if (includeBackend) {
        opts.onBackendResize(cols, rows);
        opts.onResizeComplete?.();
      }
    } else {
      const opts = this.legacyOptions;
      opts.onResizeBoth(cols, rows);
    }
  }

  private debounceXtermResizeX(cols: number, rows: number): void {
    if (this.resizeXTimeoutId !== null) {
      clearTimeout(this.resizeXTimeoutId);
    }

    this.resizeXTimeoutId = setTimeout(() => {
      this.resizeXTimeoutId = null;
      if (!this.disposed && this.isNewApi) {
        this.newOptions.onXtermResize(cols, rows);
        this.scheduleBackendResize(cols, rows);
      }
    }, RESIZE_X_DEBOUNCE_MS);
  }

  private scheduleBackendResize(cols: number, rows: number): void {
    if (!this.isNewApi) return;
    
    this.pendingBackendResize = { cols, rows };
    
    if (this.backendResizeTimeoutId !== null) {
      return;
    }
    
    this.backendResizeTimeoutId = setTimeout(() => {
      this.backendResizeTimeoutId = null;
      if (!this.disposed && this.pendingBackendResize) {
        const { cols: c, rows: r } = this.pendingBackendResize;
        this.pendingBackendResize = null;
        this.newOptions.onBackendResize(c, r);
        this.newOptions.onResizeComplete?.();
      }
    }, BACKEND_RESIZE_DEBOUNCE_MS);
  }

  private debounceResizeXLegacy(cols: number): void {
    if (this.resizeXTimeoutId !== null) {
      clearTimeout(this.resizeXTimeoutId);
    }

    this.resizeXTimeoutId = setTimeout(() => {
      this.resizeXTimeoutId = null;
      if (!this.disposed && !this.isNewApi) {
        this.legacyOptions.onResizeX(cols);
      }
    }, RESIZE_X_DEBOUNCE_MS);
  }

  private scheduleIdleResize(cols: number, rows: number): void {
    const terminal = this.options.getTerminal();
    if (!terminal) return;

    const currentSize = getTerminalSize(terminal);

    if (this.isNewApi) {
      if (this.resizeXIdleCallbackId === null) {
        this.resizeXIdleCallbackId = requestIdleCallback(
          () => {
            this.resizeXIdleCallbackId = null;
            if (!this.disposed) {
              this.executeResize(this.latestCols, this.latestRows, true);
            }
          },
          { timeout: IDLE_CALLBACK_TIMEOUT_MS }
        );
      }
    } else {
      if (cols !== currentSize.cols && this.resizeXIdleCallbackId === null) {
        this.resizeXIdleCallbackId = requestIdleCallback(
          () => {
            this.resizeXIdleCallbackId = null;
            if (!this.disposed) {
              this.legacyOptions.onResizeX(this.latestCols);
            }
          },
          { timeout: IDLE_CALLBACK_TIMEOUT_MS }
        );
      }

      if (rows !== currentSize.rows && this.resizeYIdleCallbackId === null) {
        this.resizeYIdleCallbackId = requestIdleCallback(
          () => {
            this.resizeYIdleCallbackId = null;
            if (!this.disposed) {
              this.legacyOptions.onResizeY(this.latestRows);
            }
          },
          { timeout: IDLE_CALLBACK_TIMEOUT_MS }
        );
      }
    }
  }

  private clearPendingJobs(): void {
    if (this.resizeXTimeoutId !== null) {
      clearTimeout(this.resizeXTimeoutId);
      this.resizeXTimeoutId = null;
    }

    if (this.resizeXIdleCallbackId !== null) {
      cancelIdleCallback(this.resizeXIdleCallbackId);
      this.resizeXIdleCallbackId = null;
    }

    if (this.resizeYIdleCallbackId !== null) {
      cancelIdleCallback(this.resizeYIdleCallbackId);
      this.resizeYIdleCallbackId = null;
    }

    if (this.backendResizeTimeoutId !== null) {
      clearTimeout(this.backendResizeTimeoutId);
      this.backendResizeTimeoutId = null;
      this.pendingBackendResize = null;
    }
  }
}

export default TerminalResizeDebouncer;
