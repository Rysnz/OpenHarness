#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import runtime from '../../lib/runtime.cjs';
import { ensureOpenSslWindows } from '../../../scripts/ensure-openssl-windows.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = runtime.repoRoot ?? join(__dirname, '..', '..', '..');

function collectForwardArgs() {
  const args = process.argv.slice(2);
  let index = 0;
  while (index < args.length && args[index] === '--') {
    index += 1;
  }
  return args.slice(index);
}

function findExecutable(name) {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, [name], {
    encoding: 'utf8',
    shell: false,
  });

  if (result.status !== 0) return null;

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null;
}

function findWindowsWingetExecutable(name) {
  if (process.platform !== 'win32') return null;

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;

  const packagesDir = join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  try {
    const packageDirs = readdirSync(packagesDir, { withFileTypes: true });
    for (const entry of packageDirs) {
      if (!entry.isDirectory()) continue;

      const nestedDir = join(packagesDir, entry.name);
      const nestedEntries = readdirSync(nestedDir, { withFileTypes: true });
      for (const nestedEntry of nestedEntries) {
        if (!nestedEntry.isDirectory()) continue;
        const nestedCandidate = join(nestedDir, nestedEntry.name, `${name}.exe`);
        if (existsSync(nestedCandidate)) return nestedCandidate;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function configureRustCompilerCache(root, env) {
  const sccache = findExecutable('sccache') ?? findWindowsWingetExecutable('sccache');
  if (!sccache) {
    console.log('[release-build] sccache not found; using direct rustc');
    return null;
  }

  const cacheDir = join(root, '.openharness', 'cache', 'sccache');
  mkdirSync(cacheDir, { recursive: true });

  env.RUSTC_WRAPPER = sccache;
  env.SCCACHE_DIR ??= cacheDir;
  env.SCCACHE_CACHE_SIZE ??= '20G';
  env.SCCACHE_IDLE_TIMEOUT ??= '0';

  const start = spawnSync(sccache, ['--start-server'], {
    encoding: 'utf8',
    env,
    shell: false,
  });
  const startupOutput = `${start.stdout ?? ''}${start.stderr ?? ''}`.toLowerCase();
  const alreadyRunning = startupOutput.includes('address in use');
  if (start.status !== 0 && !alreadyRunning) {
    if (start.stderr) {
      process.stderr.write(start.stderr);
    }
    console.warn('[release-build] Failed to start sccache server; continuing with wrapper enabled');
  }

  console.log(`[release-build] Using sccache: ${sccache}`);
  console.log(`[release-build] Cache dir: ${env.SCCACHE_DIR}`);
  return sccache;
}

function patchDmgArtifacts(root) {
  const patchScript = join(root, 'scripts', 'patch-dmg-extras.sh');
  const targetDir = join(root, 'target');
  const dmgFiles = findDmgFiles(targetDir);

  if (dmgFiles.length === 0) {
    console.log('[release-build] No .dmg files found; skipping patch step.');
    return;
  }

  for (const dmg of dmgFiles) {
    console.log(`[release-build] Patching ${dmg}`);
    const result = spawnSync('bash', [patchScript, dmg], {
      stdio: 'inherit',
      shell: false,
    });
    if (result.status !== 0) {
      console.error(`[release-build] Failed to patch ${dmg}`);
      process.exit(1);
    }
  }
}

function findDmgFiles(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findDmgFiles(full));
      } else if (entry.name.endsWith('.dmg')) {
        results.push(full);
      }
    }
  } catch {
    // target dir may not exist
  }
  return results;
}

async function main() {
  const forwardArgs = collectForwardArgs();

  await ensureOpenSslWindows();

  const desktopDir = join(ROOT, 'src', 'apps', 'desktop');
  const buildEnv = { ...process.env, CI: 'true' };
  const sccache = configureRustCompilerCache(ROOT, buildEnv);
  const tauriConfig = join(desktopDir, 'tauri.conf.json');
  const tauriBin = join(ROOT, 'node_modules', '.bin', 'tauri');

  const result = spawnSync(tauriBin, ['build', '--config', tauriConfig, ...forwardArgs], {
    cwd: desktopDir,
    env: buildEnv,
    stdio: 'inherit',
    shell: true,
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status === 0 && process.platform === 'darwin') {
    patchDmgArtifacts(ROOT);
  }

  if (sccache) {
    spawnSync(sccache, ['--show-stats'], {
      env: buildEnv,
      stdio: 'inherit',
      shell: false,
    });
  }

  process.exit(result.status ?? 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
