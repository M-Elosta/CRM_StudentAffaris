#!/usr/bin/env node
'use strict';

/**
 * Raise an operations alert.
 *
 *   node scripts/ops/alert.js <unit>
 *
 * Started by systemd (ero-crm-alert@<unit>.service) when a unit fails, or by
 * hand to test the alert path. The alert is always written to stderr, which
 * ends up in journald. If ALERT_COMMAND is set, that command is also run,
 * without a shell:
 *
 *   - {subject} and {body} in the command are replaced by the subject and body;
 *   - if the command contains neither placeholder, the subject and body are
 *     appended as its last two arguments;
 *   - the body is also given on standard input, so a command such as
 *     `mail -s {subject} it-alerts@example.edu` works as it is.
 *
 * The text contains no personal data: only the unit name, host name, time and
 * where to look next. No log lines are included.
 */

const os = require('node:os');
const { loadDotEnv } = require('../../src/config');
const { loadOpsConfig } = require('../../src/config/ops');
const { splitCommand, expandCommand, runArgs } = require('./lib/common');

const RUNBOOK_SECTIONS = {
  'ero-crm.service': 'The site is down',
  'ero-crm-backup.service': 'A backup failed or is stale',
  'ero-crm-integrity.service': 'The integrity check failed',
  'ero-crm-monitor.service': 'read the FAIL lines of the monitor output',
};

function buildAlert(unit, { now = new Date(), host = os.hostname() } = {}) {
  const safeUnit = String(unit).replace(/[^A-Za-z0-9@._:-]/g, '_');
  const section = RUNBOOK_SECTIONS[safeUnit] || 'see the unit log';
  const subject = `[ero-crm] FAILED: ${safeUnit} on ${host}`;
  const body = [
    `Unit:   ${safeUnit}`,
    `Host:   ${host}`,
    `Time:   ${now.toISOString()}`,
    '',
    `Read the log:  journalctl -u ${safeUnit} -n 50 --no-pager`,
    `What to do:    RUNBOOK.md, "${section}" (in /opt/ero-crm/current).`,
    '',
  ].join('\n');
  return { subject, body };
}

/** Arguments for ALERT_COMMAND: placeholders replaced, or subject and body appended. */
function alertCommandArgs(template, alert) {
  const parts = splitCommand(template);
  const hasPlaceholder = parts.some((part) => part.includes('{subject}') || part.includes('{body}'));
  if (hasPlaceholder) return expandCommand(template, { subject: alert.subject, body: alert.body });
  return [...parts, alert.subject, alert.body];
}

function main() {
  const unit = process.argv[2];
  if (!unit || unit.startsWith('-')) {
    console.error('Usage: node scripts/ops/alert.js <unit-name>');
    process.exit(2);
  }
  loadDotEnv();
  const ops = loadOpsConfig();
  const alert = buildAlert(unit);
  console.error(`ALERT ${alert.subject}\n${alert.body}`);

  if (!ops.alert.command) {
    console.error('ALERT_COMMAND is not set: this alert was written to the journal only.');
    return;
  }
  const result = runArgs(alertCommandArgs(ops.alert.command, alert), { input: alert.body, timeoutMs: 60_000 });
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : `exit status ${result.status ?? result.signal}`;
    console.error(`ALERT_COMMAND failed (${detail}). The alert above is in the journal only.`);
    process.exit(1);
  }
  console.error('Alert passed to ALERT_COMMAND.');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`Alert could not be raised: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { buildAlert, alertCommandArgs };
