'use strict';

/**
 * Forward-only, versioned database migrations.
 *
 * Files live in src/db/migrations and are named NNNN_description.sql or
 * NNNN_description.js. They run once, in order, each inside its own
 * transaction, and are recorded in the schema_migrations table together with a
 * checksum of the file.
 *
 * Safety rules enforced here:
 *   - An applied migration must never be edited: a checksum mismatch stops startup.
 *   - A new migration may not be numbered below one that has already run.
 *   - A migration that reduces the row count of an existing table is rolled
 *     back, unless the migration explicitly declares that it may remove rows.
 *   - A migration that rebuilds tables (foreign keys off) must leave no foreign
 *     key violations, or it is rolled back.
 *   - If there are pending migrations and the database already holds tables,
 *     the caller-supplied backup function runs first.
 *
 * SQL migrations declare options in leading comments:
 *   -- migrate:foreign-keys-off
 *   -- migrate:allow-row-loss
 * JS migrations export { up(db), foreignKeysOff?: boolean, allowRowLoss?: boolean }.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { tableCounts } = require('./connection');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.(sql|js)$/;

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Read and order the migration files in a directory. */
function listMigrations(dir = MIGRATIONS_DIR) {
  const seen = new Map();
  const migrations = [];
  for (const file of fs.readdirSync(dir).sort()) {
    const match = FILE_PATTERN.exec(file);
    if (!match) {
      if (/\.(sql|js)$/.test(file)) {
        throw new Error(`Migration file "${file}" is not named NNNN_description.sql|js`);
      }
      continue;
    }
    const version = Number(match[1]);
    if (seen.has(version)) {
      throw new Error(`Two migrations share version ${match[1]}: "${seen.get(version)}" and "${file}"`);
    }
    seen.set(version, file);
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    migrations.push({
      version,
      name: match[2],
      file,
      type: match[3],
      fullPath,
      content,
      checksum: checksum(content),
    });
  }
  return migrations.sort((a, b) => a.version - b.version);
}

function loadMigration(migration) {
  if (migration.type === 'sql') {
    return {
      up: (db) => db.exec(migration.content),
      foreignKeysOff: /^\s*--\s*migrate:foreign-keys-off\s*$/m.test(migration.content),
      allowRowLoss: /^\s*--\s*migrate:allow-row-loss\s*$/m.test(migration.content),
    };
  }
  const mod = require(migration.fullPath);
  if (typeof mod.up !== 'function') {
    throw new Error(`Migration "${migration.file}" must export an up(db) function`);
  }
  return { up: mod.up, foreignKeysOff: Boolean(mod.foreignKeysOff), allowRowLoss: Boolean(mod.allowRowLoss) };
}

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
}

function appliedMigrations(db) {
  return db.prepare('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version').all();
}

/** Work out what has run and what is pending, and check the two agree. */
function migrationStatus(db, dir = MIGRATIONS_DIR) {
  ensureMigrationsTable(db);
  const available = listMigrations(dir);
  const applied = appliedMigrations(db);
  const byVersion = new Map(available.map((m) => [m.version, m]));

  for (const row of applied) {
    const file = byVersion.get(row.version);
    if (!file) {
      throw new Error(
        `The database has migration ${row.version} (${row.name}) applied, but this version of the application does not include it. ` +
          'The application is older than the database. Deploy the matching version; do not run this one.'
      );
    }
    if (file.checksum !== row.checksum) {
      throw new Error(
        `Migration ${file.file} was changed after it was applied. Applied migrations must never be edited; add a new migration instead.`
      );
    }
  }

  const highestApplied = applied.length ? applied[applied.length - 1].version : 0;
  const appliedVersions = new Set(applied.map((row) => row.version));
  const pending = available.filter((m) => !appliedVersions.has(m.version));
  const outOfOrder = pending.filter((m) => m.version < highestApplied);
  if (outOfOrder.length) {
    throw new Error(
      `Migration ${outOfOrder[0].file} is numbered below an already-applied migration (${highestApplied}). Renumber it so it runs last.`
    );
  }
  return { available, applied, pending };
}

function assertNoRowLoss(migration, before, after) {
  const problems = [];
  for (const [table, count] of Object.entries(before)) {
    if (table === 'schema_migrations') continue;
    if (!(table in after)) problems.push(`table ${table} was dropped (${count} rows)`);
    else if (after[table] < count) problems.push(`table ${table} went from ${count} to ${after[table]} rows`);
  }
  if (problems.length) {
    throw new Error(`Migration ${migration.file} would lose data and was rolled back: ${problems.join('; ')}`);
  }
}

function applyOne(db, migration) {
  const { up, foreignKeysOff, allowRowLoss } = loadMigration(migration);
  const before = tableCounts(db);

  // PRAGMA foreign_keys cannot change inside a transaction, so it is switched
  // here, around the transaction, and always switched back on.
  if (foreignKeysOff) db.pragma('foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      up(db);
      const after = tableCounts(db);
      if (!allowRowLoss) assertNoRowLoss(migration, before, after);
      if (foreignKeysOff) {
        const violations = db.pragma('foreign_key_check');
        if (violations.length) {
          throw new Error(
            `Migration ${migration.file} left ${violations.length} foreign key violation(s) and was rolled back`
          );
        }
      }
      db.prepare('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        migration.checksum
      );
      db.exec('COMMIT');
      return { before, after };
    } catch (err) {
      if (db.inTransaction) db.exec('ROLLBACK');
      throw err;
    }
  } finally {
    if (foreignKeysOff) db.pragma('foreign_keys = ON');
  }
}

/**
 * Apply every pending migration.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [options]
 * @param {string} [options.dir]            migrations directory
 * @param {(reason: string) => Promise<string|void>} [options.backup]
 *        called once before the first pending migration when the database already has data
 * @param {{info: Function, warn: Function}} [options.logger]
 * @returns {Promise<{applied: string[], countsBefore: object, countsAfter: object, backupPath?: string}>}
 */
async function migrate(db, { dir = MIGRATIONS_DIR, backup, logger = console } = {}) {
  const { pending } = migrationStatus(db, dir);
  const countsBefore = tableCounts(db);
  if (!pending.length) return { applied: [], countsBefore, countsAfter: countsBefore };

  const hasExistingData = Object.keys(countsBefore).some((table) => table !== 'schema_migrations');
  let backupPath;
  if (hasExistingData && typeof backup === 'function') {
    backupPath = await backup(`pre-migration-${String(pending[0].version).padStart(4, '0')}`);
    logger.info(`Database backed up before migrating: ${backupPath}`);
  }

  const applied = [];
  for (const migration of pending) {
    applyOne(db, migration);
    applied.push(migration.file);
    logger.info(`Applied migration ${migration.file}`);
  }
  return { applied, countsBefore, countsAfter: tableCounts(db), backupPath };
}

module.exports = { migrate, migrationStatus, listMigrations, MIGRATIONS_DIR };
