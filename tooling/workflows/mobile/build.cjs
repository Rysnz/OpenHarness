#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  repoRoot,
  runInherit,
  runSilent,
  tailOutput,
} = require('../../lib/runtime.cjs');
const {
  printError,
  printInfo,
  printSuccess,
} = require('../../../scripts/console-style.cjs');

function cleanStaleMobileWebResources(logInfo = printInfo) {
  const targetDir = path.join(repoRoot, 'target');
  if (!fs.existsSync(targetDir)) return 0;

  let cleaned = 0;
  for (const profile of fs.readdirSync(targetDir)) {
    const mobileWebDir = path.join(targetDir, profile, 'mobile-web');
    if (fs.existsSync(mobileWebDir) && fs.statSync(mobileWebDir).isDirectory()) {
      fs.rmSync(mobileWebDir, { recursive: true, force: true });
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logInfo(`Cleaned stale mobile-web resources from ${cleaned} target profile(s)`);
  }

  return cleaned;
}

function buildMobileWorkspace(options = {}) {
  const {
    install = false,
    logInfo = printInfo,
    logSuccess = printSuccess,
    logError = printError,
  } = options;

  const mobileWebDir = path.join(repoRoot, 'src', 'mobile-web');

  cleanStaleMobileWebResources(logInfo);

  if (install) {
    const installResult = runSilent('pnpm install --silent', mobileWebDir);
    if (!installResult.ok) {
      logError('mobile-web pnpm install failed');
      const output = tailOutput(installResult.stderr || installResult.stdout);
      if (output) {
        logError(output);
      } else if (installResult.error?.message) {
        logError(installResult.error.message);
      }
      return { ok: false };
    }
  }

  const buildResult = runInherit('pnpm run build', mobileWebDir);
  if (!buildResult.ok) {
    logError('mobile-web build failed');
    if (buildResult.error?.message) {
      logError(buildResult.error.message);
    }
    return { ok: false };
  }

  logSuccess('mobile-web build complete');
  return { ok: true };
}

if (require.main === module) {
  const shouldInstall = process.argv.includes('--install');
  const result = buildMobileWorkspace({ install: shouldInstall });
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  buildMobileWorkspace,
  cleanStaleMobileWebResources,
};
