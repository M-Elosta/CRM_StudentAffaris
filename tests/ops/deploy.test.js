'use strict';

/**
 * End-to-end tests of deploy/install.sh and deploy/deploy.sh in a prefix
 * sandbox. A stand-in service manager (fixtures/fake-systemctl.sh, passed as
 * ERO_SYSTEMCTL) really starts and stops `node src/server.js` of the current
 * release, so health checks, backups, migrations and rollbacks run for real.
 * node_modules is linked into each release instead of running npm ci.
 *
 * About 30-40 s in total. Set SKIP_OPS_E2E=1 to skip them.
 */

const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { tableCounts } = require('../../src/db/connection');
const { makeTempDir } = require('../helpers/tmp');

const ROOT = path.resolve(__dirname, '..', '..');
const FAKE_SYSTEMCTL = path.join(__dirname, 'fixtures', 'fake-systemctl.sh');
const RELEASE_CONTENT = ['package.json', 'package-lock.json', 'src', 'scripts', 'deploy'];
const SKIP = process.env.SKIP_OPS_E2E === '1';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function health(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function shellScripts() {
  const found = [];
  for (const dir of [path.join(ROOT, 'deploy'), path.join(__dirname, 'fixtures')]) {
    for (const name of fs.readdirSync(dir)) if (name.endsWith('.sh')) found.push(path.join(dir, name));
  }
  return found;
}

describe('shell scripts', () => {
  it('all pass bash -n', () => {
    const scripts = shellScripts();
    assert.ok(scripts.length >= 4);
    for (const script of scripts) {
      const result = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
      assert.equal(result.status, 0, `${script}: ${result.stderr}`);
    }
  });
});

describe('install and deploy in a prefix sandbox', { skip: SKIP && 'SKIP_OPS_E2E=1' }, () => {
  let dir;
  let prefix;
  let port;
  let env;
  const tarballs = {};

  const paths = () => ({
    current: path.join(prefix, 'opt', 'ero-crm', 'current'),
    db: path.join(prefix, 'var', 'lib', 'ero-crm', 'employer.db'),
    envFile: path.join(prefix, 'etc', 'ero-crm', 'ero-crm.env'),
  });

  function run(script, args = []) {
    return spawnSync('bash', [path.join(ROOT, 'deploy', script), ...args], { env, encoding: 'utf8', timeout: 120_000 });
  }

  /** Build a release tarball from the working tree, optionally changing files first. */
  function makeRelease(name, changes = {}) {
    const top = path.join(dir, 'build', name, `ero-crm-${name}`);
    for (const entry of RELEASE_CONTENT) fs.cpSync(path.join(ROOT, entry), path.join(top, entry), { recursive: true });
    const pkg = JSON.parse(fs.readFileSync(path.join(top, 'package.json'), 'utf8'));
    fs.writeFileSync(path.join(top, 'package.json'), JSON.stringify({ ...pkg, version: name }, null, 2));
    for (const [file, content] of Object.entries(changes)) fs.writeFileSync(path.join(top, file), content);
    const tarball = path.join(dir, `${name}.tar.gz`);
    const result = spawnSync('tar', ['-czf', tarball, '-C', path.dirname(top), path.basename(top)]);
    assert.equal(result.status, 0, String(result.stderr));
    return tarball;
  }

  function dbState() {
    const db = new Database(paths().db, { readonly: true });
    try {
      return tableCounts(db);
    } finally {
      db.close();
    }
  }

  before(async () => {
    dir = makeTempDir();
    prefix = path.join(dir, 'root');
    fs.mkdirSync(path.join(prefix, 'etc', 'nginx', 'conf.d'), { recursive: true });
    fs.writeFileSync(
      path.join(prefix, 'etc', 'os-release'),
      'NAME="Rocky Linux"\nID="rocky"\nID_LIKE="rhel centos fedora"\n'
    );
    port = await freePort();
    env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME || dir,
      ERO_PREFIX: prefix,
      ERO_SYSTEMCTL: FAKE_SYSTEMCTL,
      ERO_NODE: process.execPath,
      ERO_AS_SERVICE_USER: '',
      ERO_TEST_NODE_MODULES: path.join(ROOT, 'node_modules'),
      ERO_HEALTH_TIMEOUT: '8',
      ERO_MIN_FREE_MB: '10',
    };
    tarballs.v1 = makeRelease('1.0.0');
    tarballs.v2 = makeRelease('1.1.0');
    const crash = "'use strict';\nconsole.error('This release cannot start.');\nprocess.exit(1);\n";
    tarballs.crash = makeRelease('1.2.0', { 'src/server.js': crash });
    tarballs.migrateThenCrash = makeRelease('1.3.0', {
      'src/server.js': crash,
      'src/db/migrations/0099_ops_deploy_test.sql':
        'CREATE TABLE OpsDeployTest (id INTEGER PRIMARY KEY);\nINSERT INTO OpsDeployTest (id) VALUES (1);\n',
    });
  });

  after(() => {
    if (!prefix) return;
    spawnSync('bash', [FAKE_SYSTEMCTL, 'stop', 'ero-crm.service'], { env });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('install.sh --dry-run changes nothing', () => {
    const result = run('install.sh', ['--dry-run']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Dry run: \d+ change\(s\) listed above; nothing was changed/);
    assert.deepEqual(fs.readdirSync(prefix).sort(), ['etc']);
    assert.deepEqual(fs.readdirSync(path.join(prefix, 'etc')).sort(), ['nginx', 'os-release']);
  });

  it('install.sh prepares the sandbox and a second run changes nothing', () => {
    const first = run('install.sh');
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.match(first.stdout, /RHEL|rhel/);
    assert.match(first.stdout, /One-time password for the first administrator/);
    const envText = fs.readFileSync(paths().envFile, 'utf8');
    const secret = /^SESSION_SECRET=(.+)$/m.exec(envText)[1];
    assert.ok(secret.length >= 48);
    assert.ok(!first.stdout.includes(secret), 'the session secret is never printed');
    assert.equal(fs.statSync(paths().envFile).mode & 0o777, 0o640);
    assert.equal(fs.statSync(path.join(prefix, 'etc', 'ero-crm', 'backup.key')).mode & 0o777, 0o640);
    assert.ok(fs.existsSync(path.join(prefix, 'etc', 'nginx', 'conf.d', 'ero-crm.conf.disabled')));
    assert.ok(fs.existsSync(path.join(prefix, 'etc', 'systemd', 'system', 'ero-crm.service')));
    assert.ok(fs.existsSync(path.join(prefix, 'etc', 'sudoers.d', 'ero-crm-deploy')));

    const second = run('install.sh');
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.match(second.stdout, /Nothing to change: this server is already prepared/);
    assert.doesNotMatch(second.stdout, /One-time password/);
    assert.equal(fs.readFileSync(paths().envFile, 'utf8'), envText);

    fs.writeFileSync(paths().envFile, envText.replace(/^PORT=.*$/m, `PORT=${port}`));
  });

  it('first installation through deploy.sh ends healthy', async () => {
    const result = run('deploy.sh', [tarballs.v1]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /DEPLOY SUCCEEDED/);
    assert.match(fs.readlinkSync(paths().current), /releases\/1\.0\.0-/);
    assert.equal(await health(port), 200);
  });

  it('an update switches the symlink and ends healthy, with a pre-deploy backup', async () => {
    const db = new Database(paths().db);
    db.prepare(
      "INSERT INTO Company (CompanyName, Industry, Sector, Country) VALUES ('شركة الاختبار', 'Energy', 'Private', 'قطر')"
    ).run();
    db.close();
    const result = run('deploy.sh', [tarballs.v2]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(fs.readlinkSync(paths().current), /releases\/1\.1\.0-/);
    assert.equal(await health(port), 200);
    const backups = fs.readdirSync(path.join(prefix, 'var', 'backups', 'ero-crm'));
    assert.ok(
      backups.some((n) => /-pre-deploy\.db\.enc$/.test(n)),
      backups.join(', ')
    );
  });

  it('a release that cannot start is rolled back and the previous release answers again', async () => {
    const before = fs.readlinkSync(paths().current);
    const result = run('deploy.sh', [tarballs.crash]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /did not answer \/healthz/);
    assert.match(result.stdout, /rolled back\. The previous version is running again/);
    assert.equal(fs.readlinkSync(paths().current), before);
    assert.equal(await health(port), 200);
  });

  it('a release whose migration applied but which fails health gets the database restored', async () => {
    const before = fs.readlinkSync(paths().current);
    const counts = dbState();
    const result = run('deploy.sh', [tarballs.migrateThenCrash]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Restoring the pre-deploy backup/);
    assert.match(result.stdout, /rolled back\. The previous version is running again/);
    assert.equal(fs.readlinkSync(paths().current), before);
    assert.equal(await health(port), 200);
    const after = dbState();
    assert.equal(after.OpsDeployTest, undefined, 'the extra table is gone');
    for (const [table, count] of Object.entries(counts)) {
      if (table !== 'Sessions' && table !== 'AuditLog') assert.equal(after[table], count, table);
    }
    const kept = fs
      .readdirSync(path.dirname(paths().db))
      .filter((n) => /^employer\.db\.pre-restore-[0-9TZ-]+Z$/.test(n));
    assert.equal(kept.length, 1, 'the failed database is kept aside');
  });
});
