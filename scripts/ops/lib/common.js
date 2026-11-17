'use strict';

/** Small helpers shared by the operations scripts. No third-party dependencies. */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function fsyncDir(dir) {
  let fd;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch (_err) {
    // not supported on every file system
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function removeQuietly(file) {
  try {
    fs.unlinkSync(file);
    return true;
  } catch (_err) {
    return false;
  }
}

/** Write JSON so readers see either the old file or the complete new one, never a mix. */
function writeJsonAtomic(file, value, mode = 0o640) {
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    const fd = fs.openSync(temp, 'wx', mode);
    try {
      fs.writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
    fsyncDir(path.dirname(file));
  } catch (err) {
    removeQuietly(temp);
    throw err;
  }
}

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`${file} could not be read: ${err.message}`, { cause: err });
  }
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1024 * 1024 })) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

/**
 * Copy a file into a directory: write to a hidden temporary name, fsync,
 * rename, then read the copy back and compare size and SHA-256.
 */
async function copyFileVerified(source, targetDir, expected) {
  const name = path.basename(source);
  const target = path.join(targetDir, name);
  const temp = path.join(targetDir, `.${name}.partial-${crypto.randomBytes(4).toString('hex')}`);
  try {
    await fs.promises.copyFile(source, temp, fs.constants.COPYFILE_EXCL);
    const fd = fs.openSync(temp, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, target);
    fsyncDir(targetDir);
  } catch (err) {
    removeQuietly(temp);
    throw err;
  }
  const copy = await sha256File(target);
  if (copy.bytes !== expected.bytes || copy.sha256 !== expected.sha256) {
    removeQuietly(target);
    throw new Error(
      `The copy at ${target} does not match the original (size ${copy.bytes} vs ${expected.bytes}); it was removed.`
    );
  }
  return target;
}

/**
 * Split a command template into arguments without a shell. Supports
 * 'single quotes', "double quotes" and backslash escapes. Placeholders such as
 * {file} are replaced after splitting, so a path with spaces stays one argument.
 */
function splitCommand(template) {
  const args = [];
  let current = '';
  let inToken = false;
  let quote = null;
  for (let i = 0; i < template.length; i += 1) {
    const ch = template[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && (template[i + 1] === '"' || template[i + 1] === '\\')) current += template[++i];
      else current += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      inToken = true;
    } else if (ch === '\\' && i + 1 < template.length) {
      current += template[++i];
      inToken = true;
    } else if (/\s/.test(ch)) {
      if (inToken) args.push(current);
      current = '';
      inToken = false;
    } else {
      current += ch;
      inToken = true;
    }
  }
  if (quote) throw new Error(`Unclosed ${quote} quote in command: ${template}`);
  if (inToken) args.push(current);
  if (!args.length) throw new Error('The command is empty');
  return args;
}

function expandCommand(template, values) {
  return splitCommand(template).map((arg) =>
    arg.replace(/\{(\w+)\}/g, (all, key) => (key in values ? values[key] : all))
  );
}

/**
 * Run a program with an argument list, without a shell.
 * @returns {{status: number|null, signal: string|null, stdout: string, stderr: string, error?: Error, args: string[]}}
 */
function runArgs(args, { input, timeoutMs = 600_000 } = {}) {
  const result = spawnSync(args[0], args.slice(1), {
    input,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
    args,
  };
}

/** Run a command template without a shell; {placeholders} are replaced after splitting. */
function runTemplate(template, values, options) {
  return runArgs(expandCommand(template, values), options);
}

function healthUrl(config) {
  let host = config.host;
  if (host === '0.0.0.0' || host === '::' || host === '') host = '127.0.0.1';
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
  return `http://${host}:${config.port}/healthz`;
}

/**
 * GET a health URL. Resolves to {ok, status, ms, error} and never rejects.
 * `reachable` is true when anything answered over HTTP.
 */
function checkHealth(url, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({ ms: Date.now() - started, ...result });
    };
    const req = http.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'ero-crm-ops' } }, (res) => {
      res.resume();
      res.on('end', () => finish({ ok: res.statusCode === 200, reachable: true, status: res.statusCode }));
      res.on('error', (err) => finish({ ok: false, reachable: true, status: res.statusCode, error: err.message }));
    });
    req.on('timeout', () => {
      req.destroy(new Error(`no answer within ${timeoutMs} ms`));
    });
    req.on('error', (err) => finish({ ok: false, reachable: false, error: err.code || err.message }));
  });
}

/** Highest applied migration version, or 0 when the table does not exist. */
function migrationVersion(db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!table) return 0;
  return db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get().v;
}

/** UTC timestamp safe for file names, same shape as the backup file names. */
function fileTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
}

module.exports = {
  fsyncDir,
  removeQuietly,
  writeJsonAtomic,
  readJsonIfExists,
  sha256File,
  copyFileVerified,
  splitCommand,
  expandCommand,
  runArgs,
  runTemplate,
  healthUrl,
  checkHealth,
  migrationVersion,
  fileTimestamp,
};
