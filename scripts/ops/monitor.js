#!/usr/bin/env node
'use strict';

/**
 * Check that the service is healthy and that its safety nets work.
 *
 *   node scripts/ops/monitor.js          one line per check
 *   node scripts/ops/monitor.js --json   machine-readable, for IT's own monitoring
 *
 * Checks: health endpoint, free disk space (data and backup volumes), age of
 * the last successful backup, off-server copy configured, TLS certificate
 * expiry, result and age of the last integrity check. Exits 1 if any check
 * fails. Reads only; writes nothing.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig, loadDotEnv } = require('../../src/config');
const { loadOpsConfig } = require('../../src/config/ops');
const { healthUrl, checkHealth, readJsonIfExists } = require('./lib/common');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const ok = (name, message) => ({ name, status: 'ok', message });
const fail = (name, message) => ({ name, status: 'fail', message });
const skip = (name, message) => ({ name, status: 'skip', message });

function formatAge(ms) {
  if (ms < HOUR_MS) return `${Math.round(ms / 60000)} min`;
  if (ms < 2 * DAY_MS) return `${(ms / HOUR_MS).toFixed(1)} h`;
  return `${(ms / DAY_MS).toFixed(1)} days`;
}

async function checkHealthEndpoint(config, ops) {
  const url = healthUrl(config);
  const result = await checkHealth(url, ops.monitor.healthTimeoutMs);
  if (result.ok) return ok('health', `${url} answered 200 in ${result.ms} ms`);
  if (result.status) return fail('health', `${url} answered ${result.status} (expected 200)`);
  return fail('health', `${url} did not answer: ${result.error}`);
}

function checkDisk(name, dir, ops) {
  let stats;
  try {
    stats = fs.statfsSync(dir);
  } catch (err) {
    return fail(name, `${dir}: cannot read free space (${err.code || err.message})`);
  }
  const freeMb = Math.floor((stats.bavail * stats.bsize) / (1024 * 1024));
  const summary = `${dir}: ${freeMb} MB free`;
  if (freeMb < ops.monitor.minFreeMb) return fail(name, `${summary}; minimum is ${ops.monitor.minFreeMb} MB`);
  return ok(name, summary);
}

function checkBackupAge(config, ops, now) {
  const file = path.join(config.backupDir, 'last-success.json');
  let record;
  try {
    record = readJsonIfExists(file);
  } catch (err) {
    return fail('backup-age', err.message);
  }
  if (!record) return fail('backup-age', `no successful backup recorded yet (${file} is missing)`);
  const finished = Date.parse(record.finishedAt);
  if (Number.isNaN(finished)) return fail('backup-age', `${file} has no valid finishedAt`);
  const age = now - finished;
  const limit = ops.monitor.maxBackupAgeHours * HOUR_MS;
  const summary = `last successful backup ${formatAge(age)} ago (${path.basename(record.file || '?')})`;
  return age > limit
    ? fail('backup-age', `${summary}; limit is ${ops.monitor.maxBackupAgeHours} h`)
    : ok('backup-age', summary);
}

function checkOffsite(ops) {
  if (ops.remoteMode === 'none') {
    return fail('offsite-copy', 'no off-server copy configured (set BACKUP_REMOTE_DIR or BACKUP_REMOTE_COMMAND)');
  }
  if (ops.remoteMode === 'command') return ok('offsite-copy', 'copied by BACKUP_REMOTE_COMMAND');
  try {
    if (!fs.statSync(ops.backupRemoteDir).isDirectory()) throw new Error('not a directory');
    fs.accessSync(ops.backupRemoteDir, fs.constants.W_OK);
  } catch (err) {
    return fail(
      'offsite-copy',
      `${ops.backupRemoteDir} is not available (${err.code || err.message}); is the share mounted?`
    );
  }
  return ok('offsite-copy', `copied to ${ops.backupRemoteDir}`);
}

function checkCertificate(ops, now) {
  const minDays = ops.monitor.minCertDays;
  const source = ops.monitor.tlsCertFile;
  if (!source) return skip('tls-certificate', 'MONITOR_TLS_CERT_FILE is not set');
  let validTo;
  try {
    validTo = new Date(new crypto.X509Certificate(fs.readFileSync(source)).validTo);
  } catch (err) {
    return fail('tls-certificate', `${source}: cannot read the certificate (${err.code || err.message})`);
  }
  if (Number.isNaN(validTo.getTime())) return fail('tls-certificate', `${source}: the expiry date cannot be read`);
  const daysLeft = Math.floor((validTo.getTime() - now) / DAY_MS);
  const summary = `${source}: expires ${validTo.toISOString().slice(0, 10)}, in ${daysLeft} days`;
  if (daysLeft <= minDays) return fail('tls-certificate', `${summary}; renew it (threshold ${minDays} days)`);
  return ok('tls-certificate', summary);
}

function checkIntegrityRecord(config, ops, now) {
  const file = path.join(config.backupDir, 'last-integrity.json');
  let record;
  try {
    record = readJsonIfExists(file);
  } catch (err) {
    return fail('integrity', err.message);
  }
  if (!record) return fail('integrity', `no integrity check has run yet (${file} is missing)`);
  const finished = Date.parse(record.finishedAt);
  if (Number.isNaN(finished)) return fail('integrity', `${file} has no valid finishedAt`);
  const age = now - finished;
  if (!record.ok) return fail('integrity', `the last integrity check (${formatAge(age)} ago) found problems`);
  if (age > ops.monitor.maxIntegrityAgeDays * DAY_MS) {
    return fail(
      'integrity',
      `the last integrity check ran ${formatAge(age)} ago; limit is ${ops.monitor.maxIntegrityAgeDays} days`
    );
  }
  return ok('integrity', `last integrity check ok, ${formatAge(age)} ago`);
}

async function runChecks(config, ops, now = Date.now()) {
  return [
    await checkHealthEndpoint(config, ops),
    checkDisk('disk-data', path.dirname(config.databasePath), ops),
    checkDisk('disk-backups', config.backupDir, ops),
    checkBackupAge(config, ops, now),
    checkOffsite(ops),
    checkCertificate(ops, now),
    checkIntegrityRecord(config, ops, now),
  ];
}

async function main() {
  const json = process.argv.includes('--json');
  loadDotEnv();
  const config = loadConfig();
  const ops = loadOpsConfig();
  const checks = await runChecks(config, ops);
  const healthy = checks.every((check) => check.status !== 'fail');
  if (json) {
    console.log(
      JSON.stringify({ checkedAt: new Date().toISOString(), host: os.hostname(), ok: healthy, checks }, null, 2)
    );
  } else {
    for (const check of checks)
      console.log(`${check.status.toUpperCase().padEnd(4)}  ${check.name.padEnd(15)} ${check.message}`);
    console.log(healthy ? 'All checks passed.' : 'One or more checks FAILED. See RUNBOOK.md.');
  }
  process.exit(healthy ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Monitor could not run: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { runChecks };
