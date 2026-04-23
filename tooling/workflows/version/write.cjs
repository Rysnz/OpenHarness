#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { repoRoot } = require('../../lib/runtime.cjs');
const {
  printSuccess,
  printWarning,
} = require('../../../scripts/console-style.cjs');

const packageJsonPath = path.join(repoRoot, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

function getGitInfo() {
  try {
    const gitCommitFull = execSync('git rev-parse HEAD', {
      cwd: repoRoot,
      encoding: 'utf-8',
    }).trim();
    const gitCommit = gitCommitFull.substring(0, 7);
    const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoRoot,
      encoding: 'utf-8',
    }).trim();

    return {
      gitCommit,
      gitCommitFull,
      gitBranch,
    };
  } catch {
    printWarning('Could not get Git info (may not be a Git repo)');
    return {
      gitCommit: undefined,
      gitCommitFull: undefined,
      gitBranch: undefined,
    };
  }
}

function generateVersionInfo() {
  const gitInfo = getGitInfo();
  const buildDate = new Date().toISOString();
  const buildTimestamp = Date.now();
  const buildEnv = process.env.NODE_ENV || 'development';
  const isDev = buildEnv === 'development';

  return {
    name: packageJson.name === 'OpenHarness' ? 'OpenHarness' : packageJson.name,
    version: packageJson.version,
    buildDate,
    buildTimestamp,
    buildEnv,
    isDev,
    ...gitInfo,
  };
}

function writeFileEnsuringDir(outputPath, content) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf-8');
}

function writeVersionArtifacts(versionInfo) {
  const publicJsonPath = path.join(repoRoot, 'src', 'web-ui', 'public', 'version.json');
  const generatedTsPath = path.join(
    repoRoot,
    'src',
    'web-ui',
    'src',
    'generated',
    'version.ts'
  );
  const htmlInjectionPath = path.join(
    repoRoot,
    'src',
    'web-ui',
    'src',
    'generated',
    'version-injection.html'
  );

  writeFileEnsuringDir(publicJsonPath, JSON.stringify(versionInfo, null, 2));
  writeFileEnsuringDir(
    generatedTsPath,
    `/**
 * Auto-generated version info. Do not edit.
 * Generated: ${new Date().toISOString()}
 */

import type { VersionInfo } from '../shared/types/version';

export const VERSION_INFO: VersionInfo = ${JSON.stringify(versionInfo, null, 2)};
`
  );
  writeFileEnsuringDir(
    htmlInjectionPath,
    `<script>
  window.__VERSION_INFO__ = ${JSON.stringify(versionInfo)};
</script>`
  );
}

function main() {
  const versionInfo = generateVersionInfo();
  writeVersionArtifacts(versionInfo);
  const gitStr = versionInfo.gitCommit ? ` ${versionInfo.gitBranch}@${versionInfo.gitCommit}` : '';
  printSuccess(`${versionInfo.name} v${versionInfo.version}${gitStr}`);
}

try {
  main();
} catch (error) {
  printWarning('Version info generation failed, skipped: ' + (error.message || error));
  process.exit(0);
}

module.exports = {
  generateVersionInfo,
  writeVersionArtifacts,
};
