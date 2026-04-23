#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

function decodeOutput(output) {
  if (!output) return '';
  if (typeof output === 'string') return output;
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output);
  if (process.platform !== 'win32') return buffer.toString('utf-8');

  const utf8 = buffer.toString('utf-8');
  if (!utf8.includes('锟?')) return utf8;

  try {
    const { TextDecoder } = require('util');
    const decoder = new TextDecoder('gbk');
    const gbk = decoder.decode(buffer);
    if (gbk && !gbk.includes('锟?')) return gbk;
    return gbk || utf8;
  } catch {
    return utf8;
  }
}

function tailOutput(output, maxLines = 12) {
  if (!output) return '';
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
  if (lines.length <= maxLines) return lines.join('\n');
  return lines.slice(-maxLines).join('\n');
}

function runSilent(command, cwd = repoRoot) {
  try {
    const stdout = execSync(command, {
      cwd,
      stdio: 'pipe',
      encoding: 'buffer',
    });
    return { ok: true, stdout: decodeOutput(stdout), stderr: '' };
  } catch (error) {
    const stdout = error.stdout ? decodeOutput(error.stdout) : '';
    const stderr = error.stderr ? decodeOutput(error.stderr) : '';
    return { ok: false, stdout, stderr, error };
  }
}

function runInherit(command, cwd = repoRoot) {
  try {
    execSync(command, { cwd, stdio: 'inherit' });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}

function runShellCommand(command, cwd = repoRoot) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/sh';
    const shellArgs = isWindows ? ['/c', command] : ['-c', command];

    const child = spawn(shell, shellArgs, {
      cwd,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

function spawnCommand(cmd, args, cwd = repoRoot, extraOptions = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
      ...extraOptions,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

module.exports = {
  decodeOutput,
  repoRoot,
  runInherit,
  runShellCommand,
  runSilent,
  spawnCommand,
  tailOutput,
};
