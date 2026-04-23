#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { repoRoot } = require('../../lib/runtime.cjs');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(source, target) {
  ensureDir(path.dirname(target));
  fs.cpSync(source, target, {
    force: true,
    recursive: true,
  });
}

function syncMonacoAssets() {
  const source = path.join(
    repoRoot,
    'src',
    'web-ui',
    'node_modules',
    'monaco-editor',
    'min',
    'vs'
  );
  const target = path.join(repoRoot, 'src', 'web-ui', 'public', 'monaco-editor', 'vs');
  if (!fs.existsSync(source)) {
    throw new Error(`Monaco source not found: ${source}`);
  }
  copyRecursive(source, target);
  return target;
}

function syncDesktopIcon() {
  const source = path.join(repoRoot, 'src', 'apps', 'desktop', 'icons', 'Logo-ICON.png');
  const target = path.join(repoRoot, 'src', 'web-ui', 'public', 'Logo-ICON.png');
  if (!fs.existsSync(source)) {
    throw new Error(`Desktop icon source not found: ${source}`);
  }
  copyRecursive(source, target);
  return target;
}

function syncAssets(mode = 'all') {
  const normalizedMode = mode.toLowerCase();
  const targets = [];

  if (normalizedMode === 'all' || normalizedMode === 'monaco') {
    targets.push(`monaco -> ${syncMonacoAssets()}`);
  }

  if (normalizedMode === 'all' || normalizedMode === 'icons') {
    targets.push(`icon -> ${syncDesktopIcon()}`);
  }

  return targets;
}

function main() {
  const mode = process.argv[2] || 'all';
  const results = syncAssets(mode);
  for (const line of results) {
    console.log(`[assets] ${line}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[assets] ${error.message || String(error)}`);
    process.exit(1);
  }
}

module.exports = {
  syncAssets,
  syncDesktopIcon,
  syncMonacoAssets,
};
