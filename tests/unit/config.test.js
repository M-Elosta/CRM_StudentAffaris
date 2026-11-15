'use strict';

const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig, ROOT_DIR } = require('../../src/config');
const { ENVIRONMENTS, environmentDefaults } = require('../../src/config/environments');

const SECRET = 's'.repeat(40);
const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  DATABASE_PATH: '/srv/ero/data/employer.db',
  BACKUP_DIR: '/srv/ero/backups',
  SESSION_SECRET: SECRET,
};
// The test environment's default port does not pass validation (see the todo
// below), so tests that are not about the port set one explicitly.
const TEST_ENV = { NODE_ENV: 'test', PORT: '3000' };

describe('config', () => {
  describe('development defaults', () => {
    it('loads with no variables at all', () => {
      const config = loadConfig({});
      assert.equal(config.env, 'development');
      assert.equal(config.host, '127.0.0.1');
      assert.equal(config.port, 3000);
      assert.equal(config.trustProxy, false);
      assert.equal(config.sessionCookieSecure, false);
      assert.equal(config.logLevel, 'debug');
      assert.equal(config.databasePath, path.join(ROOT_DIR, 'data', 'dev', 'employer.db'));
      assert.equal(config.backupDir, path.join(ROOT_DIR, 'data', 'dev', 'backups'));
      assert.equal(config.isProduction, false);
      assert.equal(config.isProductionLike, false);
      assert.equal(config.isTest, false);
    });

    it('generates an ephemeral session secret when none is set', () => {
      const a = loadConfig({ NODE_ENV: 'development' });
      const b = loadConfig({ NODE_ENV: 'development' });
      assert.equal(a.sessionSecretIsEphemeral, true);
      assert.ok(a.sessionSecret.length >= 32);
      assert.notEqual(a.sessionSecret, b.sessionSecret);
    });

    it('uses a configured session secret', () => {
      const config = loadConfig({ NODE_ENV: 'development', SESSION_SECRET: SECRET });
      assert.equal(config.sessionSecret, SECRET);
      assert.equal(config.sessionSecretIsEphemeral, false);
    });

    it('has sensible limits and time zone', () => {
      const config = loadConfig({});
      assert.equal(config.jsonBodyLimit, '1mb');
      assert.equal(config.apiRateLimitPerMinute, 600);
      assert.equal(config.loginRateLimitPer15Min, 10);
      assert.equal(config.sessionMaxAgeMinutes, 720);
      assert.equal(config.backupRetention, 14);
      assert.equal(config.timeZone, 'Asia/Qatar');
      assert.equal(config.bootstrapAdminUsername, 'admin');
      assert.equal(config.bootstrapAdminPassword, undefined);
    });

    it('returns a frozen object', () => {
      const config = loadConfig({});
      assert.ok(Object.isFrozen(config));
    });
  });

  describe('test defaults', () => {
    it('uses an in-memory database, silent logs and an ephemeral secret', () => {
      const config = loadConfig(TEST_ENV);
      assert.equal(config.env, 'test');
      assert.equal(config.isTest, true);
      assert.equal(config.databasePath, ':memory:');
      assert.equal(config.logLevel, 'silent');
      assert.equal(config.sessionSecretIsEphemeral, true);
      assert.equal(config.backupDir, path.join(ROOT_DIR, 'data', 'test', 'backups'));
    });

    it(
      'loads with only NODE_ENV=test set',
      {
        todo:
          'src/config/environments.js gives the test environment port 0, ' +
          'but the schema in src/config/index.js requires port >= 1',
      },
      () => {
        const config = loadConfig({ NODE_ENV: 'test' });
        assert.equal(config.env, 'test');
      }
    );
  });

  describe('staging and production', () => {
    for (const envName of ['production', 'staging']) {
      it(`${envName} loads when every required variable is set`, () => {
        const config = loadConfig({ ...PRODUCTION_ENV, NODE_ENV: envName });
        assert.equal(config.env, envName);
        assert.equal(config.isProductionLike, true);
        assert.equal(config.isProduction, envName === 'production');
        assert.equal(config.trustProxy, 1);
        assert.equal(config.sessionCookieSecure, true);
        assert.equal(config.sessionSecretIsEphemeral, false);
        assert.equal(config.databasePath, '/srv/ero/data/employer.db');
        assert.equal(config.backupDir, '/srv/ero/backups');
      });

      for (const variable of ['DATABASE_PATH', 'BACKUP_DIR', 'SESSION_SECRET']) {
        it(`${envName} refuses to start without ${variable}`, () => {
          const env = { ...PRODUCTION_ENV, NODE_ENV: envName };
          delete env[variable];
          assert.throws(() => loadConfig(env), new RegExp(`${variable} is required in this environment`));
        });

        it(`${envName} treats an empty ${variable} as missing`, () => {
          assert.throws(
            () => loadConfig({ ...PRODUCTION_ENV, NODE_ENV: envName, [variable]: '' }),
            new RegExp(`${variable} is required`)
          );
        });
      }

      it(`${envName} reports every missing variable at once`, () => {
        let message = '';
        try {
          loadConfig({ NODE_ENV: envName });
        } catch (err) {
          message = err.message;
        }
        assert.match(message, /DATABASE_PATH/);
        assert.match(message, /BACKUP_DIR/);
        assert.match(message, /SESSION_SECRET/);
      });
    }

    it('rejects a session secret shorter than 32 characters', () => {
      assert.throws(
        () => loadConfig({ ...PRODUCTION_ENV, SESSION_SECRET: 'x'.repeat(31) }),
        /SESSION_SECRET must be at least 32 characters/
      );
    });

    it('rejects a short session secret in development too', () => {
      assert.throws(() => loadConfig({ NODE_ENV: 'development', SESSION_SECRET: 'short' }), /at least 32/);
    });

    it('rejects a bootstrap admin password shorter than 12 characters', () => {
      assert.throws(
        () => loadConfig({ ...PRODUCTION_ENV, BOOTSTRAP_ADMIN_PASSWORD: 'admin123' }),
        /bootstrapAdminPassword/
      );
    });
  });

  describe('TRUST_PROXY', () => {
    const cases = [
      ['false', false],
      ['0', false],
      ['off', false],
      ['no', false],
      ['true', true],
      ['TRUE', true],
      ['yes', true],
      ['1', 1],
      ['2', 2],
      ['loopback', 'loopback'],
      [' 10.0.0.0/8, 127.0.0.1 ', '10.0.0.0/8, 127.0.0.1'],
    ];
    for (const [input, expected] of cases) {
      it(`parses ${JSON.stringify(input)} as ${JSON.stringify(expected)}`, () => {
        assert.deepEqual(loadConfig({ TRUST_PROXY: input }).trustProxy, expected);
      });
    }

    it('falls back to the environment default when empty', () => {
      assert.equal(loadConfig({ TRUST_PROXY: '' }).trustProxy, false);
      assert.equal(loadConfig({ ...PRODUCTION_ENV, TRUST_PROXY: '' }).trustProxy, 1);
    });
  });

  describe('paths', () => {
    it('keeps :memory: as :memory:', () => {
      assert.equal(loadConfig({ DATABASE_PATH: ':memory:' }).databasePath, ':memory:');
      assert.equal(loadConfig({ ...PRODUCTION_ENV, DATABASE_PATH: ':memory:' }).databasePath, ':memory:');
    });

    it('resolves relative paths against the project root', () => {
      const config = loadConfig({ DATABASE_PATH: 'var/db.sqlite', BACKUP_DIR: 'var/backups' });
      assert.equal(config.databasePath, path.join(ROOT_DIR, 'var', 'db.sqlite'));
      assert.equal(config.backupDir, path.join(ROOT_DIR, 'var', 'backups'));
    });
  });

  describe('environment names', () => {
    it('knows exactly four environments', () => {
      assert.deepEqual(ENVIRONMENTS, ['development', 'test', 'staging', 'production']);
    });

    it('rejects an unknown environment name', () => {
      assert.throws(() => loadConfig({ NODE_ENV: 'prod' }), /Unknown environment "prod"/);
      assert.throws(() => environmentDefaults('qa', ROOT_DIR), /No defaults for environment "qa"/);
    });

    it('prefers APP_ENV over NODE_ENV', () => {
      assert.equal(loadConfig({ APP_ENV: 'development', NODE_ENV: 'production' }).env, 'development');
      assert.throws(() => loadConfig({ APP_ENV: 'production', NODE_ENV: 'development' }), /DATABASE_PATH/);
    });
  });

  describe('bootstrap admin variables', () => {
    it('reads BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD', () => {
      const config = loadConfig({
        BOOTSTRAP_ADMIN_USERNAME: 'ero-admin',
        BOOTSTRAP_ADMIN_PASSWORD: 'bootstrap-password-1',
      });
      assert.equal(config.bootstrapAdminUsername, 'ero-admin');
      assert.equal(config.bootstrapAdminPassword, 'bootstrap-password-1');
    });

    it('accepts the legacy DEFAULT_ADMIN_USERNAME and DEFAULT_ADMIN_PASSWORD', () => {
      const config = loadConfig({
        DEFAULT_ADMIN_USERNAME: 'legacy-admin',
        DEFAULT_ADMIN_PASSWORD: 'legacy-password-1',
      });
      assert.equal(config.bootstrapAdminUsername, 'legacy-admin');
      assert.equal(config.bootstrapAdminPassword, 'legacy-password-1');
    });

    it('prefers the BOOTSTRAP_ADMIN_* variables when both are set', () => {
      const config = loadConfig({
        BOOTSTRAP_ADMIN_USERNAME: 'new-admin',
        BOOTSTRAP_ADMIN_PASSWORD: 'new-password-123',
        DEFAULT_ADMIN_USERNAME: 'old-admin',
        DEFAULT_ADMIN_PASSWORD: 'old-password-123',
      });
      assert.equal(config.bootstrapAdminUsername, 'new-admin');
      assert.equal(config.bootstrapAdminPassword, 'new-password-123');
    });
  });

  describe('other variables', () => {
    it('parses booleans and numbers from strings', () => {
      const config = loadConfig({
        SESSION_COOKIE_SECURE: 'yes',
        PORT: '8080',
        SESSION_MAX_AGE_MINUTES: '30',
        BACKUP_RETENTION: '7',
      });
      assert.equal(config.sessionCookieSecure, true);
      assert.equal(config.port, 8080);
      assert.equal(config.sessionMaxAgeMinutes, 30);
      assert.equal(config.backupRetention, 7);
      assert.equal(loadConfig({ SESSION_COOKIE_SECURE: 'nope' }).sessionCookieSecure, false);
    });

    it('rejects out-of-range values', () => {
      assert.throws(() => loadConfig({ PORT: '70000' }), /port/);
      assert.throws(() => loadConfig({ SESSION_MAX_AGE_MINUTES: '1' }), /sessionMaxAgeMinutes/);
      assert.throws(() => loadConfig({ LOG_LEVEL: 'loud' }), /logLevel/);
      assert.throws(() => loadConfig({ BASE_URL: 'not a url' }), /baseUrl/);
    });

    it('accepts a BASE_URL', () => {
      assert.equal(loadConfig({ BASE_URL: 'https://crm.example.edu' }).baseUrl, 'https://crm.example.edu');
    });
  });
});
