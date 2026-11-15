#!/usr/bin/env node
'use strict';

/**
 * Apply pending database migrations, or show their status.
 *
 *   node scripts/migrate.js            apply pending migrations (backs up first)
 *   node scripts/migrate.js --status   list applied and pending migrations
 *
 * Prints row counts for every table before and after, and exits non-zero if
 * any table lost rows or the integrity check fails.
 */

const { loadConfig, loadDotEnv } = require('../src/config');
const { openDatabase, checkIntegrity } = require('../src/db/connection');
const { migrate, migrationStatus } = require('../src/db/migrate');
const { backupDatabase } = require('../src/db/backup');

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  try {
    if (process.argv.includes('--status')) {
      const { applied, pending } = migrationStatus(db);
      console.log(`Database: ${config.databasePath}`);
      for (const row of applied) console.log(`  applied  ${String(row.version).padStart(4, '0')}_${row.name}  (${row.applied_at})`);
      for (const m of pending) console.log(`  pending  ${m.file}`);
      if (!applied.length && !pending.length) console.log('  no migrations found');
      return;
    }

    const result = await migrate(db, {
      backup: (label) => backupDatabase(db, config.backupDir, label).then((r) => r.path),
    });

    if (!result.applied.length) {
      console.log('Database is up to date. Nothing to do.');
    } else {
      console.log(`Applied: ${result.applied.join(', ')}`);
      console.log('Row counts (before -> after):');
      const tables = new Set([...Object.keys(result.countsBefore), ...Object.keys(result.countsAfter)]);
      let lost = false;
      for (const table of [...tables].sort()) {
        const before = result.countsBefore[table];
        const after = result.countsAfter[table];
        const flag = before !== undefined && (after === undefined || after < before) ? '  <-- ROWS LOST' : '';
        if (flag) lost = true;
        console.log(`  ${table.padEnd(40)} ${String(before ?? '-').padStart(8)} -> ${String(after ?? '-').padStart(8)}${flag}`);
      }
      if (lost) throw new Error('One or more tables lost rows. Restore the pre-migration backup and investigate.');
    }

    const integrity = checkIntegrity(db);
    if (!integrity.ok) throw new Error(`Integrity check failed: ${JSON.stringify(integrity)}`);
    console.log('Integrity check: ok');
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
