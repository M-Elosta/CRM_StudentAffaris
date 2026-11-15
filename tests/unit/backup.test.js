'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { openDatabase, tableCounts } = require('../../src/db/connection');
const { migrate } = require('../../src/db/migrate');
const { backupDatabase, pruneBackups } = require('../../src/db/backup');
const { makeTempDir } = require('../helpers/tmp');
const { createSilentLogger } = require('../helpers/app');

async function liveDatabase(dir) {
  const db = openDatabase(path.join(dir, 'live', 'crm.db'));
  await migrate(db, { logger: createSilentLogger() });
  db.exec(`
    INSERT INTO Company (CompanyName, Industry, Sector, Country) VALUES
      ('Backup Co', 'Energy', 'Private', 'Qatar'),
      ('شركة النسخ الاحتياطي', 'Banking', 'Government', 'قطر');
    INSERT INTO Contact (CompanyID, FirstName, LastName, EmailAddress) VALUES (1, 'B', 'C', 'b@example.com');
  `);
  return db;
}

describe('backupDatabase', () => {
  it('writes exactly one self-contained file with no -wal or -shm beside it', async (t) => {
    const dir = makeTempDir(t);
    const db = await liveDatabase(dir);
    const backupDir = path.join(dir, 'backups');
    const result = await backupDatabase(db, backupDir, 'manual');
    db.close();

    const files = fs.readdirSync(backupDir);
    assert.equal(files.length, 1, `unexpected files: ${files.join(', ')}`);
    assert.equal(path.join(backupDir, files[0]), result.path);
    assert.match(files[0], /^employer-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-manual\.db$/);
    assert.equal(result.bytes, fs.statSync(result.path).size);
  });

  it('produces a copy with the same row counts as the live database', async (t) => {
    const dir = makeTempDir(t);
    const db = await liveDatabase(dir);
    const expected = tableCounts(db);
    const result = await backupDatabase(db, path.join(dir, 'backups'));
    db.close();

    assert.deepEqual(result.counts, expected);
    const copy = new Database(result.path, { readonly: true, fileMustExist: true });
    try {
      assert.deepEqual(tableCounts(copy), expected);
      assert.equal(copy.pragma('journal_mode', { simple: true }), 'delete');
      assert.equal(
        copy.prepare('SELECT CompanyName FROM Company WHERE CompanyID = 2').get().CompanyName,
        'شركة النسخ الاحتياطي'
      );
      assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 2);
    } finally {
      copy.close();
    }
  });

  it('makes the backup readable only by its owner and group', { skip: process.platform === 'win32' }, async (t) => {
    const dir = makeTempDir(t);
    const db = await liveDatabase(dir);
    const result = await backupDatabase(db, path.join(dir, 'backups'));
    db.close();
    assert.equal(fs.statSync(result.path).mode & 0o777, 0o640);
  });

  it('sanitises the label used in the file name', async (t) => {
    const dir = makeTempDir(t);
    const db = await liveDatabase(dir);
    const result = await backupDatabase(db, path.join(dir, 'backups'), '../../etc/passwd');
    db.close();
    assert.equal(path.dirname(result.path), path.join(dir, 'backups'));
    assert.match(path.basename(result.path), /-------etc-passwd\.db$/);
  });

  it('refuses to back up an in-memory database', async (t) => {
    const dir = makeTempDir(t);
    const db = openDatabase(':memory:');
    await assert.rejects(backupDatabase(db, path.join(dir, 'backups')), /in-memory database cannot be backed up/);
    db.close();
    assert.ok(!fs.existsSync(path.join(dir, 'backups')));
  });
});

describe('pruneBackups', () => {
  function touchBackups(dir, names) {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of names) fs.writeFileSync(path.join(dir, name), '');
  }

  const NAMES = [
    'employer-2025-01-01T00-00-00Z-manual.db',
    'employer-2025-02-01T00-00-00Z-manual.db',
    'employer-2025-03-01T00-00-00Z-pre-migration-0003.db',
    'employer-2025-04-01T00-00-00Z-manual.db',
    'employer-2025-05-01T00-00-00Z-nightly.db',
  ];

  it('keeps the newest N backups and deletes the rest', (t) => {
    const dir = makeTempDir(t);
    touchBackups(dir, NAMES);
    const removed = pruneBackups(dir, 2);
    assert.deepEqual(removed, NAMES.slice(0, 3));
    assert.deepEqual(fs.readdirSync(dir).sort(), NAMES.slice(3));
  });

  it('leaves files that are not backups alone', (t) => {
    const dir = makeTempDir(t);
    touchBackups(dir, [...NAMES, 'README.txt', 'other.db', 'employer-2020-01-01T00-00-00Z-x.db-wal']);
    pruneBackups(dir, 1);
    assert.deepEqual(
      fs.readdirSync(dir).sort(),
      ['README.txt', 'employer-2020-01-01T00-00-00Z-x.db-wal', NAMES[4], 'other.db'].sort()
    );
  });

  it('deletes nothing when there are no more than N backups', (t) => {
    const dir = makeTempDir(t);
    touchBackups(dir, NAMES.slice(0, 2));
    assert.deepEqual(pruneBackups(dir, 5), []);
    assert.equal(fs.readdirSync(dir).length, 2);
  });

  it('returns an empty list when the directory does not exist', (t) => {
    const dir = makeTempDir(t);
    assert.deepEqual(pruneBackups(path.join(dir, 'missing'), 3), []);
  });

  it('prunes real backups taken one after another', async (t) => {
    const dir = makeTempDir(t);
    const db = await liveDatabase(dir);
    const backupDir = path.join(dir, 'backups');
    // Backups made within one second share a timestamp; distinct labels keep them apart.
    for (const label of ['a', 'b', 'c']) await backupDatabase(db, backupDir, label);
    db.close();
    assert.equal(fs.readdirSync(backupDir).length, 3);
    pruneBackups(backupDir, 1);
    assert.equal(fs.readdirSync(backupDir).length, 1);
  });
});
