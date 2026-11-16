#!/usr/bin/env node
'use strict';

/**
 * Check the live database for corruption without changing it.
 *
 *   node scripts/ops/integrity-check.js
 *
 * Opens DATABASE_PATH read-only, runs PRAGMA integrity_check and
 * PRAGMA foreign_key_check, writes the result to BACKUP_DIR/last-integrity.json
 * (read by monitor.js) and exits non-zero if anything is wrong. Safe to run
 * while the application is running.
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, loadDotEnv } = require('../../src/config');
const { openDatabase, checkIntegrity } = require('../../src/db/connection');
const { writeJsonAtomic, migrationVersion } = require('./lib/common');

function main() {
  loadDotEnv();
  const config = loadConfig();
  if (config.databasePath === ':memory:' || !fs.existsSync(config.databasePath)) {
    throw new Error(`The database ${config.databasePath} does not exist. Check DATABASE_PATH.`);
  }
  const started = Date.now();
  const db = openDatabase(config.databasePath, { readonly: true, fileMustExist: true });
  let result;
  let version;
  try {
    result = checkIntegrity(db);
    version = migrationVersion(db);
  } finally {
    db.close();
  }

  const record = {
    finishedAt: new Date().toISOString(),
    ok: result.ok,
    database: config.databasePath,
    migrationVersion: version,
    durationMs: Date.now() - started,
    integrity: result.integrity.slice(0, 20),
    foreignKeyViolations: result.foreignKeyViolations.length,
  };
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o750 });
  writeJsonAtomic(path.join(config.backupDir, 'last-integrity.json'), record);

  if (!result.ok) {
    console.error(
      `Integrity check FAILED for ${config.databasePath}: ` +
        `integrity_check reported ${JSON.stringify(record.integrity.slice(0, 5))}, ` +
        `${record.foreignKeyViolations} foreign key violation(s). See RUNBOOK.md, "The integrity check fails".`
    );
    process.exit(1);
  }
  console.log(`Integrity check ok for ${config.databasePath} (migration ${version}, ${record.durationMs} ms).`);
}

try {
  main();
} catch (err) {
  console.error(`Integrity check could not run: ${err.message}`);
  process.exit(1);
}
