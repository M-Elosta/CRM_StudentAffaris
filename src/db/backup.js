'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { checkIntegrity, tableCounts } = require('./connection');

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
}

/**
 * Take a consistent copy of a live database using SQLite's online backup API,
 * then open the copy and verify it before reporting success.
 *
 * @returns {Promise<{path: string, counts: object, bytes: number}>}
 */
async function backupDatabase(db, backupDir, label = 'manual') {
  if (db.memory) throw new Error('An in-memory database cannot be backed up to disk');
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o750 });
  const safeLabel = String(label).replace(/[^a-z0-9-]/gi, '-');
  const destination = path.join(backupDir, `employer-${timestamp()}-${safeLabel}.db`);

  await db.backup(destination);
  fs.chmodSync(destination, 0o640);

  // The copy inherits WAL mode, which would leave -wal and -shm files beside
  // it. Switch the copy to a rollback journal so the backup is one
  // self-contained file that can be moved or encrypted on its own.
  const copy = new Database(destination, { fileMustExist: true });
  try {
    copy.pragma('journal_mode = DELETE');
    const result = checkIntegrity(copy);
    if (!result.ok) {
      throw new Error(`Backup ${destination} failed verification: ${JSON.stringify(result)}`);
    }
    return { path: destination, counts: tableCounts(copy), bytes: fs.statSync(destination).size };
  } finally {
    copy.close();
  }
}

/** Keep the newest `keep` backups in a directory and delete the rest. */
function pruneBackups(backupDir, keep) {
  if (!fs.existsSync(backupDir)) return [];
  const files = fs
    .readdirSync(backupDir)
    .filter((name) => /^employer-.*\.db$/.test(name))
    .sort();
  const removed = files.slice(0, Math.max(0, files.length - keep));
  for (const name of removed) fs.unlinkSync(path.join(backupDir, name));
  return removed;
}

module.exports = { backupDatabase, pruneBackups };
