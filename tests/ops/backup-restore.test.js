'use strict';

/**
 * Backup and restore drill: runs the real scripts/backup.js and
 * scripts/restore.js as child processes against a file database in a
 * temporary directory, the way the systemd units and an operator run them.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { openDatabase, tableCounts } = require('../../src/db/connection');
const { migrate } = require('../../src/db/migrate');
const { createKeyFile } = require('../../src/db/backup-crypto');
const { makeTempDir } = require('../helpers/tmp');
const { createSilentLogger } = require('../helpers/app');

const ROOT = path.resolve(__dirname, '..', '..');
const BACKUP = path.join(ROOT, 'scripts', 'backup.js');
const RESTORE = path.join(ROOT, 'scripts', 'restore.js');
const ARABIC = 'شركة قطر للطاقة المتجددة';

async function makeWorld(t) {
  const dir = makeTempDir(t);
  const world = {
    dir,
    db: path.join(dir, 'data', 'employer.db'),
    backups: path.join(dir, 'backups'),
    remote: path.join(dir, 'remote'),
    key: path.join(dir, 'etc', 'backup.key'),
  };
  fs.mkdirSync(world.remote);
  createKeyFile(world.key);
  const db = openDatabase(world.db);
  await migrate(db, { logger: createSilentLogger() });
  db.exec(`
    INSERT INTO Company (CompanyName, Industry, Sector, Country) VALUES
      ('Drill Energy', 'Energy', 'Private', 'Qatar'),
      ('${ARABIC}', 'Energy', 'Government', 'قطر');
    INSERT INTO Contact (CompanyID, FirstName, LastName, EmailAddress) VALUES (2, 'مريم', 'الكعبي', 'm@example.com');
  `);
  db.close();
  return world;
}

function env(world, extra = {}) {
  return {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    PORT: '1', // nothing listens there: restore's "is the app running?" check sees it stopped
    DATABASE_PATH: world.db,
    BACKUP_DIR: world.backups,
    BACKUP_KEY_FILE: world.key,
    BACKUP_REMOTE_DIR: world.remote,
    BACKUP_REMOTE_COMMAND: '',
    SESSION_SECRET: 'a'.repeat(40),
    ...extra,
  };
}

function run(script, args, environment) {
  return spawnSync(process.execPath, [script, ...args], { env: environment, encoding: 'utf8', cwd: ROOT });
}

function companies(file) {
  const db = new Database(file, { readonly: true });
  try {
    return db.prepare('SELECT CompanyID, CompanyName, Country FROM Company ORDER BY CompanyID').all();
  } finally {
    db.close();
  }
}

function counts(file) {
  const db = new Database(file, { readonly: true });
  try {
    return tableCounts(db);
  } finally {
    db.close();
  }
}

describe('backup and restore drill (real scripts)', () => {
  it('backs up encrypted to both places, restores to a new path and in place', async (t) => {
    const world = await makeWorld(t);
    const original = { counts: counts(world.db), companies: companies(world.db) };

    const backup = run(BACKUP, ['drill'], env(world));
    assert.equal(backup.status, 0, backup.stderr);

    const local = fs.readdirSync(world.backups).filter((n) => n.startsWith('employer-'));
    assert.equal(local.length, 1);
    assert.match(local[0], /^employer-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-drill\.db\.enc$/);
    assert.deepEqual(fs.readdirSync(world.remote), local);
    assert.ok(
      fs.readFileSync(path.join(world.remote, local[0])).equals(fs.readFileSync(path.join(world.backups, local[0])))
    );
    assert.ok(!fs.readdirSync(world.backups).some((n) => /\.db$/.test(n)), 'no plain copy remains');
    assert.ok(!fs.readFileSync(path.join(world.backups, local[0])).includes(Buffer.from(ARABIC)), 'file is encrypted');

    const record = JSON.parse(fs.readFileSync(path.join(world.backups, 'last-success.json'), 'utf8'));
    assert.equal(record.file, path.join(world.backups, local[0]));
    assert.equal(record.bytes, fs.statSync(record.file).size);
    assert.match(record.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(record.tableCounts, original.counts);
    assert.equal(record.remote.mode, 'dir');
    assert.ok(Date.now() - Date.parse(record.finishedAt) < 60_000);

    // Drill: restore to a separate path; the live database is not touched.
    const liveBefore = fs.readFileSync(world.db);
    const drill = path.join(world.dir, 'drill', 'restored.db');
    const toPath = run(RESTORE, [record.file, '--to', drill, '--yes'], env(world));
    assert.equal(toPath.status, 0, toPath.stderr);
    assert.match(toPath.stdout, /Integrity:\s+ok/);
    assert.match(toPath.stdout, /Migration:\s+version \d+/);
    assert.deepEqual(counts(drill), original.counts);
    assert.deepEqual(companies(drill), original.companies);
    assert.ok(fs.readFileSync(world.db).equals(liveBefore));
    assert.deepEqual(fs.readdirSync(path.dirname(drill)), ['restored.db']);

    // In place: change the live data, then restore; the changed database is kept aside.
    const db = new Database(world.db);
    db.prepare('DELETE FROM Contact').run();
    db.close();
    const inPlace = run(RESTORE, [record.file, '--yes'], env(world));
    assert.equal(inPlace.status, 0, inPlace.stderr);
    assert.deepEqual(counts(world.db), original.counts);
    assert.deepEqual(companies(world.db), original.companies);
    const aside = fs.readdirSync(path.dirname(world.db)).filter((n) => n.startsWith('employer.db.pre-restore-'));
    assert.equal(aside.length, 1);
    assert.equal(counts(path.join(path.dirname(world.db), aside[0])).Contact, 0);
  });

  it('refuses to restore without --yes when not in a terminal', async (t) => {
    const world = await makeWorld(t);
    assert.equal(run(BACKUP, [], env(world)).status, 0);
    const file = JSON.parse(fs.readFileSync(path.join(world.backups, 'last-success.json'), 'utf8')).file;
    const before = fs.readFileSync(world.db);
    const result = run(RESTORE, [file], env(world));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pass --yes/);
    assert.ok(fs.readFileSync(world.db).equals(before));
    assert.deepEqual(
      fs.readdirSync(path.dirname(world.db)).filter((n) => n.includes('restore')),
      []
    );
  });

  it('encrypts plain pre-migration backups left by the application and deletes the plain copies', async (t) => {
    const world = await makeWorld(t);
    fs.mkdirSync(world.backups);
    const plain = path.join(world.backups, 'employer-2026-11-01T10-00-00Z-pre-migration-0004.db');
    const db = new Database(world.db);
    await db.backup(plain);
    db.close();
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(plain, old, old);

    const result = run(BACKUP, [], env(world));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(plain), false);
    assert.ok(fs.existsSync(`${plain}.enc`));
    assert.ok(fs.existsSync(path.join(world.remote, `${path.basename(plain)}.enc`)));
  });

  it('in production, refuses to back up without BACKUP_KEY_FILE and writes nothing', async (t) => {
    const world = await makeWorld(t);
    const result = run(BACKUP, [], env(world, { BACKUP_KEY_FILE: '' }));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /BACKUP_KEY_FILE is not set/);
    assert.equal(fs.existsSync(world.backups), false);
    assert.deepEqual(fs.readdirSync(world.remote), []);
  });

  it('fails with a clear message when the off-server directory is not available', async (t) => {
    const world = await makeWorld(t);
    const missing = path.join(world.dir, 'share-not-mounted');
    const result = run(BACKUP, [], env(world, { BACKUP_REMOTE_DIR: missing }));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /off-server backup directory .* is not available/);
    assert.match(result.stderr, /NOT yet protected against the loss of this server/);
    assert.equal(fs.existsSync(missing), false, 'a missing share is never created');
    assert.equal(fs.existsSync(path.join(world.backups, 'last-success.json')), false);
    const left = fs.readdirSync(world.backups);
    assert.ok(!left.some((n) => /\.db$|partial/.test(n)), `no plain or partial files: ${left}`);
  });

  it('fails when BACKUP_REMOTE_COMMAND exits non-zero, and runs it without a shell', async (t) => {
    const world = await makeWorld(t);
    const marker = path.join(world.dir, 'ran');
    const failing = run(
      BACKUP,
      [],
      env(world, { BACKUP_REMOTE_DIR: '', BACKUP_REMOTE_COMMAND: `${process.execPath} -e process.exit(3) {file}` })
    );
    assert.notEqual(failing.status, 0);
    assert.match(failing.stderr, /off-server copy command failed .*exit status 3/);

    const script = path.join(world.dir, 'copy.js');
    fs.writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(marker)}, process.argv[2]);`);
    const ok = run(
      BACKUP,
      [],
      env(world, { BACKUP_REMOTE_DIR: '', BACKUP_REMOTE_COMMAND: `${process.execPath} ${script} {file};touch` })
    );
    assert.equal(ok.status, 0, ok.stderr);
    // ";touch" reached the program as part of its argument: no shell interpreted it.
    assert.match(fs.readFileSync(marker, 'utf8'), /\.db\.enc;touch$/);
  });

  it('a restore with the wrong key fails and changes nothing', async (t) => {
    const world = await makeWorld(t);
    assert.equal(run(BACKUP, [], env(world)).status, 0);
    const file = JSON.parse(fs.readFileSync(path.join(world.backups, 'last-success.json'), 'utf8')).file;
    const otherKey = createKeyFile(path.join(world.dir, 'other.key')).path;
    const target = path.join(world.dir, 'drill', 'x.db');
    const result = run(RESTORE, [file, '--to', target, '--yes'], env(world, { BACKUP_KEY_FILE: otherKey }));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /different key/);
    assert.deepEqual(fs.readdirSync(path.dirname(target)), []);
  });
});
