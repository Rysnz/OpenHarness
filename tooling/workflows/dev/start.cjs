#!/usr/bin/env node

const path = require('path');
const { pathToFileURL } = require('url');
const {
  printBlank,
  printComplete,
  printError,
  printHeader,
  printInfo,
  printStep,
  printSuccess,
} = require('../../../scripts/console-style.cjs');
const {
  repoRoot,
  runInherit,
  runShellCommand,
  runSilent,
  spawnCommand,
  tailOutput,
} = require('../../lib/runtime.cjs');
const { buildMobileWorkspace } = require('../mobile/build.cjs');

async function startWorkbench(mode = 'web') {
  const startTime = Date.now();
  const modeLabel = mode === 'desktop' ? 'Desktop' : 'Workbench';

  printHeader(`OpenHarness ${modeLabel} Development`);
  printBlank();

  const totalSteps = mode === 'desktop' ? 4 : 3;

  printStep(1, totalSteps, 'Sync assets');
  const assetsResult = runSilent('node tooling/workflows/assets/sync.cjs monaco', repoRoot);
  if (!assetsResult.ok) {
    printError('Asset sync failed');
    const output = tailOutput(assetsResult.stderr || assetsResult.stdout);
    if (output) {
      printError(output);
    } else if (assetsResult.error) {
      printError(assetsResult.error.message);
    }
    process.exit(1);
  }
  printSuccess('Static assets ready');

  printStep(2, totalSteps, 'Write version artifacts');
  const versionResult = runInherit('node tooling/workflows/version/write.cjs', repoRoot);
  if (!versionResult.ok) {
    printError('Version artifact generation failed');
    if (versionResult.error?.message) {
      printError(versionResult.error.message);
    }
    process.exit(1);
  }

  const prepTime = ((Date.now() - startTime) / 1000).toFixed(1);

  if (mode === 'desktop') {
    printStep(3, 4, 'Build mobile workspace');
    const mobileResult = buildMobileWorkspace({
      install: true,
      logInfo: printInfo,
      logSuccess: printSuccess,
      logError: printError,
    });
    if (!mobileResult.ok) {
      process.exit(1);
    }
  }

  printStep(totalSteps, totalSteps, 'Start development services');
  printInfo(`Prep took ${prepTime}s`);
  printComplete('Initialization complete');

  try {
    if (mode === 'desktop') {
      if (process.platform === 'win32') {
        printInfo('Windows: ensuring prebuilt OpenSSL (cached under .openharness/cache/)');
        try {
          const { ensureOpenSslWindows } = await import(
            pathToFileURL(path.join(repoRoot, 'scripts', 'ensure-openssl-windows.mjs')).href
          );
          await ensureOpenSslWindows();
        } catch (error) {
          printError('OpenSSL bootstrap failed');
          printError(error.message || String(error));
          process.exit(1);
        }
      }

      const desktopDir = path.join(repoRoot, 'src', 'apps', 'desktop');
      const tauriConfig = path.join(desktopDir, 'tauri.conf.json');
      const tauriBin = path.join(repoRoot, 'node_modules', '.bin', 'tauri');
      await spawnCommand(tauriBin, ['dev', '--config', tauriConfig], desktopDir);
      return;
    }

    await runShellCommand('pnpm exec vite', path.join(repoRoot, 'src', 'web-ui'));
  } catch {
    printError('Dev server failed to start');
    process.exit(1);
  }
}

if (require.main === module) {
  const mode = process.argv[2] || 'web';
  startWorkbench(mode).catch((error) => {
    printError('Startup failed: ' + error.message);
    process.exit(1);
  });
}

module.exports = {
  startWorkbench,
};
