'use strict';

/**
 * Operations settings: backups, off-server copies, monitoring and alerts.
 *
 * Kept apart from the application configuration (./index.js) so the
 * operations scripts can evolve without touching the web application. Every
 * setting comes from an environment variable; see the "Operations" section of
 * .env.example.
 *
 * Usage: const ops = loadOpsConfig(process.env);  // validates and freezes
 */

const path = require('node:path');
const { z } = require('zod');
const { ENVIRONMENTS } = require('./environments');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

const positiveInt = z.coerce.number().int().min(0);
const optionalText = z.string().min(1).optional();

const schema = z.object({
  env: z.enum(ENVIRONMENTS),
  isProductionLike: z.boolean(),
  timeZone: z.string().min(1),

  backupKeyFile: optionalText,
  requireEncryption: z.boolean(),
  backupRemoteDir: optionalText,
  backupRemoteCommand: optionalText,
  backupRemoteTimeoutSeconds: z.coerce.number().int().min(10),

  keepDaily: positiveInt,
  keepWeekly: positiveInt,
  keepMonthly: positiveInt,
  keepPreChangeDays: positiveInt,

  monitor: z.object({
    minFreeMb: positiveInt,
    minFreePercent: z.coerce.number().min(0).max(100),
    maxBackupAgeHours: z.coerce.number().positive(),
    maxIntegrityAgeDays: z.coerce.number().positive(),
    minCertDays: positiveInt,
    healthTimeoutMs: z.coerce.number().int().min(100),
    tlsHost: optionalText,
    tlsPort: z.coerce.number().int().min(1).max(65535).optional(),
    tlsCertFile: optionalText,
  }),

  alert: z.object({
    smtpHost: optionalText,
    smtpPort: z.coerce.number().int().min(1).max(65535),
    smtpSecure: z.boolean(),
    smtpUser: optionalText,
    smtpPassword: optionalText,
    from: optionalText,
    to: optionalText,
    command: optionalText,
    repeatHours: z.coerce.number().positive(),
    stateFile: optionalText,
  }),
});

function emptyToUndefined(value) {
  return value === undefined || value === null || String(value).trim() === '' ? undefined : String(value).trim();
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
}

/**
 * Build and validate the operations configuration.
 * @param {NodeJS.ProcessEnv} env environment to read (defaults to process.env)
 */
function loadOpsConfig(env = process.env) {
  const envName = env.APP_ENV || env.NODE_ENV || 'development';
  if (!ENVIRONMENTS.includes(envName)) {
    throw new Error(`Unknown environment "${envName}". Use one of: ${ENVIRONMENTS.join(', ')}`);
  }
  const isProductionLike = envName === 'production' || envName === 'staging';
  const pick = (name, fallback) => emptyToUndefined(env[name]) ?? fallback;
  const smtpPort = pick('ALERT_SMTP_PORT', 25);

  const candidate = {
    env: envName,
    isProductionLike,
    timeZone: pick('APP_TIME_ZONE', 'Asia/Qatar'),

    backupKeyFile: pick('BACKUP_KEY_FILE'),
    requireEncryption: isProductionLike,
    backupRemoteDir: pick('BACKUP_REMOTE_DIR'),
    backupRemoteCommand: pick('BACKUP_REMOTE_COMMAND'),
    backupRemoteTimeoutSeconds: pick('BACKUP_REMOTE_TIMEOUT_SECONDS', 1800),

    keepDaily: pick('BACKUP_KEEP_DAILY', 7),
    keepWeekly: pick('BACKUP_KEEP_WEEKLY', 4),
    keepMonthly: pick('BACKUP_KEEP_MONTHLY', 12),
    keepPreChangeDays: pick('BACKUP_KEEP_PRE_CHANGE_DAYS', 30),

    monitor: {
      minFreeMb: pick('MONITOR_MIN_FREE_MB', 1024),
      minFreePercent: pick('MONITOR_MIN_FREE_PERCENT', 10),
      maxBackupAgeHours: pick('MONITOR_MAX_BACKUP_AGE_HOURS', 26),
      maxIntegrityAgeDays: pick('MONITOR_MAX_INTEGRITY_AGE_DAYS', 8),
      minCertDays: pick('MONITOR_MIN_CERT_DAYS', 21),
      healthTimeoutMs: pick('MONITOR_HEALTH_TIMEOUT_MS', 5000),
      tlsHost: pick('MONITOR_TLS_HOST'),
      tlsPort: pick('MONITOR_TLS_PORT'),
      tlsCertFile: pick('MONITOR_TLS_CERT_FILE'),
    },

    alert: {
      smtpHost: pick('ALERT_SMTP_HOST'),
      smtpPort,
      smtpSecure: env.ALERT_SMTP_SECURE ? truthy(env.ALERT_SMTP_SECURE) : Number(smtpPort) === 465,
      smtpUser: pick('ALERT_SMTP_USER'),
      smtpPassword: pick('ALERT_SMTP_PASSWORD'),
      from: pick('ALERT_FROM'),
      to: pick('ALERT_TO'),
      command: pick('ALERT_COMMAND'),
      repeatHours: pick('ALERT_REPEAT_HOURS', 6),
      stateFile: pick('ALERT_STATE_FILE'),
    },
  };

  const result = schema.safeParse(candidate);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid operations configuration:\n  - ${problems.join('\n  - ')}`);
  }

  const ops = result.data;
  const problems = [];
  if (ops.backupRemoteDir && ops.backupRemoteCommand) {
    problems.push('Set either BACKUP_REMOTE_DIR or BACKUP_REMOTE_COMMAND, not both.');
  }
  if (ops.backupRemoteCommand && !ops.backupRemoteCommand.includes('{file}')) {
    problems.push('BACKUP_REMOTE_COMMAND must contain {file}, which is replaced by the backup file path.');
  }
  if (ops.alert.smtpHost && (!ops.alert.from || !ops.alert.to)) {
    problems.push('ALERT_SMTP_HOST is set, so ALERT_FROM and ALERT_TO are required too.');
  }
  if (Boolean(ops.alert.smtpUser) !== Boolean(ops.alert.smtpPassword)) {
    problems.push('Set both ALERT_SMTP_USER and ALERT_SMTP_PASSWORD, or neither.');
  }
  if (problems.length) throw new Error(`Invalid operations configuration:\n  - ${problems.join('\n  - ')}`);

  if (ops.backupKeyFile) ops.backupKeyFile = path.resolve(ROOT_DIR, ops.backupKeyFile);
  if (ops.backupRemoteDir) ops.backupRemoteDir = path.resolve(ROOT_DIR, ops.backupRemoteDir);
  if (ops.monitor.tlsCertFile) ops.monitor.tlsCertFile = path.resolve(ROOT_DIR, ops.monitor.tlsCertFile);
  ops.remoteMode = ops.backupRemoteDir ? 'dir' : ops.backupRemoteCommand ? 'command' : 'none';
  ops.retention = {
    keepDaily: ops.keepDaily,
    keepWeekly: ops.keepWeekly,
    keepMonthly: ops.keepMonthly,
    keepPreChangeDays: ops.keepPreChangeDays,
    timeZone: ops.timeZone,
  };
  return Object.freeze(ops);
}

/**
 * Throw a clear error when this environment requires encrypted backups and no
 * key is configured. Called by every script that writes a backup.
 */
function assertBackupKeyConfigured(ops) {
  if (ops.requireEncryption && !ops.backupKeyFile) {
    throw new Error(
      `BACKUP_KEY_FILE is not set. In ${ops.env} every backup must be encrypted, so nothing was written. ` +
        'Set BACKUP_KEY_FILE in the environment file (normally /etc/ero-crm/backup.key) and run the backup again.'
    );
  }
}

module.exports = { loadOpsConfig, assertBackupKeyConfigured };
