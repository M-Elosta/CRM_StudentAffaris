'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

/**
 * Open the SQLite database with the settings every connection must have.
 *
 * - WAL journal: readers never block the single writer.
 * - foreign_keys: SQLite enforces foreign keys per connection, and it is off by default.
 * - busy_timeout: wait for a competing writer instead of failing immediately.
 * - synchronous=FULL: a committed transaction survives power loss. Write volume
 *   in this application is low, so the extra fsync is not noticeable.
 *
 * The database must live on a local disk. SQLite locking is not reliable on
 * network file systems (NFS, SMB).
 */
function openDatabase(databasePath, { readonly = false, fileMustExist = false } = {}) {
  const inMemory = databasePath === ':memory:';
  if (!inMemory && !readonly) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o750 });
  }

  const db = new Database(databasePath, { readonly, fileMustExist });
  if (!readonly) {
    if (!inMemory) db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    db.close();
    throw new Error('SQLite foreign key enforcement could not be enabled');
  }
  return db;
}

/** Run SQLite's own consistency checks. Returns { ok, integrity, foreignKeyViolations }. */
function checkIntegrity(db) {
  const integrity = db.pragma('integrity_check').map((row) => Object.values(row)[0]);
  const foreignKeyViolations = db.pragma('foreign_key_check');
  return {
    ok: integrity.length === 1 && integrity[0] === 'ok' && foreignKeyViolations.length === 0,
    integrity,
    foreignKeyViolations,
  };
}

/** Row count for every user table, used to verify migrations and restores. */
function tableCounts(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
  const counts = {};
  for (const name of tables) {
    counts[name] = db.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get().n;
  }
  return counts;
}

module.exports = { openDatabase, checkIntegrity, tableCounts };
