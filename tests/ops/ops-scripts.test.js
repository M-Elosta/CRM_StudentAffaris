'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildAlert, alertCommandArgs } = require('../../scripts/ops/alert');
const { splitCommand } = require('../../scripts/ops/lib/common');
const { loadOpsConfig } = require('../../src/config/ops');
const { openDatabase } = require('../../src/db/connection');
const { makeTempDir } = require('../helpers/tmp');

const ROOT = path.resolve(__dirname, '..', '..');

describe('operations configuration', () => {
  it('has the documented defaults and validates the off-server settings', () => {
    const ops = loadOpsConfig({ NODE_ENV: 'development' });
    assert.equal(ops.keepDaily, 7);
    assert.equal(ops.keepWeekly, 4);
    assert.equal(ops.keepMonthly, 12);
    assert.equal(ops.keepPreChangeDays, 30);
    assert.equal(ops.monitor.minFreeMb, 1024);
    assert.equal(ops.monitor.maxBackupAgeHours, 26);
    assert.equal(ops.monitor.minCertDays, 21);
    assert.equal(ops.requireEncryption, false);
    assert.equal(loadOpsConfig({ NODE_ENV: 'staging' }).requireEncryption, true);
    assert.throws(
      () => loadOpsConfig({ NODE_ENV: 'production', BACKUP_REMOTE_DIR: '/a', BACKUP_REMOTE_COMMAND: 'cp {file} /b' }),
      /either BACKUP_REMOTE_DIR or BACKUP_REMOTE_COMMAND/
    );
    assert.throws(() => loadOpsConfig({ BACKUP_REMOTE_COMMAND: 'cp x /b' }), /must contain \{file\}/);
  });
});

describe('alerts', () => {
  it('contain the unit, host and runbook section and no log lines', () => {
    const alert = buildAlert('ero-crm-backup.service', { host: 'h1', now: new Date('2026-01-01T00:00:00Z') });
    assert.equal(alert.subject, '[ero-crm] FAILED: ero-crm-backup.service on h1');
    assert.match(alert.body, /A backup failed or is stale/);
    assert.match(alert.body, /journalctl -u ero-crm-backup.service/);
  });

  it('pass subject and body as separate arguments, never through a shell', () => {
    const alert = { subject: 'S; rm -rf /', body: 'B $(id)' };
    assert.deepEqual(alertCommandArgs('mail -s {subject} ops@example.edu', alert), [
      'mail',
      '-s',
      'S; rm -rf /',
      'ops@example.edu',
    ]);
    assert.deepEqual(alertCommandArgs('/usr/local/bin/notify --to "IT team"', alert), [
      '/usr/local/bin/notify',
      '--to',
      'IT team',
      'S; rm -rf /',
      'B $(id)',
    ]);
    assert.throws(() => splitCommand('a "b'), /Unclosed/);
  });

  it('alert.js writes to stderr and runs ALERT_COMMAND', (t) => {
    const dir = makeTempDir(t);
    const out = path.join(dir, 'args.json');
    const script = path.join(dir, 'record.js');
    fs.writeFileSync(
      script,
      `require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)))`
    );
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/ops/alert.js'), 'ero-crm-integrity.service'], {
      env: { PATH: process.env.PATH, NODE_ENV: 'development', ALERT_COMMAND: `${process.execPath} ${script}` },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /ALERT \[ero-crm\] FAILED: ero-crm-integrity.service/);
    const args = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(args.length, 2);
    assert.match(args[0], /^\[ero-crm\] FAILED/);
  });
});

describe('integrity-check.js', () => {
  it('records ok for a healthy database and fails for a broken one', (t) => {
    const dir = makeTempDir(t);
    const dbPath = path.join(dir, 'data', 'employer.db');
    const db = openDatabase(dbPath);
    db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (p INTEGER REFERENCES parent(id));');
    db.close();
    const env = {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      DATABASE_PATH: dbPath,
      BACKUP_DIR: path.join(dir, 'backups'),
      SESSION_SECRET: 's'.repeat(40),
    };
    const script = path.join(ROOT, 'scripts/ops/integrity-check.js');
    const good = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
    assert.equal(good.status, 0, good.stderr);
    const record = () => JSON.parse(fs.readFileSync(path.join(dir, 'backups', 'last-integrity.json'), 'utf8'));
    assert.equal(record().ok, true);

    const broken = openDatabase(dbPath);
    broken.pragma('foreign_keys = OFF');
    broken.exec('INSERT INTO child (p) VALUES (42)');
    broken.close();
    const bad = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /Integrity check FAILED/);
    assert.equal(record().ok, false);
  });
});
