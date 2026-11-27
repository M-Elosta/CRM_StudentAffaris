'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');

const { loadConfig } = require('../../src/config');
const { openDatabase } = require('../../src/db/connection');
const { migrate } = require('../../src/db/migrate');
const { bootstrapAdmin } = require('../../src/services/bootstrap-admin');
const { createSilentLogger } = require('../helpers/app');

const SECRET = 'p'.repeat(40);
const PASSWORD = 'bootstrap-secret-password';

function productionConfig(extra = {}) {
  return loadConfig({
    NODE_ENV: 'production',
    DATABASE_PATH: ':memory:',
    BACKUP_DIR: '/tmp/unused-backups',
    SESSION_SECRET: SECRET,
    ...extra,
  });
}

function allLogText(logger) {
  return Object.values(logger.entries)
    .flat(2)
    .map((value) => String(value))
    .join('\n');
}

describe('bootstrapAdmin', () => {
  let db;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    await migrate(db, { logger: createSilentLogger() });
  });

  afterEach(() => db.close());

  const users = () => db.prepare('SELECT Username, PasswordHash, Role, MustChangePassword FROM Users').all();

  it('creates an admin with the configured credentials when no users exist', async () => {
    const config = loadConfig({ BOOTSTRAP_ADMIN_USERNAME: 'first-admin', BOOTSTRAP_ADMIN_PASSWORD: PASSWORD });
    const result = await bootstrapAdmin(db, config, createSilentLogger());
    assert.deepEqual(result, { created: true, username: 'first-admin' });
    const [user] = users();
    assert.equal(user.Username, 'first-admin');
    assert.equal(user.Role, 'admin');
    assert.equal(user.MustChangePassword, 0);
    assert.ok(await bcrypt.compare(PASSWORD, user.PasswordHash));
  });

  it('does nothing when a user already exists', async () => {
    db.prepare("INSERT INTO Users (Username, PasswordHash, Role) VALUES ('someone', 'hash', 'viewer')").run();
    const config = loadConfig({ BOOTSTRAP_ADMIN_PASSWORD: PASSWORD });
    const result = await bootstrapAdmin(db, config, createSilentLogger());
    assert.deepEqual(result, { created: false });
    assert.deepEqual(
      users().map((user) => user.Username),
      ['someone']
    );
  });

  it('is idempotent', async () => {
    const config = loadConfig({ BOOTSTRAP_ADMIN_PASSWORD: PASSWORD });
    await bootstrapAdmin(db, config, createSilentLogger());
    const second = await bootstrapAdmin(db, config, createSilentLogger());
    assert.equal(second.created, false);
    assert.equal(users().length, 1);
  });

  it('generates a random password in development and logs it once', async () => {
    const logger = createSilentLogger();
    const config = loadConfig({ NODE_ENV: 'development' });
    await bootstrapAdmin(db, config, logger);
    const [user] = users();
    assert.equal(user.Username, 'admin');
    const logged = allLogText(logger);
    const match = logged.match(/password: (\S+)/);
    assert.ok(match, 'the generated password is shown to the developer');
    assert.ok(await bcrypt.compare(match[1], user.PasswordHash));
  });

  for (const envName of ['production', 'staging']) {
    it(`refuses to create an admin in ${envName} without a configured password`, async () => {
      const config = productionConfig({ NODE_ENV: envName });
      await assert.rejects(bootstrapAdmin(db, config, createSilentLogger()), /BOOTSTRAP_ADMIN_PASSWORD must be set/);
      assert.equal(users().length, 0);
    });

    it(`does not log the password in ${envName}`, async () => {
      const logger = createSilentLogger();
      const config = productionConfig({ NODE_ENV: envName, BOOTSTRAP_ADMIN_PASSWORD: PASSWORD });
      const result = await bootstrapAdmin(db, config, logger);
      assert.equal(result.created, true);
      const logged = allLogText(logger);
      assert.ok(logged.includes('admin'), 'the username is logged');
      assert.ok(!logged.includes(PASSWORD), 'the password must not appear in the log');
    });
  }

  it('starts in production without a password when users already exist', async () => {
    db.prepare("INSERT INTO Users (Username, PasswordHash) VALUES ('existing', 'hash')").run();
    const result = await bootstrapAdmin(db, productionConfig(), createSilentLogger());
    assert.equal(result.created, false);
  });

  it('logs nothing about credentials in the test environment', async () => {
    const logger = createSilentLogger();
    const config = loadConfig({ NODE_ENV: 'test', PORT: '3000', BOOTSTRAP_ADMIN_PASSWORD: PASSWORD });
    await bootstrapAdmin(db, config, logger);
    assert.ok(!allLogText(logger).includes(PASSWORD));
  });

  it('accepts the legacy DEFAULT_ADMIN_* variables', async () => {
    const config = loadConfig({ DEFAULT_ADMIN_USERNAME: 'legacy-boss', DEFAULT_ADMIN_PASSWORD: PASSWORD });
    await bootstrapAdmin(db, config, createSilentLogger());
    assert.equal(users()[0].Username, 'legacy-boss');
  });
});
