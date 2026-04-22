import type { Options } from '@wdio/types';
import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DRIVER_HOST = '127.0.0.1';
const DRIVER_PORT = Number(process.env.OPENHARNESS_E2E_WEBDRIVER_PORT || 4445);
const DEV_SERVER_HOST = 'localhost';
const DEV_SERVER_PORT = 1422;
const DEV_SERVER_URL = `http://${DEV_SERVER_HOST}:${DEV_SERVER_PORT}/`;

let openharnessApp: ChildProcess | null = null;
let devServerProcess: ChildProcess | null = null;
let ownsDevServer = false;

type EmbeddedTestrunnerConfig = Options.Testrunner & {
  autoCompileOpts: {
    autoCompile: boolean;
    tsNodeOpts: {
      transpileOnly: boolean;
      project: string;
    };
  };
};

function projectRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

type BrowserLogEntry = {
  level: string;
  message: string;
  timestamp: number;
};

function executableCandidates(buildType: 'debug' | 'release'): string[] {
  const root = projectRoot();
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const binaryName = `openharness-desktop${suffix}`;

  if (process.platform === 'darwin') {
    return [
      path.join(root, 'target', buildType, binaryName),
      path.join(root, 'target', buildType, 'OpenHarness.app', 'Contents', 'MacOS', 'OpenHarness'),
    ];
  }

  return [path.join(root, 'target', buildType, binaryName)];
}

export function getApplicationPath(): string {
  const forcedPath = process.env.OPENHARNESS_E2E_APP_PATH;
  const forcedMode = process.env.OPENHARNESS_E2E_APP_MODE?.toLowerCase();

  if (forcedPath) {
    return forcedPath;
  }

  if (forcedMode === 'debug') {
    return executableCandidates('debug')[0];
  }

  if (forcedMode === 'release') {
    throw new Error('Release mode is disabled for E2E. Use the debug desktop build instead.');
  }

  const debugMatch = executableCandidates('debug').find(candidate => fs.existsSync(candidate));
  if (debugMatch) {
    return debugMatch;
  }

  throw new Error(
    `Debug desktop build not found. Expected one of: ${executableCandidates('debug').join(', ')}`
  );
}

async function waitForDevServerIfNeeded(appPath: string): Promise<void> {
  if (!appPath.includes(`${path.sep}debug${path.sep}`)) {
    return;
  }

  if (await isDevServerHealthy()) {
    console.log(`Dev server is healthy at ${DEV_SERVER_URL}`);
    return;
  }

  await startDevServer();
  await waitForDevServerHealthy(60000);
}

async function isDevServerHealthy(): Promise<boolean> {
  try {
    const response = await fetch(DEV_SERVER_URL);
    if (!response.ok) {
      return false;
    }

    const html = await response.text();
    return (
      html.includes('id="root"') &&
      (html.includes('/src/main.tsx') || html.includes('/@vite/client'))
    );
  } catch {
    return false;
  }
}

async function waitForDevServerHealthy(timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isDevServerHealthy()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Dev server ${DEV_SERVER_URL} did not become healthy within ${timeoutMs}ms`);
}

async function fetchDriverStatus(): Promise<boolean> {
  try {
    const response = await fetch(`http://${DRIVER_HOST}:${DRIVER_PORT}/status`);
    if (!response.ok) {
      return false;
    }
    const body = await response.json() as { value?: { ready?: boolean } };
    return body.value?.ready === true;
  } catch {
    return false;
  }
}

async function createProbeSession(): Promise<string> {
  const response = await fetch(`http://${DRIVER_HOST}:${DRIVER_PORT}/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  if (!response.ok) {
    throw new Error(`Failed to create probe session: ${response.status} ${await response.text()}`);
  }

  const body = await response.json() as { value?: { sessionId?: string } };
  const sessionId = body.value?.sessionId;
  if (!sessionId) {
    throw new Error('Probe session did not return a session id');
  }
  return sessionId;
}

async function deleteProbeSession(sessionId: string): Promise<void> {
  await fetch(`http://${DRIVER_HOST}:${DRIVER_PORT}/session/${sessionId}`, {
    method: 'DELETE',
  }).catch(() => undefined);
}

async function probeDocumentReady(sessionId: string): Promise<boolean> {
  const response = await fetch(`http://${DRIVER_HOST}:${DRIVER_PORT}/session/${sessionId}/execute/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      script: `() => {
        const root = document.getElementById('root');
        const appLayout = document.querySelector('[data-testid="app-layout"], .openharness-app-layout');
        const mainContent = document.querySelector('[data-testid="app-main-content"], .openharness-app-main-workspace');
        const shell = document.querySelector(
          '.openharness-nav-panel, .openharness-scene-bar, .openharness-nav-bar, .welcome-scene'
        );
        const splashVisible = Boolean(document.querySelector('.splash-screen'));
        const tauriReady =
          typeof window.__TAURI__ !== 'undefined' ||
          typeof window.__TAURI_INTERNALS__ !== 'undefined';

        return Boolean(
          document?.body &&
          root &&
          root.childElementCount > 0 &&
          appLayout &&
          mainContent &&
          shell &&
          tauriReady &&
          !splashVisible
        );
      }`,
      args: [],
    }),
  });

  if (!response.ok) {
    throw new Error(`Document ready probe failed: ${response.status} ${await response.text()}`);
  }

  const body = await response.json() as { value?: boolean };
  return body.value === true;
}

type DocumentDiagnostics = {
  title: string;
  readyState: string;
  rootExists: boolean;
  rootChildElementCount: number;
  bodyChildElementCount: number;
  bodyElementCount: number;
  appLayoutExists: boolean;
  mainContentExists: boolean;
  shellExists: boolean;
  splashVisible: boolean;
  tauriReady: boolean;
  bodyTextSample: string;
  rootHtmlSample: string;
  bodyBackground: string;
  bootDiagnostics: {
    stages?: string[];
    lastStage?: string | null;
    errors?: Array<{ stage: string; message: string }>;
  } | null;
  moduleImportChecks?: Array<{ module: string; ok: boolean; message?: string }>;
  browserLogs?: BrowserLogEntry[];
  consoleLogs?: BrowserLogEntry[];
};

async function collectDocumentDiagnostics(sessionId: string): Promise<DocumentDiagnostics> {
  const response = await fetch(`http://${DRIVER_HOST}:${DRIVER_PORT}/session/${sessionId}/execute/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      script: `async () => {
        const root = document.getElementById('root');
        const body = document.body;
        const appLayout = document.querySelector('[data-testid="app-layout"], .openharness-app-layout');
        const mainContent = document.querySelector('[data-testid="app-main-content"], .openharness-app-main-workspace');
        const shell = document.querySelector(
          '.openharness-nav-panel, .openharness-scene-bar, .openharness-nav-bar, .welcome-scene'
        );
        const splash = document.querySelector('.splash-screen');
        const bodyStyle = body ? window.getComputedStyle(body) : null;
        const text = body?.innerText || '';
        const rootHtml = root?.innerHTML || '';
        const bootDiagnostics = (window).__OPENHARNESS_BOOT_DIAGNOSTICS__ || null;
        const moduleImportTargets = [
          '/src/shared/utils/logger.ts',
          '/src/infrastructure/config/services/FrontendLogLevelSync.ts',
          '/src/infrastructure/theme/index.ts',
          '/src/infrastructure/font-preference/index.ts',
          '/src/app/App.tsx',
        ];
        const moduleImportChecks = [];

        for (const modulePath of moduleImportTargets) {
          try {
            await import(/* @vite-ignore */ modulePath);
            moduleImportChecks.push({ module: modulePath, ok: true });
          } catch (error) {
            moduleImportChecks.push({
              module: modulePath,
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return {
          title: document.title || '',
          readyState: document.readyState,
          rootExists: Boolean(root),
          rootChildElementCount: root?.childElementCount || 0,
          bodyChildElementCount: body?.childElementCount || 0,
          bodyElementCount: body ? body.getElementsByTagName('*').length : 0,
          appLayoutExists: Boolean(appLayout),
          mainContentExists: Boolean(mainContent),
          shellExists: Boolean(shell),
          splashVisible: Boolean(splash),
          tauriReady:
            typeof window.__TAURI__ !== 'undefined' ||
            typeof window.__TAURI_INTERNALS__ !== 'undefined',
          bodyTextSample: text.slice(0, 500),
          rootHtmlSample: rootHtml.slice(0, 2000),
          bodyBackground: bodyStyle?.backgroundColor || '',
          bootDiagnostics,
          moduleImportChecks,
        };
      }`,
      args: [],
    }),
  });

  if (!response.ok) {
    throw new Error(`Document diagnostics probe failed: ${response.status} ${await response.text()}`);
  }

  const body = await response.json() as { value?: DocumentDiagnostics };
  if (!body.value) {
    throw new Error('Document diagnostics probe returned no payload');
  }
  return body.value;
}

async function waitForEmbeddedDriverReady(timeoutMs: number = 30000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await fetchDriverStatus()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Embedded WebDriver did not become ready within ${timeoutMs}ms`);
}

async function waitForWebviewDocumentReady(timeoutMs: number = 30000): Promise<void> {
  const startedAt = Date.now();
  let lastError = 'OpenHarness app shell is not ready';

  while (Date.now() - startedAt < timeoutMs) {
    let sessionId: string | null = null;

    try {
      sessionId = await createProbeSession();
      const ready = await probeDocumentReady(sessionId);
      if (ready) {
        await deleteProbeSession(sessionId);
        return;
      }
      lastError = 'OpenHarness app shell is not ready';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      if (sessionId) {
        await deleteProbeSession(sessionId);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  let diagnosticsSummary = '';
  let sessionId: string | null = null;

  try {
    sessionId = await createProbeSession();
    const diagnostics = await collectDocumentDiagnostics(sessionId);
    const [browserLogs, consoleLogs] = await Promise.all([
      fetchSessionLogs(sessionId, 'browser').catch(() => []),
      fetchSessionLogs(sessionId, 'console').catch(() => []),
    ]);
    diagnostics.browserLogs = browserLogs.slice(-20);
    diagnostics.consoleLogs = consoleLogs.slice(-20);
    diagnosticsSummary = JSON.stringify(diagnostics, null, 2);
  } catch (error) {
    diagnosticsSummary = `Failed to collect diagnostics: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    if (sessionId) {
      await deleteProbeSession(sessionId);
    }
  }

  throw new Error(
    `Webview document did not become ready within ${timeoutMs}ms: ${lastError}\nDiagnostics:\n${diagnosticsSummary}`
  );
}

async function fetchSessionLogs(
  sessionId: string,
  logType: string,
): Promise<BrowserLogEntry[]> {
  const response = await fetch(`http://${DRIVER_HOST}:${DRIVER_PORT}/session/${sessionId}/se/log`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ type: logType }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch logs: ${response.status} ${body}`);
  }

  const payload = await response.json() as { value?: BrowserLogEntry[] };
  return payload.value ?? [];
}

function stopOpenHarnessApp(): void {
  if (!openharnessApp) {
    return;
  }

  openharnessApp.kill();
  openharnessApp = null;
}

function stopDevServer(): void {
  if (!devServerProcess || !ownsDevServer) {
    return;
  }

  devServerProcess.kill();
  devServerProcess = null;
  ownsDevServer = false;
}

async function isPortOpen(port: number, hosts: string[]): Promise<boolean> {
  return Promise.any(hosts.map(host => {
    return new Promise<boolean>((resolve, reject) => {
      const client = new net.Socket();
      client.setTimeout(2000);
      client.connect(port, host, () => {
        client.destroy();
        resolve(true);
      });
      client.on('error', error => {
        client.destroy();
        reject(error);
      });
      client.on('timeout', () => {
        client.destroy();
        reject(new Error(`Timeout connecting to ${host}:${port}`));
      });
    });
  })).then(() => true).catch(() => false);
}

async function waitForPort(port: number, hosts: string[], timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port, hosts)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Port ${port} did not become ready within ${timeoutMs}ms`);
}

async function startDevServer(): Promise<void> {
  if (devServerProcess) {
    await waitForPort(DEV_SERVER_PORT, [DEV_SERVER_HOST, '::1'], 60000);
    await waitForDevServerHealthy(60000);
    return;
  }

  console.log(`Starting dev server on ${DEV_SERVER_URL}`);

  const spawnOptions: SpawnOptions = {
    cwd: projectRoot(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TAURI_DEV_HOST: DEV_SERVER_HOST,
    },
  };

  if (process.platform === 'win32') {
    const commandLine = [
      'pnpm',
      '--dir',
      'src/web-ui',
      'exec',
      'vite',
      '--force',
      '--host',
      DEV_SERVER_HOST,
      '--port',
      String(DEV_SERVER_PORT),
    ].join(' ');

    devServerProcess = spawn(
      process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', commandLine],
      spawnOptions,
    );
  } else {
    devServerProcess = spawn(
      'pnpm',
      [
        '--dir',
        'src/web-ui',
        'exec',
        'vite',
        '--force',
        '--host',
        DEV_SERVER_HOST,
        '--port',
        String(DEV_SERVER_PORT),
      ],
      spawnOptions,
    );
  }
  ownsDevServer = true;

  const startedDevServer = devServerProcess;
  startedDevServer.stdout?.on('data', (data: Buffer) => {
    console.log(`[dev-server] ${data.toString().trim()}`);
  });

  startedDevServer.stderr?.on('data', (data: Buffer) => {
    console.error(`[dev-server] ${data.toString().trim()}`);
  });

  startedDevServer.on('exit', (code, signal) => {
    console.log(`[dev-server] exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
    devServerProcess = null;
    ownsDevServer = false;
  });

  try {
    await waitForPort(DEV_SERVER_PORT, [DEV_SERVER_HOST, '::1'], 60000);
  } catch (error) {
    stopDevServer();
    throw error;
  }
}

async function startOpenHarnessApp(): Promise<void> {
  const appPath = getApplicationPath();

  if (!fs.existsSync(appPath)) {
    console.error(`Application not found at: ${appPath}`);
    console.error('Please build the debug application first with:');
    console.error('cargo build -p openharness-desktop');
    throw new Error('Application not built');
  }

  await waitForDevServerIfNeeded(appPath);

  stopOpenHarnessApp();

  console.log(`Starting OpenHarness with embedded WebDriver on port ${DRIVER_PORT}`);
  console.log(`Application: ${appPath}`);

  openharnessApp = spawn(appPath, [], {
    cwd: projectRoot(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OPENHARNESS_WEBDRIVER_PORT: String(DRIVER_PORT),
      OPENHARNESS_WEBDRIVER_LABEL: 'main',
    },
  });

  openharnessApp.stdout?.on('data', (data: Buffer) => {
    console.log(`[openharness-app] ${data.toString().trim()}`);
  });

  openharnessApp.stderr?.on('data', (data: Buffer) => {
    console.error(`[openharness-app] ${data.toString().trim()}`);
  });

  openharnessApp.on('exit', (code, signal) => {
    console.log(`[openharness-app] exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
  });

  await waitForEmbeddedDriverReady();
  await waitForWebviewDocumentReady();
  console.log(`Embedded WebDriver is ready on http://${DRIVER_HOST}:${DRIVER_PORT}`);
}

function sharedAfterTest(): Options.Testrunner['afterTest'] {
  return async function afterTest(test, _context, { error, passed }) {
    const isRealFailure = !passed && !!error;
    if (!isRealFailure) {
      return;
    }

    if (process.platform === 'linux') {
      console.warn('Skipping failure screenshot on linux');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotName = `failure-${test.title.replace(/\s+/g, '_')}-${timestamp}.png`;

    try {
      const screenshotDir = path.resolve(__dirname, '..', 'reports', 'screenshots');
      await fs.promises.mkdir(screenshotDir, { recursive: true });
      const screenshotPath = path.resolve(screenshotDir, screenshotName);
      await browser.saveScreenshot(screenshotPath);
      console.log(`Screenshot saved: ${screenshotName}`);
    } catch (screenshotError) {
      console.error('Failed to save screenshot:', screenshotError);
    }
  };
}

export function createEmbeddedConfig(specs: string[], label: string): EmbeddedTestrunnerConfig {
  return {
    runner: 'local',
    autoCompileOpts: {
      autoCompile: true,
      tsNodeOpts: {
        transpileOnly: true,
        project: path.resolve(__dirname, '..', 'tsconfig.json'),
      },
    },

    specs,
    exclude: [],

    maxInstances: 1,
    capabilities: [{
      maxInstances: 1,
      browserName: 'openharness',
      'openharness:embedded': true,
    } as any],

    logLevel: 'info',
    bail: 0,
    baseUrl: '',
    waitforTimeout: 10000,
    connectionRetryTimeout: 120000,
    connectionRetryCount: 3,

    services: [],
    hostname: DRIVER_HOST,
    port: DRIVER_PORT,
    path: '/',

    framework: 'mocha',
    reporters: ['spec'],

    mochaOpts: {
      ui: 'bdd',
      timeout: 120000,
      retries: 0,
    },

    onPrepare: async function onPrepare() {
      console.log(`Preparing ${label} E2E test run...`);
      const appPath = getApplicationPath();

      if (!fs.existsSync(appPath)) {
        console.error(`Application not found at: ${appPath}`);
        console.error('Please build the debug application first with:');
        console.error('cargo build -p openharness-desktop');
        throw new Error('Application not built');
      }

      console.log(`application: ${appPath}`);
      await waitForDevServerIfNeeded(appPath);
    },

    beforeSession: async function beforeSession() {
      await startOpenHarnessApp();
    },

    before: async function before() {
      const browserWithLogs = browser as WebdriverIO.Browser & {
        getLogs?: (logType: string) => Promise<BrowserLogEntry[]>;
      };

      if (typeof browserWithLogs.getLogs !== 'function') {
        browser.addCommand('getLogs', async function (this: WebdriverIO.Browser, logType: string) {
          return fetchSessionLogs(this.sessionId, logType);
        });
      }
    },

    afterSession: function afterSession() {
      console.log('Stopping OpenHarness app...');
      stopOpenHarnessApp();
    },

    afterTest: sharedAfterTest(),

    onComplete: function onComplete() {
      console.log(`${label} E2E test run completed`);
      stopOpenHarnessApp();
      stopDevServer();
    },
  } as unknown as EmbeddedTestrunnerConfig;
}
