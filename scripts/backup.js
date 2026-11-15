#!/usr/bin/env node
'use strict';

/**
 * Take a verified backup of the database into BACKUP_DIR and prune old copies.
 *
 *   node scripts/backup.js [label]
 */

const { loadConfig, loadDotEnv } = require('../src/config');
const { openDatabase } = require('../src/db/connection');
const { backupDatabase, pruneBackups } = require('../src/db/backup');

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const db = openDatabase(config.databasePath, { fileMustExist: true });
  try {
    const result = await backupDatabase(db, config.backupDir, process.argv[2] || 'manual');
    console.log(`Backup created and verified: ${result.path} (${result.bytes} bytes)`);
    for (const name of pruneBackups(config.backupDir, config.backupRetention)) {
      console.log(`Removed old backup: ${name}`);
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`Backup failed: ${err.message}`);
  process.exit(1);
});
