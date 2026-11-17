#!/usr/bin/env node
'use strict';

/**
 * Take an encrypted, verified backup of the database and copy it off the server.
 *
 *   node scripts/backup.js [label]        (npm run backup -- [label])
 *
 * Steps, in order:
 *   1. Encrypt any plain employer-*.db backups already in BACKUP_DIR (the
 *      application writes one, unencrypted, before it applies migrations at
 *      start-up) and delete the plain copies.
 *   2. Take a verified backup with SQLite's online backup API.
 *   3. Encrypt it (AES-256-GCM), verify the encrypted file decrypts to the
 *      same bytes, and delete the unencrypted copy.
 *   4. Copy the encrypted files off the server (BACKUP_REMOTE_DIR or
 *      BACKUP_REMOTE_COMMAND) and verify the copy.
 *   5. Apply the retention rules locally and in BACKUP_REMOTE_DIR.
 *   6. Record success in BACKUP_DIR/last-success.json.
 *
 * Exits non-zero with an explanation on any failure. Temporary files are
 * removed; a complete, verified local backup is kept even if the off-server
 * copy fails, because it is still better than no backup.
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, loadDotEnv } = require('../src/config');
const { loadOpsConfig, assertBackupKeyConfigured } = require('../src/config/ops');
const Database = require('better-sqlite3');
const { openDatabase, checkIntegrity } = require('../src/db/connection');
const { backupDatabase } = require('../src/db/backup');
const { encryptFile, decryptFile, readKeyFile } = require('../src/db/backup-crypto');
const { applyRetention, BACKUP_FILE_PATTERN } = require('../src/db/backup-retention');
const { writeJsonAtomic, sha256File, copyFileVerified, runTemplate, removeQuietly } = require('./ops/lib/common');

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');
const LEFTOVER_MIN_AGE_MS = 60 * 1000;
const STALE_PARTIAL = /^\.?employer-.*\.partial-[0-9a-f]+$/;
const HOUR_MS = 60 * 60 * 1000;

class RemoteCopyError extends Error {}

function log(message) {
  console.log(message);
}

function banner(lines) {
  const width = Math.max(...lines.map((line) => line.length));
  const rule = '!'.repeat(width + 4);
  console.warn([rule, ...lines.map((line) => `! ${line.padEnd(width)} !`), rule].join('\n'));
}

function isSqliteFile(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(SQLITE_MAGIC.length);
    return fs.readSync(fd, head, 0, head.length, 0) === head.length && head.equals(SQLITE_MAGIC);
  } finally {
    fs.closeSync(fd);
  }
}

/** True when the file opens as an SQLite database and passes integrity_check and foreign_key_check. */
function isIntactDatabase(file) {
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    return checkIntegrity(db).ok;
  } catch (_err) {
    return false;
  } finally {
    if (db) db.close();
  }
}

function isProcessAlive(pid) {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Make sure only one backup runs at a time (the nightly timer, a deploy and a
 * manual run could otherwise overlap). A lock left by a process that no longer
 * exists is taken over.
 */
function acquireLock(dir) {
  const file = path.join(dir, '.backup.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, 'wx', 0o640);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => removeQuietly(file);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const pid = Number(fs.readFileSync(file, 'utf8').trim());
      if (isProcessAlive(pid)) {
        throw new Error(`Another backup is running (process ${pid}). Wait for it to finish and try again.`, {
          cause: err,
        });
      }
      removeQuietly(file);
    }
  }
  throw new Error(`Could not take the backup lock ${file}. Remove it if no backup is running.`);
}

/** Remove temporary files left behind by an interrupted earlier run (older than one hour). */
function removeStalePartials(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !STALE_PARTIAL.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (Date.now() - fs.statSync(file).mtimeMs > HOUR_MS && removeQuietly(file)) {
      log(`Removed an incomplete file from an interrupted earlier run: ${file}`);
    }
  }
}

/** Encrypt a plain backup, check the result decrypts to identical bytes, then delete the plain copy. */
async function encryptAndVerify(plainPath, key) {
  const encPath = `${plainPath}.enc`;
  let encrypted;
  if (fs.existsSync(encPath)) {
    // An earlier run encrypted this file but stopped before deleting the plain copy.
    const plain = await sha256File(plainPath);
    const check = await decryptFile(encPath, null, key);
    if (check.sha256 !== plain.sha256) {
      throw new Error(`${encPath} exists but does not match ${plainPath}. Move one of them away and run again.`);
    }
    const out = await sha256File(encPath);
    encrypted = { path: encPath, bytes: out.bytes, sha256: out.sha256 };
  } else {
    const result = await encryptFile(plainPath, encPath, key);
    try {
      const check = await decryptFile(encPath, null, key);
      if (check.sha256 !== result.plainSha256 || check.bytes !== result.plainBytes) {
        throw new Error(`${encPath} did not decrypt to the same bytes as ${plainPath}`);
      }
    } catch (err) {
      removeQuietly(encPath);
      throw err;
    }
    encrypted = { path: encPath, bytes: result.bytes, sha256: result.sha256 };
  }
  fs.unlinkSync(plainPath);
  return encrypted;
}

/** Step 1: encrypt plain backups written by the application before migrations. */
async function encryptLeftovers(dir, key) {
  const converted = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = BACKUP_FILE_PATTERN.exec(entry.name);
    if (!match || match[8]) continue; // not a backup, or already encrypted
    const file = path.join(dir, entry.name);
    if (Date.now() - fs.statSync(file).mtimeMs < LEFTOVER_MIN_AGE_MS) {
      log(`Skipped ${file} for now: it was written less than a minute ago. It is encrypted on the next run.`);
      continue;
    }
    if (!isSqliteFile(file) || !isIntactDatabase(file)) {
      console.warn(
        `Skipped ${file}: it is named like a backup but is not an intact SQLite database. ` +
          'It was not encrypted or deleted. Check it by hand (see RUNBOOK.md, "A backup failed or is stale").'
      );
      continue;
    }
    const encrypted = await encryptAndVerify(file, key);
    log(`Encrypted an earlier unencrypted backup: ${encrypted.path}`);
    converted.push(encrypted);
  }
  return converted;
}

function assertRemoteDirUsable(dir) {
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch (err) {
    throw new RemoteCopyError(
      `The off-server backup directory ${dir} is not available (${err.code || err.message}). ` +
        'If it is a network share, check that it is mounted. It is never created automatically, so that a missing ' +
        'mount does not silently fill the local disk instead.'
    );
  }
  if (!stat.isDirectory()) throw new RemoteCopyError(`BACKUP_REMOTE_DIR ${dir} is not a directory.`);
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (_err) {
    throw new RemoteCopyError(`The off-server backup directory ${dir} is not writable by this user.`);
  }
}

/** Step 4, directory mode: copy every local encrypted backup the share does not have yet. */
async function copyToRemoteDir(ops, localDir, mustSend) {
  const dir = ops.backupRemoteDir;
  assertRemoteDirUsable(dir);
  removeStalePartials(dir);
  const present = new Set(fs.readdirSync(dir));
  const candidates = new Map(mustSend.map((file) => [path.basename(file.path), file]));
  // Catch up on files an earlier failed run could not copy.
  for (const name of fs.readdirSync(localDir)) {
    const match = BACKUP_FILE_PATTERN.exec(name);
    if (match && match[8] && !candidates.has(name) && !present.has(name)) {
      candidates.set(name, { path: path.join(localDir, name), ...(await sha256File(path.join(localDir, name))) });
    }
  }
  const copied = [];
  for (const [name, file] of candidates) {
    if (present.has(name)) {
      const existing = await sha256File(path.join(dir, name));
      if (existing.sha256 === file.sha256) continue;
      throw new RemoteCopyError(
        `${path.join(dir, name)} already exists with different content. It was not overwritten.`
      );
    }
    try {
      await copyFileVerified(file.path, dir, file);
    } catch (err) {
      throw new RemoteCopyError(`Copying ${name} to ${dir} failed: ${err.code || err.message}`, { cause: err });
    }
    copied.push(path.join(dir, name));
  }
  return copied;
}

/** Step 4, command mode: run IT's command once per file, without a shell. */
function copyWithCommand(ops, files) {
  const sent = [];
  for (const file of files) {
    const result = runTemplate(
      ops.backupRemoteCommand,
      { file: file.path, name: path.basename(file.path) },
      { timeoutMs: ops.backupRemoteTimeoutSeconds * 1000 }
    );
    if (result.error || result.status !== 0) {
      const detail = result.error
        ? result.error.code === 'ETIMEDOUT'
          ? `it did not finish within ${ops.backupRemoteTimeoutSeconds} seconds`
          : result.error.message
        : `exit status ${result.status ?? result.signal}`;
      const output = (result.stderr || result.stdout).trim().split('\n').slice(-10).join('\n');
      throw new RemoteCopyError(
        `The off-server copy command failed for ${path.basename(file.path)} (${detail}).` +
          (output ? `\nIts output was:\n${output}` : '')
      );
    }
    sent.push(file.path);
  }
  return sent;
}

async function main() {
  loadDotEnv();
  const label = process.argv[2] || 'manual';
  if (!/^[A-Za-z0-9-]{1,60}$/.test(label)) {
    throw new Error(`The label "${label}" may contain only letters, digits and hyphens (at most 60).`);
  }
  const config = loadConfig();
  const ops = loadOpsConfig();
  assertBackupKeyConfigured(ops);
  const key = ops.backupKeyFile ? readKeyFile(ops.backupKeyFile) : null;

  if (config.databasePath === ':memory:' || !fs.existsSync(config.databasePath)) {
    throw new Error(`The database ${config.databasePath} does not exist. Check DATABASE_PATH.`);
  }
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o750 });
  const releaseLock = acquireLock(config.backupDir);
  try {
    await run(config, ops, key, label);
  } finally {
    releaseLock();
  }
}

async function run(config, ops, key, label) {
  removeStalePartials(config.backupDir);

  const converted = key ? await encryptLeftovers(config.backupDir, key) : [];

  const db = openDatabase(config.databasePath, { fileMustExist: true });
  const before = new Set(fs.readdirSync(config.backupDir));
  let plain;
  try {
    plain = await backupDatabase(db, config.backupDir, label);
  } catch (err) {
    // backupDatabase can fail after writing its file (e.g. verification): remove what it wrote.
    for (const name of fs.readdirSync(config.backupDir)) {
      if (!before.has(name) && /^employer-.*\.db(-journal|-wal|-shm)?$/.test(name)) {
        removeQuietly(path.join(config.backupDir, name));
      }
    }
    throw err;
  } finally {
    db.close();
  }
  log(`Backup taken and verified: ${plain.path} (${plain.bytes} bytes)`);

  let final;
  if (key) {
    try {
      final = await encryptAndVerify(plain.path, key);
    } catch (err) {
      removeQuietly(plain.path); // never leave an unencrypted copy behind
      throw new Error(`Encrypting the backup failed: ${err.message}`, { cause: err });
    }
    log(`Encrypted and verified: ${final.path} (${final.bytes} bytes); the unencrypted copy was deleted.`);
  } else {
    const digest = await sha256File(plain.path);
    final = { path: plain.path, bytes: digest.bytes, sha256: digest.sha256 };
    console.warn('BACKUP_KEY_FILE is not set: this backup is NOT encrypted (allowed only in development).');
  }

  const toSend = [final, ...converted];
  const remote = { mode: ops.remoteMode, copied: [] };
  if (ops.remoteMode === 'dir') {
    remote.directory = ops.backupRemoteDir;
    remote.copied = await copyToRemoteDir(ops, config.backupDir, toSend);
    for (const file of remote.copied) log(`Copied off the server and verified: ${file}`);
  } else if (ops.remoteMode === 'command') {
    remote.copied = copyWithCommand(ops, toSend).map((file) => path.basename(file));
    for (const name of remote.copied) log(`Off-server copy command succeeded for ${name}`);
  } else if (ops.isProductionLike) {
    banner([
      'WARNING: no off-server copy is configured (BACKUP_REMOTE_DIR or BACKUP_REMOTE_COMMAND).',
      'This backup exists only on this server. It does NOT protect against losing the server',
      '(disk failure, ransomware, VM deleted). Configure an off-server copy: see DEPLOYMENT.md.',
    ]);
  } else {
    log('No off-server copy is configured (development).');
  }

  const local = applyRetention(config.backupDir, ops.retention);
  for (const name of local.removed) log(`Retention: removed old backup ${path.join(config.backupDir, name)}`);
  if (ops.remoteMode === 'dir') {
    const remoteRetention = applyRetention(ops.backupRemoteDir, ops.retention);
    for (const name of remoteRetention.removed) {
      log(`Retention: removed old backup ${path.join(ops.backupRemoteDir, name)}`);
    }
  }

  const record = {
    finishedAt: new Date().toISOString(),
    file: final.path,
    bytes: final.bytes,
    sha256: final.sha256,
    tableCounts: plain.counts,
    remote,
    encrypted: Boolean(key),
    label,
  };
  writeJsonAtomic(path.join(config.backupDir, 'last-success.json'), record);
  log(`Backup complete. Recorded in ${path.join(config.backupDir, 'last-success.json')}`);
}

main().catch((err) => {
  if (err instanceof RemoteCopyError) {
    console.error(
      `Backup failed: ${err.message}\n` +
        'The local backup in BACKUP_DIR was created, encrypted and verified, but it is NOT yet protected against ' +
        'the loss of this server. Fix the problem above and run the backup again (npm run backup); files that were ' +
        'not copied are sent on the next successful run.'
    );
  } else {
    console.error(`Backup failed: ${err.message}`);
  }
  process.exit(1);
});
