import { loader } from '@monaco-editor/react';
import { bootstrapLogger, createLogger, initLogger } from '../../shared/utils/logger';
import {
  buildReactCrashLogPayload,
  isMinifiedReactErrorMessage,
} from '../../shared/utils/reactProductionError';
import { getMonacoPath, getMonacoWorkerPath, logMonacoResourceCheck } from '../../tools/editor/utils/monacoPathHelper';
import { getBootDiagnostics, markBootStage } from './bootDiagnostics';

bootstrapLogger();

const log = createLogger('App');
const WHITE_SCREEN_LOGGED_FLAG = '__openharness_white_screen_crash_logged__';

const MONACO_WORKER_MAP: Record<string, string> = {
  json: 'language/json/jsonWorker.js',
  css: 'language/css/cssWorker.js',
  scss: 'language/css/cssWorker.js',
  less: 'language/css/cssWorker.js',
  html: 'language/html/htmlWorker.js',
  handlebars: 'language/html/htmlWorker.js',
  razor: 'language/html/htmlWorker.js',
  typescript: 'language/typescript/tsWorker.js',
  javascript: 'language/typescript/tsWorker.js',
};

const DEFAULT_WORKER = 'base/worker/workerMain.js';

function hasLoggedWhiteScreenCrash(): boolean {
  return Boolean((window as unknown as Record<string, unknown>)[WHITE_SCREEN_LOGGED_FLAG]);
}

function markWhiteScreenCrashLogged(): void {
  (window as unknown as Record<string, unknown>)[WHITE_SCREEN_LOGGED_FLAG] = true;
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return { value: String(err) };
}

function isRootEmpty(): boolean {
  const root = document.getElementById('root');
  if (!root) {
    return true;
  }
  return root.childElementCount === 0;
}

export function registerGlobalErrorHandlers(): void {
  const flag = '__openharness_global_error_handlers_registered__';
  const windowWithFlag = window as unknown as Record<string, unknown>;
  if (windowWithFlag[flag]) {
    return;
  }
  windowWithFlag[flag] = true;

  const scheduleCrashLog = (payload: {
    location: string;
    message: string;
    data?: Record<string, unknown>;
  }) => {
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (isRootEmpty() && !hasLoggedWhiteScreenCrash()) {
            markWhiteScreenCrashLogged();
            log.error('[CRASH] Application crashed', {
              location: payload.location,
              message: payload.message,
              ...payload.data,
            });
          }
        });
      });
    });
  };

  window.addEventListener(
    'error',
    (event: Event) => {
      if (event instanceof ErrorEvent) {
        const message = event.message || '';
        if (isMinifiedReactErrorMessage(message)) {
          const error = event.error instanceof Error ? event.error : new Error(message);
          log.error('[CRASH] window:error (minified React)', {
            location: 'window:error',
            ...buildReactCrashLogPayload(error),
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
          });
        }
        scheduleCrashLog({
          location: 'window:error',
          message: message || 'window error',
          data: {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            error: serializeError(event.error),
          },
        });
        return;
      }

      const target = event.target as { tagName?: string; src?: string; href?: string } | null;
      scheduleCrashLog({
        location: 'window:resource-error',
        message: 'resource load error',
        data: {
          tagName: target?.tagName,
          src: target?.src,
          href: target?.href,
        },
      });
    },
    true
  );

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message =
      reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';

    if (isMinifiedReactErrorMessage(message)) {
      const error = reason instanceof Error ? reason : new Error(message);
      log.error('[CRASH] unhandledrejection (minified React)', {
        location: 'window:unhandledrejection',
        ...buildReactCrashLogPayload(error),
      });
    }

    scheduleCrashLog({
      location: 'window:unhandledrejection',
      message: 'unhandled rejection',
      data: {
        reason: serializeError(reason),
      },
    });
  });
}

export function disableGlobalTabTraversal(): void {
  document.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const target = event.target as Element | null;
      if (target?.closest('.monaco-editor, .xterm')) return;
      event.preventDefault();
    },
    true
  );
}

export function configureMonacoEnvironment(): { isDev: boolean; monacoPath: string } {
  const isDev = import.meta.env.DEV;
  const monacoPath = getMonacoPath();

  loader.config({
    paths: {
      vs: monacoPath,
    },
  });

  if (!isDev) {
    setTimeout(() => {
      logMonacoResourceCheck().catch((error) => {
        log.error('Monaco resource check failed', error);
      });
    }, 2000);
  }

  (window as typeof window & {
    MonacoEnvironment?: {
      getWorker: (_workerId: string, label: string) => Worker;
    };
  }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      const workerFile = MONACO_WORKER_MAP[label] || DEFAULT_WORKER;
      const workerPath = getMonacoWorkerPath(workerFile);

      return new Worker(workerPath, {
        type: 'classic',
        name: `monaco-${label}-worker`,
      });
    },
  };

  return { isDev, monacoPath };
}

export async function initializeWorkbenchRuntime(): Promise<{ isDev: boolean; monacoPath: string }> {
  registerGlobalErrorHandlers();
  disableGlobalTabTraversal();
  markBootStage('runtimeSetup:configured');
  return configureMonacoEnvironment();
}

export async function initializeLoggerAndDiagnostics(monacoPath: string, isDev: boolean): Promise<void> {
  markBootStage('runtimeSetup:initLogger:start');
  await initLogger();
  markBootStage('runtimeSetup:initLogger:done');
  log.debug('Monaco loader configured', { vs: monacoPath, isDev });
  getBootDiagnostics();
}

export function getWorkbenchLogger() {
  return log;
}
