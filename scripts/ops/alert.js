#!/usr/bin/env node
'use strict';

/**
 * Send an operations alert.
 *
 *   node scripts/ops/alert.js <subject>               a unit failed (normally its name, e.g. ero-crm-backup.service)
 *   node scripts/ops/alert.js --recovered <subject>   it works again: say so once, if an alert was sent
 *
 * Channels, in order of preference: SMTP (ALERT_SMTP_HOST, via nodemailer),
 * then ALERT_COMMAND (run without a shell; the message is on its standard
 * input and {subject} is replaced). The alert is always written to stderr as
 * well, which ends up in journald.
 *
 * Rate limit: one message per subject every ALERT_REPEAT_HOURS (default 6)
 * while the problem lasts, plus one "recovered" message. State is kept in
 * ALERT_STATE_FILE (default BACKUP_DIR/alert-state.json).
 *
 * The message contains no personal data: unit, check, host name, time and the
 * last 20 lines of that unit's own output (e-mail addresses masked). The
 * application's own log is never included.
 */

const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadDotEnv } = require('../../src/config');
const { loadOpsConfig } = require('../../src/config/ops');
const { writeJsonAtomic, readJsonIfExists, runTemplate } = require('./lib/common');

const APP_UNIT = 'ero-crm.service';
const HOUR_MS = 60 * 60 * 1000;

const CHECKS = {
  'ero-crm.service': { check: 'web application', runbook: 'The site is down' },
  'ero-crm-backup.service': { check: 'nightly backup', runbook: 'A backup failed or is stale' },
  'ero-crm-integrity.service': { check: 'weekly integrity check', runbook: 'The integrity check fails' },
  'ero-crm-monitor.service': { check: 'monitoring checks', runbook: 'see the FAIL lines below' },
};

function maskPersonalData(line) {
  return line.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[e-mail removed]');
}

function unitOutput(unit) {
  if (unit === APP_UNIT || !/^[A-Za-z0-9@._:-]+$/.test(unit)) {
    return '(not included: the application log may contain personal data. Read it with: journalctl -u ero-crm.service)';
  }
  const journalctl = process.env.ERO_JOURNALCTL || 'journalctl';
  const result = spawnSync(journalctl, ['-u', unit, '-n', '20', '--no-pager', '-o', 'cat'], {
    encoding: 'utf8',
    timeout: 15000,
  });
  if (result.error || result.status !== 0) {
    return `(log lines unavailable: ${result.error ? result.error.message : (result.stderr || '').trim()})`;
  }
  return result.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-20)
    .map(maskPersonalData)
    .join('\n');
}

function localTime(date, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'long' }).format(date);
  } catch (_err) {
    return date.toISOString();
  }
}

function buildMessage({ subject, recovered, ops, now, since }) {
  const host = os.hostname();
  const info = CHECKS[subject] || { check: subject, runbook: 'RUNBOOK.md' };
  const title = `[ero-crm] ${recovered ? 'RECOVERED' : 'FAILED'}: ${subject} on ${host}`;
  const lines = [
    `Unit:   ${subject}`,
    `Check:  ${info.check}`,
    `Host:   ${host}`,
    `Time:   ${now.toISOString()} (${localTime(now, ops.timeZone)})`,
    `Status: ${recovered ? 'working again' : 'FAILED'}`,
  ];
  if (recovered) {
    if (since) lines.push(`The problem was first reported at ${new Date(since).toISOString()}.`);
  } else {
    lines.push(
      '',
      `What to do: RUNBOOK.md, "${info.runbook}".`,
      `This alert repeats at most every ${ops.alert.repeatHours} h while the problem lasts; one "recovered" message follows when it is fixed.`,
      '',
      "Last lines of this unit's output:",
      unitOutput(subject)
    );
  }
  return { title, text: `${lines.join('\n')}\n` };
}

async function sendSmtp(alert, message) {
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    host: alert.smtpHost,
    port: alert.smtpPort,
    secure: alert.smtpSecure,
    auth: alert.smtpUser ? { user: alert.smtpUser, pass: alert.smtpPassword } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  try {
    await transport.sendMail({ from: alert.from, to: alert.to, subject: message.title, text: message.text });
  } finally {
    transport.close();
  }
}

function sendCommand(alert, message) {
  const result = runTemplate(alert.command, { subject: message.title }, { input: message.text, timeoutMs: 60000 });
  if (result.error) throw new Error(result.error.message);
  if (result.status !== 0) throw new Error(`exit status ${result.status ?? result.signal}: ${result.stderr.trim()}`);
}

/** Try each configured channel in order. Returns the channel used, or throws listing every failure. */
async function deliver(ops, message) {
  const failures = [];
  if (ops.alert.smtpHost) {
    try {
      await sendSmtp(ops.alert, message);
      return 'smtp';
    } catch (err) {
      failures.push(`SMTP ${ops.alert.smtpHost}:${ops.alert.smtpPort}: ${err.message}`);
    }
  }
  if (ops.alert.command) {
    try {
      sendCommand(ops.alert, message);
      return 'command';
    } catch (err) {
      failures.push(`ALERT_COMMAND: ${err.message}`);
    }
  }
  if (!failures.length) throw new Error('no alert channel is configured (ALERT_SMTP_HOST or ALERT_COMMAND)');
  throw new Error(failures.join('; '));
}

function stateFilePath(ops) {
  if (ops.alert.stateFile) return ops.alert.stateFile;
  const dir = process.env.BACKUP_DIR || path.join(os.tmpdir());
  return path.join(dir, 'alert-state.json');
}

async function main() {
  const args = process.argv.slice(2);
  const recovered = args[0] === '--recovered';
  const subject = recovered ? args[1] : args[0];
  if (!subject || subject.startsWith('-')) {
    console.error('Usage: node scripts/ops/alert.js [--recovered] <subject>');
    process.exit(2);
  }
  loadDotEnv();
  const ops = loadOpsConfig();
  const now = new Date();
  const stateFile = stateFilePath(ops);
  const state = readJsonIfExists(stateFile) || { alerts: {} };
  state.alerts = state.alerts || {};
  const entry = state.alerts[subject];

  if (recovered) {
    if (!entry) return; // nothing was wrong
    delete state.alerts[subject];
    writeJsonAtomic(stateFile, state);
    if (!entry.lastSentAt) return; // no failure message ever went out, so no recovery message either
    const message = buildMessage({ subject, recovered: true, ops, now, since: entry.since });
    console.error(`ALERT ${message.title}\n${message.text}`);
    const channel = await deliver(ops, message);
    console.error(`Recovery message sent by ${channel}.`);
    return;
  }

  const message = buildMessage({ subject, recovered: false, ops, now });
  console.error(`ALERT ${message.title}\n${message.text}`);
  const next = { since: entry?.since || now.toISOString(), lastSentAt: entry?.lastSentAt, suppressed: entry?.suppressed || 0 };
  if (entry?.lastSentAt && now - Date.parse(entry.lastSentAt) < ops.alert.repeatHours * HOUR_MS) {
    next.suppressed += 1;
    state.alerts[subject] = next;
    writeJsonAtomic(stateFile, state);
    console.error(`Not sent again: the last message for ${subject} went out at ${entry.lastSentAt} (repeats every ${ops.alert.repeatHours} h).`);
    return;
  }
  state.alerts[subject] = next;
  try {
    const channel = await deliver(ops, message);
    next.lastSentAt = now.toISOString();
    next.suppressed = 0;
    console.error(`Alert sent by ${channel}.`);
  } finally {
    writeJsonAtomic(stateFile, state);
  }
}

main().catch((err) => {
  console.error(`Alert could not be delivered: ${err.message}`);
  process.exit(1);
});
