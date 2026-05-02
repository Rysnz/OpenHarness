#!/usr/bin/env node
/**
 * MiniApp JS Worker host — runs in Bun or Node.js.
 * stdin: JSON-RPC requests (one per line)
 * stderr: JSON-RPC responses (one per line)
 * stdout: user console.log (forwarded to host)
 *
 * Usage: node worker_host.js '<policy_json>'
 * Cwd: MiniApp app directory (contains source/worker.js, package.json, storage.json)
 */

const fs = require('fs');
const path = require('path');
const { exec: execCallback } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(execCallback);

const policy = JSON.parse(process.argv[2] || '{}');
const appDir = process.cwd();
const storagePath = path.join(appDir, 'storage.json');
const READY_MESSAGE_ID = '__ready';
const JSON_RPC_INTERNAL_ERROR = -32603;
const FS_WRITE_METHODS = new Set(['writeFile', 'mkdir', 'rm', 'appendFile', 'rename', 'copyFile']);
const NO_USER_HANDLER = Symbol('NO_USER_HANDLER');

function writeRpcMessage(message) {
  process.stderr.write(JSON.stringify(message) + '\n');
}

function rpcSend(message) {
  writeRpcMessage(message);
}

/**
 * Emit a push event to the MiniApp iframe (no request id, no reply expected).
 * The host process will forward this to the iframe via "miniapp://worker-event:{appId}".
 *
 * @param {string} event - Event name (e.g. 'progress', 'status')
 * @param {any} data - Event payload
 */
function rpcEmit(event, data) {
  writeRpcMessage({ event, data });
}

// Make rpcEmit available globally so source/worker.js can use it.
global.rpcEmit = rpcEmit;

function isPathAllowed(targetPath, mode) {
  if (!policy.fs) return false;
  const resolved = path.resolve(targetPath);
  const scopes = mode === 'write' ? (policy.fs.write || []) : (policy.fs.read || []);
  return scopes.some((scope) => resolved.startsWith(path.resolve(scope)));
}

function loadStorage() {
  try {
    const data = fs.readFileSync(storagePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveStorage(obj) {
  fs.writeFileSync(storagePath, JSON.stringify(obj, null, 2), 'utf8');
}

function getRequestPath(params) {
  return params.path || params.p;
}

function assertFileAccess(name, params) {
  const targetPath = getRequestPath(params);
  if (targetPath === undefined || name === 'access' || isPathAllowed(targetPath, 'read')) {
    return;
  }

  if (FS_WRITE_METHODS.has(name) && isPathAllowed(targetPath, 'write')) {
    return;
  }

  throw new Error('Path not allowed');
}

function getAllowedShellCommand(command) {
  const rawCommand = (command || '').trim().split(/\s+/)[0];
  return path.basename(rawCommand, path.extname(rawCommand));
}

function isHostAllowed(host, allowList) {
  return allowList.includes('*') || allowList.some((domain) => host === domain || host.endsWith('.' + domain));
}

async function runUserHandler(method, params) {
  const handler = userHandlers[method];
  if (typeof handler !== 'function') {
    return NO_USER_HANDLER;
  }

  return await handler(params || {});
}

let userHandlers = {};
let userHandlerLoadError = null;
try {
  const workerPath = path.join(appDir, 'source', 'worker.js');
  if (fs.existsSync(workerPath)) {
    userHandlers = require(workerPath) || {};
  }
} catch (e) {
  userHandlerLoadError = e;
  console.error('Failed to load source/worker.js:', e.message);
}

async function dispatch(method, params) {
  if (userHandlerLoadError) {
    throw new Error('Failed to load source/worker.js: ' + (userHandlerLoadError.message || String(userHandlerLoadError)));
  }

  const userResult = await runUserHandler(method, params);
  if (userResult !== NO_USER_HANDLER) {
    return userResult;
  }

  const [ns, name] = method.split('.');
  if (ns === 'fs') {
    return dispatchFs(name, method, params);
  }

  if (ns === 'shell') {
    return dispatchShell(name, params);
  }

  if (ns === 'net' && name === 'fetch') {
    return dispatchFetch(params);
  }

  if (ns === 'os' && name === 'info') {
    return dispatchOsInfo();
  }

  if (ns === 'storage') {
    return dispatchStorage(name, params);
  }

  throw new Error('Unknown method: ' + method);
}

function dispatchFs(name, method, params) {
  const p = getRequestPath(params);
  assertFileAccess(name, params);

  switch (name) {
    case 'readFile': {
      const enc = params.encoding || 'utf8';
      const data = fs.readFileSync(p, enc === 'base64' ? undefined : enc);
      return enc === 'base64' ? data.toString('base64') : data;
    }
    case 'writeFile':
      fs.writeFileSync(p, params.data, params.encoding || 'utf8');
      return null;
    case 'readdir': {
      const entries = fs.readdirSync(p, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        path: path.join(p, entry.name),
        isDirectory: entry.isDirectory()
      }));
    }
    case 'stat': {
      const fileStat = fs.statSync(p);
      return { size: fileStat.size, isDirectory: fileStat.isDirectory(), isFile: fileStat.isFile() };
    }
    case 'mkdir':
      fs.mkdirSync(p, { recursive: !!params.recursive });
      return null;
    case 'rm':
      fs.rmSync(p, { recursive: !!params.recursive, force: !!params.force });
      return null;
    case 'copyFile':
      fs.copyFileSync(params.src, params.dst);
      return null;
    case 'rename':
      fs.renameSync(params.oldPath, params.newPath);
      return null;
    case 'appendFile':
      fs.appendFileSync(p, params.data);
      return null;
    case 'access':
      fs.accessSync(p);
      return null;
    default:
      throw new Error('Unknown fs method: ' + method);
  }
}

async function dispatchShell(name, params) {
  if (name !== 'exec') {
    throw new Error('Unknown method: shell.' + name);
  }

  const allow = (policy.shell && policy.shell.allow) || [];
  const base = getAllowedShellCommand(params.command);
  if (allow.length > 0 && !allow.some((allowed) => allowed.toLowerCase() === base.toLowerCase())) {
    throw new Error('Command not in allowlist');
  }

  const opts = { cwd: params.cwd || appDir, timeout: params.timeout || 30000 };
  const { stdout, stderr } = await execAsync(params.command || '', opts);
  return { stdout, stderr, exit_code: 0 };
}

async function dispatchFetch(params) {
  const allow = (policy.net && policy.net.allow) || [];
  let url;
  try {
    url = new URL(params.url);
  } catch {
    throw new Error('Invalid URL');
  }

  if (allow.length > 0 && !isHostAllowed(url.hostname, allow)) {
    throw new Error('Domain not in allowlist');
  }

  const res = await globalThis.fetch(params.url, {
    method: params.method || 'GET',
    headers: params.headers,
    body: params.body
  });
  const body = await res.text();
  const headers = {};
  for (const [key, value] of res.headers.entries()) {
    headers[key] = value;
  }
  return { status: res.status, headers, body };
}

function dispatchOsInfo() {
  const os = require('os');
  return {
    platform: process.platform,
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    cpus: os.cpus().length,
    totalmem: os.totalmem(),
    freemem: os.freemem()
  };
}

function dispatchStorage(name, params) {
  const store = loadStorage();
  if (name === 'get') return store[params.key];
  if (name === 'set') {
    store[params.key] = params.value;
    saveStorage(store);
    return null;
  }

  throw new Error('Unknown method: storage.' + name);
}

rpcSend({ id: READY_MESSAGE_ID, result: { pid: process.pid, version: process.version } });

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('close', () => process.exit(0));
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (!id || !method) return;
  try {
    const result = await dispatch(method, params || {});
    rpcSend({ id, result });
  } catch (err) {
    rpcSend({ id, error: { code: JSON_RPC_INTERNAL_ERROR, message: err.message || String(err) } });
  }
});
