'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { openDatabase, checkIntegrity, tableCounts } = require('../../src/db/connection');
const { makeTempDir } = require('../helpers/tmp');

describe('openDatabase', () => {
  it('enables foreign keys and a 5 second busy timeout on an in-memory database', () => {
    const db = openDatabase(':memory:');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'memory');
    db.close();
  });

  it('uses WAL, FULL synchronous writes, foreign keys and busy timeout for a file database', (t) => {
    const dir = makeTempDir(t);
    const db = openDatabase(path.join(dir, 'crm.db'));
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
    assert.equal(db.pragma('synchronous', { simple: true }), 2, 'FULL');
    db.close();
  });

  it('creates missing parent directories for a new database file', (t) => {
    const dir = makeTempDir(t);
    const file = path.join(dir, 'nested', 'deeper', 'crm.db');
    const db = openDatabase(file);
    db.close();
    assert.ok(fs.existsSync(file));
  });

  it('enforces foreign keys', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE P (id INTEGER PRIMARY KEY); CREATE TABLE C (p INTEGER REFERENCES P(id));');
    assert.throws(() => db.prepare('INSERT INTO C (p) VALUES (1)').run(), /FOREIGN KEY constraint failed/);
    db.close();
  });

  it('refuses to create a file when fileMustExist is set', (t) => {
    const dir = makeTempDir(t);
    assert.throws(() => openDatabase(path.join(dir, 'missing.db'), { fileMustExist: true }));
  });

  it('opens an existing file read-only with foreign keys still on', (t) => {
    const dir = makeTempDir(t);
    const file = path.join(dir, 'crm.db');
    const writer = openDatabase(file);
    writer.exec('CREATE TABLE T (id INTEGER)');
    writer.close();

    const reader = openDatabase(file, { readonly: true });
    assert.equal(reader.readonly, true);
    assert.equal(reader.pragma('foreign_keys', { simple: true }), 1);
    assert.throws(() => reader.exec('INSERT INTO T VALUES (1)'), /readonly/i);
    reader.close();
  });
});

describe('checkIntegrity', () => {
  it('reports ok for a healthy database', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE T (id INTEGER PRIMARY KEY)');
    const result = checkIntegrity(db);
    assert.deepEqual(result, { ok: true, integrity: ['ok'], foreignKeyViolations: [] });
    db.close();
  });

  it('reports foreign key violations', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE P (id INTEGER PRIMARY KEY); CREATE TABLE C (p INTEGER REFERENCES P(id));');
    db.pragma('foreign_keys = OFF');
    db.exec('INSERT INTO C (p) VALUES (42)');
    db.pragma('foreign_keys = ON');
    const result = checkIntegrity(db);
    assert.equal(result.ok, false);
    assert.deepEqual(result.integrity, ['ok']);
    assert.equal(result.foreignKeyViolations.length, 1);
    assert.equal(result.foreignKeyViolations[0].table, 'C');
    db.close();
  });
});

describe('tableCounts', () => {
  it('returns the row count of every user table', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE Alpha (id INTEGER PRIMARY KEY AUTOINCREMENT);
      CREATE TABLE "Odd ""Name""" (id INTEGER);
      INSERT INTO Alpha DEFAULT VALUES;
      INSERT INTO Alpha DEFAULT VALUES;
    `);
    // sqlite_sequence (created by AUTOINCREMENT) is internal and left out.
    assert.deepEqual(tableCounts(db), { Alpha: 2, 'Odd "Name"': 0 });
    db.close();
  });

  it('returns an empty object for an empty database', () => {
    const db = openDatabase(':memory:');
    assert.deepEqual(tableCounts(db), {});
    db.close();
  });
});
