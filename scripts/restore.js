#!/usr/bin/env node
'use strict';

/**
 * Restore the database from a backup file (encrypted .db.enc or plain .db).
 *
 *   node scripts/restore.js <backup-file> [--to <path>] [--yes] [--force-running] [--key-file <path>]
 *
 *   --to <path>        restore to this path instead of DATABASE_PATH and change nothing else (restore drills)
 *   --yes              do not ask for confirmation
 *   --force-running    restore even though the application answers on its health endpoint (not recommended)
 *   --key-file <path>  key to decrypt with, instead of BACKUP_KEY_FILE
 *
 * The backup is decrypted to a temporary file in the target's directory and
 * checked (integrity_check, foreign_key_check) before anything is touched.
 * The current database and its -wal/-shm files are moved aside as
 * <name>.pre-restore-<timestamp>, never deleted.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const Database = require('better-sqlite3');
const { loadConfig, loadDotEnv } = require('../src/config');
const { loadOpsConfig } = require('../src/config/ops');
const { checkIntegrity, tableCounts } = require('../src/db/connection');
const { decryptFile, readKeyFile, isEncryptedFile } = require('../src/db/backup-crypto');
const {
  fsyncDir,
  removeQuietly,
  healthUrl,
  checkHealth,
  migrationVersion,
  fileTimestamp,
} = require('./ops/lib/common');

const USAGE =
  'Usage: node scripts/restore.js <backup-file> [--to <path>] [--yes] [--force-running] [--key-file <path>]';
const SIDE_FILES = ['', '-wal', '-shm', '-journal'];

function parseArgs(argv) {
  const options = { yes: false, forceRunning: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--force-running') options.forceRunning = true;
    else if (arg === '--to' || arg === '--key-file') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} needs a path.\n${USAGE}`);
      options[arg === '--to' ? 'to' : 'keyFile'] = value;
    } else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}.\n${USAGE}`);
    else rest.push(arg);
  }
  if (rest.length !== 1) throw new Error(USAGE);
  options.file = path.resolve(rest[0]);
  return options;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function inspect(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return { integrity: checkIntegrity(db), counts: tableCounts(db), version: migrationVersion(db) };
  } finally {
    db.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadDotEnv();

  let config = null;
  try {
    config = loadConfig();
  } catch (err) {
    if (!options.to)
      throw new Error(`${err.message}\nSet the environment (or pass --to <path>) and try again.`, { cause: err });
  }
  let ops = null;
  try {
    ops = loadOpsConfig();
  } catch (err) {
    if (!options.keyFile) throw err;
  }

  const target = path.resolve(options.to || config.databasePath);
  const isConfiguredTarget = Boolean(config && config.databasePath === target);
  if (!fs.existsSync(options.file)) throw new Error(`The backup file ${options.file} does not exist.`);
  if (options.file === target) throw new Error('The backup file and the target are the same file.');
  if (fs.existsSync(target) && !fs.statSync(target).isFile()) throw new Error(`${target} is not a regular file.`);

  const encrypted = isEncryptedFile(options.file);
  const keyFile = options.keyFile || ops?.backupKeyFile;
  if (encrypted && !keyFile) {
    throw new Error('This backup is encrypted. Set BACKUP_KEY_FILE or pass --key-file <path>.');
  }

  const targetDir = path.dirname(target);
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o750 });
  const temp = path.join(targetDir, `.restore-${fileTimestamp()}-${crypto.randomBytes(4).toString('hex')}.db`);
  const cleanup = () => SIDE_FILES.forEach((suffix) => removeQuietly(temp + suffix));
  const onSignal = () => {
    cleanup();
    console.error('Restore interrupted. Nothing was changed.');
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    console.log(`Backup file:   ${options.file}${encrypted ? ' (encrypted)' : ''}`);
    console.log(`Restore to:    ${target}`);
    if (encrypted) await decryptFile(options.file, temp, readKeyFile(keyFile));
    else {
      fs.copyFileSync(options.file, temp, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(temp, 0o600);
    }

    const result = inspect(temp);
    console.log(`Integrity:     ${result.integrity.ok ? 'ok' : 'FAILED'}`);
    console.log(`Migration:     version ${result.version}`);
    console.log('Row counts:');
    for (const [table, count] of Object.entries(result.counts)) console.log(`  ${table.padEnd(40)} ${count}`);
    if (!result.integrity.ok) {
      throw new Error(
        `The backup failed its consistency check and was not restored: ${JSON.stringify({
          integrity: result.integrity.integrity.slice(0, 5),
          foreignKeyViolations: result.integrity.foreignKeyViolations.length,
        })}. Try an older backup.`
      );
    }

    if (isConfiguredTarget) {
      const url = healthUrl(config);
      const health = await checkHealth(url, 2000);
      if (health.reachable) {
        if (!options.forceRunning) {
          throw new Error(
            `The application is answering on ${url}, so it is probably using ${target}. Nothing was changed.\n` +
              'Stop it first (sudo systemctl stop ero-crm.service) and run this command again.'
          );
        }
        console.warn(`WARNING: the application is answering on ${url}; continuing because --force-running was given.`);
      }
    }

    if (!options.yes) {
      if (!process.stdin.isTTY)
        throw new Error('Not running in a terminal: pass --yes to confirm. Nothing was changed.');
      const answer = await ask(
        `\nThis replaces ${target}. The current file is kept aside. Type "restore" to continue: `
      );
      if (answer !== 'restore') throw new Error('Not confirmed. Nothing was changed.');
    }

    // Move the current database and its side files aside, then put the restored file in place.
    const previous = fs.existsSync(target) ? fs.statSync(target) : null;
    let aside = `${target}.pre-restore-${fileTimestamp()}`;
    if (SIDE_FILES.some((suffix) => fs.existsSync(aside + suffix))) {
      aside = `${aside}-${crypto.randomBytes(3).toString('hex')}`;
    }
    const moved = [];
    try {
      for (const suffix of SIDE_FILES) {
        if (fs.existsSync(target + suffix)) {
          fs.renameSync(target + suffix, aside + suffix);
          moved.push(suffix);
        }
      }
      fs.renameSync(temp, target);
    } catch (err) {
      for (const suffix of moved) {
        if (!fs.existsSync(target + suffix)) fs.renameSync(aside + suffix, target + suffix);
      }
      throw new Error(`Putting the restored file in place failed (${err.message}); the original was put back.`, {
        cause: err,
      });
    }
    const dirStat = fs.statSync(targetDir);
    fs.chmodSync(target, previous ? previous.mode & 0o777 : dirStat.mode & 0o020 ? 0o660 : 0o640);
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      // Run as root: give the file to whoever owned the old one (or the directory), not to root.
      fs.chownSync(target, previous ? previous.uid : dirStat.uid, previous ? previous.gid : dirStat.gid);
    }
    fsyncDir(targetDir);

    console.log(`\nRestored ${target} from ${path.basename(options.file)}.`);
    if (moved.length) {
      console.log(
        `The previous database was kept as ${aside}${moved.length > 1 ? ' (with its -wal/-shm files)' : ''}.`
      );
      console.log('Delete it only once you are satisfied with the restored data.');
    }
    if (isConfiguredTarget) {
      console.log('\nNext steps:');
      console.log('  1. Start the service:   sudo systemctl start ero-crm.service');
      console.log(`     At start-up it applies any migrations newer than version ${result.version}.`);
      console.log(`  2. Check it is healthy: curl -fsS ${healthUrl(config)}`);
      console.log('  3. Sign in and check the most recent records you expect to see.');
    } else {
      console.log('This was a restore to a separate path. Nothing else was changed.');
    }
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error(`Restore failed: ${err.message}`);
  process.exit(1);
});
