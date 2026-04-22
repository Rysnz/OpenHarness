import ReactDOM from "react-dom/client";
import "./app/styles/index.scss";

// Manually import Monaco Editor CSS.
// This ensures the CSS loads correctly in Tauri production.
import 'monaco-editor/min/vs/editor/editor.main.css';

// Font: Noto Sans SC is loaded via a <link> tag in index.html.
// File path: public/fonts/fonts.css, served as /fonts/fonts.css.

import { initializeAllTools } from "./tools/initializeAllTools";
import { initContextMenuSystem } from "./shared/context-menu-system";
import { loader } from '@monaco-editor/react';
import { getMonacoPath, getMonacoWorkerPath, logMonacoResourceCheck } from './tools/editor/utils/monacoPathHelper';
import { bootstrapLogger, createLogger, initLogger } from './shared/utils/logger';
import { registerDefaultContextTypes } from './shared/context-system/core/registerDefaultTypes';
import { registerNotificationContextMenu } from './shared/notification-system';
import { configManager } from './infrastructure/config/services/ConfigManager';
import { initializeFrontendLogLevelSync } from './infrastructure/config/services/FrontendLogLevelSync';
import { fontPreferenceService } from './infrastructure/font-preference/core/FontPreferenceService';
import { themeService } from './infrastructure/theme/core/ThemeService';
import { monacoThemeSync } from './infrastructure/theme/integrations/MonacoThemeSync';
import { MonacoManager } from './tools/editor/services/MonacoInitManager';
import {
  buildReactCrashLogPayload,
  isMinifiedReactErrorMessage,
} from './shared/utils/reactProductionError';

type BootDiagnostics = {
  stages: string[];
  lastStage: string | null;
  errors: Array<{ stage: string; message: string }>;
};

function getBootDiagnostics(): BootDiagnostics {
  const key = '__OPENHARNESS_BOOT_DIAGNOSTICS__';
  const windowWithDiagnostics = window as typeof window & {
    [key]?: BootDiagnostics;
  };

  if (!windowWithDiagnostics[key]) {
    windowWithDiagnostics[key] = {
      stages: [],
      lastStage: null,
      errors: [],
    };
  }

  return windowWithDiagnostics[key]!;
}

function markBootStage(stage: string): void {
  const diagnostics = getBootDiagnostics();
  diagnostics.lastStage = stage;
  diagnostics.stages.push(stage);
}

function recordBootError(stage: string, error: unknown): void {
  const diagnostics = getBootDiagnostics();
  diagnostics.lastStage = `${stage}:error`;
  diagnostics.errors.push({
    stage,
    message: error instanceof Error ? error.message : String(error),
  });
}

// Install console forwarding before app startup so early console output is persisted too.
bootstrapLogger();

const log = createLogger('App');

/** Dedupe only for white-screen heuristic (empty #root), not for Error Boundary logs. */
const WHITE_SCREEN_LOGGED_FLAG = '__openharness_white_screen_crash_logged__';
function hasLoggedWhiteScreenCrash(): boolean {
  return Boolean((window as any)[WHITE_SCREEN_LOGGED_FLAG]);
}
function markWhiteScreenCrashLogged(): void {
  (window as any)[WHITE_SCREEN_LOGGED_FLAG] = true;
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

function registerGlobalErrorHandlers() {
  const flag = '__openharness_global_error_handlers_registered__';
  const w = window as any;
  if (w[flag]) {
    return;
  }
  w[flag] = true;

  const scheduleCrashLog = (payload: { location: string; message: string; data?: Record<string, unknown> }) => {
    // Only persist when it looks like a real "white screen"/startup crash.
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
        const msg = event.message || '';
        // Minified React errors often reach window.error even when #root is not empty;
        // always persist so production builds get react.dev/errors/{code} in webview.log.
        if (isMinifiedReactErrorMessage(msg)) {
          const err =
            event.error instanceof Error ? event.error : new Error(msg);
          log.error('[CRASH] window:error (minified React)', {
            location: 'window:error',
            ...buildReactCrashLogPayload(err),
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
          });
        }
        scheduleCrashLog({
          location: 'window:error',
          message: msg || 'window error',
          data: {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            error: serializeError(event.error),
          },
        });
        return;
      }

    // Resource load errors rarely cause a white screen; log only if root is empty.
      const target = event.target as any;
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
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : '';
    if (isMinifiedReactErrorMessage(msg)) {
      const err = reason instanceof Error ? reason : new Error(msg);
      log.error('[CRASH] unhandledrejection (minified React)', {
        location: 'window:unhandledrejection',
        ...buildReactCrashLogPayload(err),
      });
    }
    scheduleCrashLog({
      location: 'window:unhandledrejection',
      message: 'unhandled rejection',
      data: {
        reason: serializeError(event.reason),
      },
    });
  });
}

registerGlobalErrorHandlers();

// Disable Tab-key focus traversal globally.
// Tab still works inside Monaco Editor and xterm terminal where it has semantic meaning.
document.addEventListener(
  'keydown',
  (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const target = e.target as Element | null;
    if (target?.closest('.monaco-editor, .xterm')) return;
    e.preventDefault();
  },
  true
);

// Configure Monaco Editor loader - use local files (offline-ready).
const isDev = import.meta.env.DEV;
const monacoPath = getMonacoPath();

loader.config({
  paths: {
    vs: monacoPath
  }
});

// Debug: check resource availability in production.
if (!isDev) {
  // Delay checks to avoid blocking startup.
  setTimeout(() => {
    logMonacoResourceCheck().catch(err => {
      log.error('Monaco resource check failed', err);
    });
  }, 2000);
}

// Optimization: Monaco Editor worker mapping.
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

(window as any).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    const workerFile = MONACO_WORKER_MAP[label] || DEFAULT_WORKER;
    const workerPath = getMonacoWorkerPath(workerFile);
    
    return new Worker(workerPath, {
      type: 'classic',
      name: `monaco-${label}-worker`
    });
  }
};

/** Logger, theme, and minimal deps — must finish before first React paint (F5 / webview reload does not re-run Tauri init script). */
async function initializeBeforeRender(): Promise<void> {
  markBootStage('initializeBeforeRender:start');

  markBootStage('initializeBeforeRender:initLogger:start');
  await initLogger();
  markBootStage('initializeBeforeRender:initLogger:done');

  markBootStage('initializeBeforeRender:logLevelSync:start');
  await initializeFrontendLogLevelSync();
  markBootStage('initializeBeforeRender:logLevelSync:done');

  log.debug('Monaco loader configured', { vs: monacoPath, isDev });
  log.info('Initializing OpenHarness');

  markBootStage('initializeBeforeRender:registerDefaultContextTypes:start');
  registerDefaultContextTypes();
  markBootStage('initializeBeforeRender:registerDefaultContextTypes:done');

  markBootStage('initializeBeforeRender:initRecommendationProviders:start');
  const { initRecommendationProviders } = await import('./flow_chat/components/smart-recommendations');
  initRecommendationProviders();
  markBootStage('initializeBeforeRender:initRecommendationProviders:done');

  markBootStage('initializeBeforeRender:themeService:start');
  await themeService.initialize();
  markBootStage('initializeBeforeRender:themeService:done');
  log.info('Theme system initialized');

  markBootStage('initializeBeforeRender:done');
}

/** Rest of startup runs after the shell is visible so refresh latency stays reasonable. */
async function initializeAfterRender(): Promise<void> {
  markBootStage('initializeAfterRender:start');

  markBootStage('initializeAfterRender:fontPreference:start');
  await fontPreferenceService.initialize();
  markBootStage('initializeAfterRender:fontPreference:done');
  log.info('Font preference initialized at startup');

  markBootStage('initializeAfterRender:editorConfig:start');
  await configManager.getConfig('editor');
  markBootStage('initializeAfterRender:editorConfig:done');
  log.info('Editor configuration preloaded');

  markBootStage('initializeAfterRender:coreInit:start');
  const initResults = await Promise.allSettled([
    initializeAllTools(),
    (async () => {
      initContextMenuSystem({
        registerBuiltinCommands: true,
        registerBuiltinProviders: true,
        debug: false,
      });

      registerNotificationContextMenu();
    })(),
    (async () => {
      await MonacoManager.initialize();

      await monacoThemeSync.initialize();
      log.info('Monaco theme sync initialized');
    })(),
  ]);
  markBootStage('initializeAfterRender:coreInit:done');

  initResults.forEach((result, index) => {
    const names = ['Tools', 'ContextMenu', 'Editors'];
    if (result.status === 'rejected') {
      log.warn('Initialization failed', { module: names[index], error: result.reason });
    }
  });

  log.info('OpenHarness core systems initialized successfully');
  markBootStage('initializeAfterRender:done');
}

async function startApplication(): Promise<void> {
  markBootStage('startApplication:start');
  try {
    await initializeBeforeRender();
  } catch (error) {
    recordBootError('initializeBeforeRender', error);
    log.error('Failed to initialize OpenHarness (pre-render)', error);
  }

  const rootElement = document.getElementById('root') as HTMLElement | null;
  if (!rootElement) {
    const error = new Error('Missing #root element');
    recordBootError('startApplication:rootLookup', error);
    log.error('Failed to start application', error);
    return;
  }

  let AppModule: typeof import('./app/App');
  let AppErrorBoundaryModule: typeof import('./app/components/AppErrorBoundary');
  let WorkspaceProviderModule: typeof import('./infrastructure/contexts/WorkspaceProvider');
  let I18nProviderModule: typeof import('./infrastructure/i18n');

  try {
    markBootStage('startApplication:renderModules:start');
    [
      AppModule,
      AppErrorBoundaryModule,
      WorkspaceProviderModule,
      I18nProviderModule,
    ] = await Promise.all([
      import('./app/App'),
      import('./app/components/AppErrorBoundary'),
      import('./infrastructure/contexts/WorkspaceProvider'),
      import('./infrastructure/i18n'),
    ]);
    markBootStage('startApplication:renderModules:done');
  } catch (error) {
    recordBootError('startApplication:renderModules', error);
    log.error('Failed to load render modules', error);
    rootElement.innerHTML = `
      <div style="height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0f14;color:#e5e7eb;padding:24px;box-sizing:border-box;">
        <div style="max-width:760px;width:100%;">
          <h2 style="margin:0;font-size:18px;font-weight:600;">OpenHarness failed to start</h2>
          <p style="margin:12px 0 0;opacity:0.9;">${
            error instanceof Error ? error.message : String(error)
          }</p>
        </div>
      </div>
    `;
    return;
  }

  const App = AppModule.default;
  const AppErrorBoundary = AppErrorBoundaryModule.default;
  const { WorkspaceProvider } = WorkspaceProviderModule;
  const { I18nProvider } = I18nProviderModule;

  try {
    markBootStage('startApplication:render:start');
    ReactDOM.createRoot(rootElement).render(
      <AppErrorBoundary>
        <I18nProvider>
          <WorkspaceProvider>
            <App />
          </WorkspaceProvider>
        </I18nProvider>
      </AppErrorBoundary>
    );
    markBootStage('startApplication:render:done');
  } catch (error) {
    recordBootError('startApplication:render', error);
    log.error('Failed to render application root', error);
    rootElement.innerHTML = `
      <div style="height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0f14;color:#e5e7eb;padding:24px;box-sizing:border-box;">
        <div style="max-width:760px;width:100%;">
          <h2 style="margin:0;font-size:18px;font-weight:600;">OpenHarness render failed</h2>
          <p style="margin:12px 0 0;opacity:0.9;">${
            error instanceof Error ? error.message : String(error)
          }</p>
        </div>
      </div>
    `;
    return;
  }

  try {
    await initializeAfterRender();
  } catch (error) {
    recordBootError('initializeAfterRender', error);
    log.error('Failed to complete post-render initialization', error);
  }

  markBootStage('startApplication:done');
}

void startApplication();
