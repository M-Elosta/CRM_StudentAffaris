'use strict';

/**
 * Application configuration.
 *
 * Every setting comes from an environment variable. Defaults differ per
 * environment (development, test, staging, production) and are defined in
 * ./environments.js. Nothing secret has a default outside development and test.
 *
 * Usage: const config = loadConfig();  // validates and freezes
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { z } = require('zod');
const { ENVIRONMENTS, environmentDefaults } = require('./environments');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

/** Load a .env file from the project root if one exists. Real environment variables win. */
function loadDotEnv(rootDir = ROOT_DIR) {
  const file = path.join(rootDir, '.env');
  if (!fs.existsSync(file)) return false;
  const parsed = require('node:util').parseEnv(fs.readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())));

const trustProxyFromEnv = z.union([z.boolean(), z.number(), z.string()]).transform((value) => {
  if (typeof value !== 'string') return value;
  const text = value.trim().toLowerCase();
  if (['false', '0', 'off', 'no', ''].includes(text)) return false;
  if (['true', 'on', 'yes'].includes(text)) return true;
  if (/^\d+$/.test(text)) return Number(text);
  return value.trim(); // an address or subnet list understood by Express
});

const schema = z.object({
  env: z.enum(ENVIRONMENTS),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  baseUrl: z.string().url().optional(),
  trustProxy: trustProxyFromEnv,

  databasePath: z.string().min(1),
  backupDir: z.string().min(1),
  backupRetention: z.coerce.number().int().min(1),

  sessionSecret: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  sessionCookieSecure: booleanFromEnv,
  sessionMaxAgeMinutes: z.coerce.number().int().min(5),

  bootstrapAdminUsername: z.string().min(3),
  bootstrapAdminPassword: z.string().min(12).optional(),

  apiRateLimitPerMinute: z.coerce.number().int().min(60),
  loginRateLimitPer15Min: z.coerce.number().int().min(3),
  jsonBodyLimit: z.string().min(2),

  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  timeZone: z.string().min(1),
});

function emptyToUndefined(value) {
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Build and validate the configuration object.
 * @param {NodeJS.ProcessEnv} env  environment to read (defaults to process.env)
 */
function loadConfig(env = process.env) {
  const envName = env.APP_ENV || env.NODE_ENV || 'development';
  if (!ENVIRONMENTS.includes(envName)) {
    throw new Error(`Unknown environment "${envName}". Use one of: ${ENVIRONMENTS.join(', ')}`);
  }
  const defaults = environmentDefaults(envName, ROOT_DIR);
  const pick = (name, fallback) => emptyToUndefined(env[name]) ?? fallback;

  // Development and test may run without a configured secret. Staging and
  // production must provide one, so sessions survive restarts and cannot be forged.
  let sessionSecret = emptyToUndefined(env.SESSION_SECRET);
  let sessionSecretIsEphemeral = false;
  if (!sessionSecret && defaults.allowEphemeralSecret) {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    sessionSecretIsEphemeral = true;
  }

  const candidate = {
    env: envName,
    host: pick('HOST', defaults.host),
    port: pick('PORT', defaults.port),
    baseUrl: emptyToUndefined(env.BASE_URL),
    trustProxy: pick('TRUST_PROXY', defaults.trustProxy),

    databasePath: pick('DATABASE_PATH', defaults.databasePath),
    backupDir: pick('BACKUP_DIR', defaults.backupDir),
    backupRetention: pick('BACKUP_RETENTION', 14),

    sessionSecret,
    sessionCookieSecure: pick('SESSION_COOKIE_SECURE', defaults.sessionCookieSecure),
    sessionMaxAgeMinutes: pick('SESSION_MAX_AGE_MINUTES', 12 * 60),

    bootstrapAdminUsername: pick('BOOTSTRAP_ADMIN_USERNAME', pick('DEFAULT_ADMIN_USERNAME', 'admin')),
    bootstrapAdminPassword: emptyToUndefined(env.BOOTSTRAP_ADMIN_PASSWORD) ?? emptyToUndefined(env.DEFAULT_ADMIN_PASSWORD),

    apiRateLimitPerMinute: pick('API_RATE_LIMIT_PER_MINUTE', 600),
    loginRateLimitPer15Min: pick('LOGIN_RATE_LIMIT_PER_15_MIN', 10),
    jsonBodyLimit: pick('JSON_BODY_LIMIT', '1mb'),

    logLevel: pick('LOG_LEVEL', defaults.logLevel),
    timeZone: pick('APP_TIME_ZONE', 'Asia/Qatar'),
  };

  const result = schema.safeParse(candidate);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const key = issue.path.join('.');
      if (key === 'sessionSecret' && !sessionSecret) return 'SESSION_SECRET is required in this environment';
      if (key === 'databasePath') return 'DATABASE_PATH is required in this environment';
      if (key === 'backupDir') return 'BACKUP_DIR is required in this environment';
      return `${key}: ${issue.message}`;
    });
    throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }

  const config = result.data;
  if (config.databasePath !== ':memory:') config.databasePath = path.resolve(ROOT_DIR, config.databasePath);
  config.backupDir = path.resolve(ROOT_DIR, config.backupDir);
  config.rootDir = ROOT_DIR;
  config.isProduction = envName === 'production';
  config.isProductionLike = envName === 'production' || envName === 'staging';
  config.isTest = envName === 'test';
  config.sessionSecretIsEphemeral = sessionSecretIsEphemeral;
  return Object.freeze(config);
}

module.exports = { loadConfig, loadDotEnv, ROOT_DIR };
