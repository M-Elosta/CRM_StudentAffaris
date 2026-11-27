'use strict';

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DB_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const pad = (value, length = 2) => String(value).padStart(length, '0');

/**
 * Today's calendar date in the given IANA time zone, as YYYY-MM-DD.
 * @param {string} timeZone  e.g. 'Asia/Qatar'
 * @param {Date} [now]
 */
function todayInTimeZone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** True when value is a YYYY-MM-DD string naming a day that exists on the calendar. */
function isRealIsoDate(value) {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The UTC calendar date of a Date object, as YYYY-MM-DD. */
function isoDateFromUtcDate(date) {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Add (or, with a negative number, subtract) whole days to a YYYY-MM-DD date. */
function addDaysToIsoDate(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return isoDateFromUtcDate(new Date(Date.UTC(year, month - 1, day + days)));
}

/**
 * Bring a stored or client-supplied timestamp to the database form
 * 'YYYY-MM-DD HH:MM:SS'. ISO strings ('2025-01-02T03:04:05.000Z') are accepted.
 * Returns null for empty values.
 */
function normalizeTimestamp(value) {
  if (!value) return null;
  return String(value).replace('T', ' ').slice(0, 19);
}

/** True when value is a timestamp in the database form 'YYYY-MM-DD HH:MM:SS'. */
function isDatabaseTimestamp(value) {
  return typeof value === 'string' && DB_TIMESTAMP_RE.test(value);
}

module.exports = {
  todayInTimeZone,
  isRealIsoDate,
  isoDateFromUtcDate,
  addDaysToIsoDate,
  normalizeTimestamp,
  isDatabaseTimestamp,
};
