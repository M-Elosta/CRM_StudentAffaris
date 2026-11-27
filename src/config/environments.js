'use strict';

const path = require('node:path');

const ENVIRONMENTS = ['development', 'test', 'staging', 'production'];

/**
 * Per-environment defaults. Anything here can be overridden by an environment
 * variable (see .env.example). Staging and production deliberately have no
 * default for the database path, backup directory or session secret: they must
 * be set explicitly so data never ends up inside the application folder.
 */
function environmentDefaults(envName, rootDir) {
  const shared = {
    host: '127.0.0.1',
    port: 3000,
    trustProxy: false,
    sessionCookieSecure: false,
    allowEphemeralSecret: false,
    logLevel: 'info',
  };

  switch (envName) {
    case 'development':
      return {
        ...shared,
        databasePath: path.join(rootDir, 'data', 'dev', 'employer.db'),
        backupDir: path.join(rootDir, 'data', 'dev', 'backups'),
        allowEphemeralSecret: true,
        logLevel: 'debug',
      };
    case 'test':
      return {
        ...shared,
        port: 0,
        databasePath: ':memory:',
        backupDir: path.join(rootDir, 'data', 'test', 'backups'),
        allowEphemeralSecret: true,
        logLevel: 'silent',
      };
    case 'staging':
    case 'production':
      // Runs behind nginx on the same host: listen on loopback only, trust
      // exactly one proxy hop, and require HTTPS-only cookies.
      return {
        ...shared,
        databasePath: undefined,
        backupDir: undefined,
        trustProxy: 1,
        sessionCookieSecure: true,
      };
    default:
      throw new Error(`No defaults for environment "${envName}"`);
  }
}

module.exports = { ENVIRONMENTS, environmentDefaults };
