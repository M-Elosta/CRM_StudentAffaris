'use strict';

/**
 * Which backup files to keep and which to delete.
 *
 * `planRetention` is a pure function: it takes file names and a clock and
 * returns a plan. `applyRetention` carries out a plan in one directory and
 * only ever deletes files whose names match BACKUP_FILE_PATTERN.
 *
 * Rules (all dates in the office time zone, Asia/Qatar by default, derived
 * from the UTC timestamp in the file name, never from file times):
 *   - the most recent backup is always kept, whatever its age;
 *   - daily:   the newest backup of each of the `keepDaily` most recent days that have a backup;
 *   - weekly:  the newest backup of each of the `keepWeekly` most recent ISO weeks that have a backup;
 *   - monthly: the newest backup of each of the `keepMonthly` most recent months that have a backup;
 *   - backups labelled pre-migration* or pre-deploy* are also kept while they
 *     are younger than `keepPreChangeDays` days.
 *
 * "Most recent days that have a backup" (rather than "the last N calendar
 * days") means that if backups stop for a while, the older backups are not
 * deleted just because time passes.
 */

const fs = require('node:fs');
const path = require('node:path');

const BACKUP_FILE_PATTERN = /^employer-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z-([A-Za-z0-9-]+)\.db(\.enc)?$/;
const PRE_CHANGE_LABEL = /^(pre-migration|pre-deploy)/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a backup file name. Returns null for anything that is not a backup. */
function parseBackupName(name) {
  const match = BACKUP_FILE_PATTERN.exec(name);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, label, enc] = match;
  const time = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const check = new Date(time);
  if (Number.isNaN(time) || check.getUTCMonth() !== Number(mo) - 1 || check.getUTCDate() !== Number(d)) return null;
  return { name, time, label, encrypted: Boolean(enc) };
}

function localDateParts(time, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(time))
    .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/** ISO 8601 week key ("2026-W07") of a calendar date. */
function isoWeekKey({ year, month, day }) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7; // Monday = 1 … Sunday = 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday); // Thursday of this week decides the year
  const weekYear = date.getUTCFullYear();
  const week = Math.ceil(((date - Date.UTC(weekYear, 0, 1)) / DAY_MS + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

function periodKeys(time, timeZone) {
  const parts = localDateParts(time, timeZone);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    day: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    week: isoWeekKey(parts),
    month: `${parts.year}-${pad(parts.month)}`,
  };
}

/**
 * Decide which backups to keep.
 *
 * @param {string[]} names file names in one directory (not paths)
 * @param {object} options
 * @param {number} [options.keepDaily=7]
 * @param {number} [options.keepWeekly=4]
 * @param {number} [options.keepMonthly=12]
 * @param {number} [options.keepPreChangeDays=30]
 * @param {string} [options.timeZone='Asia/Qatar']
 * @param {Date|number} [options.now=Date.now()]
 * @returns {{keep: {name: string, reasons: string[]}[], remove: string[], ignored: string[]}}
 */
function planRetention(names, options = {}) {
  const {
    keepDaily = 7,
    keepWeekly = 4,
    keepMonthly = 12,
    keepPreChangeDays = 30,
    timeZone = 'Asia/Qatar',
    now = Date.now(),
  } = options;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);

  const ignored = [];
  const backups = [];
  for (const name of names) {
    const parsed = parseBackupName(name);
    if (parsed) backups.push({ ...parsed, periods: periodKeys(parsed.time, timeZone) });
    else ignored.push(name);
  }
  // Newest first; the name breaks ties so the result never depends on input order.
  backups.sort((a, b) => b.time - a.time || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));

  const reasons = new Map(backups.map((b) => [b.name, []]));
  if (backups.length) reasons.get(backups[0].name).push('most recent');

  const keepNewestPerPeriod = (period, limit, reason) => {
    const seen = new Set();
    for (const backup of backups) {
      const key = backup.periods[period];
      if (seen.has(key)) continue;
      if (seen.size >= limit) break;
      seen.add(key);
      reasons.get(backup.name).push(`${reason} ${key}`);
    }
  };
  keepNewestPerPeriod('day', keepDaily, 'daily');
  keepNewestPerPeriod('week', keepWeekly, 'weekly');
  keepNewestPerPeriod('month', keepMonthly, 'monthly');

  for (const backup of backups) {
    if (PRE_CHANGE_LABEL.test(backup.label) && nowMs - backup.time <= keepPreChangeDays * DAY_MS) {
      reasons.get(backup.name).push('pre-change');
    }
  }

  const keep = [];
  const remove = [];
  for (const backup of backups) {
    const why = reasons.get(backup.name);
    if (why.length) keep.push({ name: backup.name, reasons: why });
    else remove.push(backup.name);
  }
  return { keep, remove, ignored };
}

/**
 * Apply the retention rules to one directory. Only regular files whose names
 * match the backup pattern are ever deleted.
 * @returns {{kept: string[], removed: string[]}}
 */
function applyRetention(dir, options = {}) {
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const plan = planRetention(names, options);
  const removed = [];
  for (const name of plan.remove) {
    if (!BACKUP_FILE_PATTERN.test(name)) continue; // defence in depth
    fs.unlinkSync(path.join(dir, name));
    removed.push(name);
  }
  return { kept: plan.keep.map((k) => k.name), removed };
}

module.exports = { planRetention, applyRetention, parseBackupName, isoWeekKey, BACKUP_FILE_PATTERN };
