import ReactDOM from 'react-dom/client';
import { initializeAllTools } from '../../tools/initializeAllTools';
import { loader } from '@monaco-editor/react';
import { initContextMenuSystem } from '../../shared/context-menu-system';
import { registerDefaultContextTypes } from '../../shared/context-system/core/registerDefaultTypes';
import { registerNotificationContextMenu } from '../../shared/notification-system';
import { configManager } from '../../infrastructure/config/services/ConfigManager';
import { initializeFrontendLogLevelSync } from '../../infrastructure/config/services/FrontendLogLevelSync';
import { fontPreferenceService } from '../../infrastructure/font-preference/core/FontPreferenceService';
import { themeService } from '../../infrastructure/theme/core/ThemeService';
import { monacoThemeSync } from '../../infrastructure/theme/integrations/MonacoThemeSync';
import { MonacoManager } from '../../tools/editor/services/MonacoInitManager';
import { markBootStage, recordBootError } from './bootDiagnostics';
import {
  getWorkbenchLogger,
  initializeLoggerAndDiagnostics,
  initializeWorkbenchRuntime,
} from './runtimeSetup';

const log = getWorkbenchLogger();

function renderFatalScreen(rootElement: HTMLElement, title: string, error: unknown): void {
  rootElement.innerHTML = `
    <div style="height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0f14;color:#e5e7eb;padding:24px;box-sizing:border-box;">
      <div style="max-width:760px;width:100%;">
        <h2 style="margin:0;font-size:18px;font-weight:600;">${title}</h2>
        <p style="margin:12px 0 0;opacity:0.9;">${
          error instanceof Error ? error.message : String(error)
        }</p>
      </div>
    </div>
  `;
}

async function initializeBeforeRender(monacoPath: string, isDev: boolean): Promise<void> {
  markBootStage('initializeBeforeRender:start');

  await initializeLoggerAndDiagnostics(monacoPath, isDev);

  markBootStage('initializeBeforeRender:logLevelSync:start');
  await initializeFrontendLogLevelSync();
  markBootStage('initializeBeforeRender:logLevelSync:done');

  log.info('Initializing OpenHarness');

  markBootStage('initializeBeforeRender:registerDefaultContextTypes:start');
  registerDefaultContextTypes();
  markBootStage('initializeBeforeRender:registerDefaultContextTypes:done');

  markBootStage('initializeBeforeRender:initRecommendationProviders:start');
  const { initRecommendationProviders } = await import('../../flow_chat/components/smart-recommendations');
  initRecommendationProviders();
  markBootStage('initializeBeforeRender:initRecommendationProviders:done');

  markBootStage('initializeBeforeRender:themeService:start');
  await themeService.initialize();
  markBootStage('initializeBeforeRender:themeService:done');

  log.info('Theme system initialized');
  log.debug('Monaco loader configured', { vs: monacoPath, isDev, loaderReady: Boolean(loader) });
  markBootStage('initializeBeforeRender:done');
}

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

export async function startWorkbenchApplication(): Promise<void> {
  markBootStage('startApplication:start');

  const { monacoPath, isDev } = await initializeWorkbenchRuntime();

  try {
    await initializeBeforeRender(monacoPath, isDev);
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

  let AppModule: typeof import('../../app/App');
  let AppErrorBoundaryModule: typeof import('../../app/components/AppErrorBoundary');
  let WorkspaceProviderModule: typeof import('../../infrastructure/contexts/WorkspaceProvider');
  let I18nProviderModule: typeof import('../../infrastructure/i18n');

  try {
    markBootStage('startApplication:renderModules:start');
    [
      AppModule,
      AppErrorBoundaryModule,
      WorkspaceProviderModule,
      I18nProviderModule,
    ] = await Promise.all([
      import('../../app/App'),
      import('../../app/components/AppErrorBoundary'),
      import('../../infrastructure/contexts/WorkspaceProvider'),
      import('../../infrastructure/i18n'),
    ]);
    markBootStage('startApplication:renderModules:done');
  } catch (error) {
    recordBootError('startApplication:renderModules', error);
    log.error('Failed to load render modules', error);
    renderFatalScreen(rootElement, 'OpenHarness failed to start', error);
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
    renderFatalScreen(rootElement, 'OpenHarness render failed', error);
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
