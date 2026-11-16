'use strict';

const path = require('node:path');
const nunjucks = require('nunjucks');

const VIEWS_DIR = path.join(__dirname, '..', 'views');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * Read a stored value as a moment in time. Calendar dates ('2026-11-15') are
 * kept as that calendar day; stored timestamps ('2026-11-15 11:05:00' or ISO
 * with Z) are UTC.
 * @returns {{ date: Date, dateOnly: boolean } | null}
 */
function parseStoredDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : { date: value, dateOnly: false };
  const text = String(value).trim();
  let match = DATE_ONLY_RE.exec(text);
  if (match) {
    const [year, month, day] = match.slice(1).map(Number);
    return { date: new Date(Date.UTC(year, month - 1, day, 12)), dateOnly: true };
  }
  match = TIMESTAMP_RE.exec(text);
  if (match) {
    const [year, month, day, hour, minute, second = 0] = match.slice(1).map((part) => Number(part ?? 0));
    return { date: new Date(Date.UTC(year, month - 1, day, hour, minute, second)), dateOnly: false };
  }
  return null;
}

/**
 * The display formatters, all in the office time zone: `15 Nov 2026` and
 * `15 Nov 2026, 14:05`.
 * @param {string} timeZone  IANA name, e.g. 'Asia/Qatar'
 */
function createFormatters(timeZone) {
  // Day, month and year come from Intl in the right time zone; the month names
  // are fixed, because some ICU versions write September as "Sept".
  const partsFormat = (zone) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'numeric', year: 'numeric' });
  const formatWith = (formatter) => ({
    format(date) {
      const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
      return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}`;
    },
  });
  const dateFormat = formatWith(partsFormat(timeZone));
  const calendarFormat = formatWith(partsFormat('UTC'));
  const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  const numberFormat = new Intl.NumberFormat('en-GB');

  return {
    /** A stored date or timestamp as `15 Nov 2026`; empty for no value; the input unchanged when unreadable. */
    date(value) {
      const parsed = parseStoredDate(value);
      if (!parsed) return value ?? '';
      return (parsed.dateOnly ? calendarFormat : dateFormat).format(parsed.date);
    },
    /** A stored timestamp as `15 Nov 2026, 14:05` in the office time zone. */
    datetime(value) {
      const parsed = parseStoredDate(value);
      if (!parsed) return value ?? '';
      if (parsed.dateOnly) return calendarFormat.format(parsed.date);
      return `${dateFormat.format(parsed.date)}, ${timeFormat.format(parsed.date)}`;
    },
    /** A number with thousands separators; empty for no value. */
    number(value) {
      if (value === null || value === undefined || value === '') return '';
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numberFormat.format(numeric) : value;
    },
  };
}

/**
 * The Nunjucks environment for the server-rendered pages: autoescaping on,
 * the date, datetime and number filters, and a json filter for the
 * <script type="application/json"> data blocks (escaped so it cannot close the element).
 * @param {{ timeZone: string, isTest?: boolean, isProductionLike?: boolean }} config
 * @param {import('express').Express} [app]  when given, registered as the app's view engine
 */
function createNunjucksEnv(config, app) {
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(VIEWS_DIR, { noCache: !config.isProductionLike && !config.isTest }),
    { autoescape: true, throwOnUndefined: false, trimBlocks: true, lstripBlocks: true }
  );
  const formatters = createFormatters(config.timeZone);
  env.addFilter('date', formatters.date);
  env.addFilter('datetime', formatters.datetime);
  env.addFilter('number', formatters.number);
  env.addFilter(
    'blank',
    (value) => value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)
  );
  env.addFilter(
    'json',
    (value) =>
      new nunjucks.runtime.SafeString(
        JSON.stringify(value ?? null)
          .replace(/</g, '\\u003c')
          .replace(/>/g, '\\u003e')
          .replace(/&/g, '\\u0026')
          .replace(/[\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16)}`)
      )
  );
  if (app) {
    env.express(app);
    app.set('view engine', 'njk');
  }
  return env;
}

module.exports = { createNunjucksEnv, createFormatters, parseStoredDate, VIEWS_DIR };
