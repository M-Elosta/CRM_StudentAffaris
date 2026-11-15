'use strict';

/**
 * Date helpers for the demo seed. Dates are ISO strings (YYYY-MM-DD) handled
 * as UTC midnight, so arithmetic never shifts across a daylight-saving change.
 */

const DAY_MS = 86400000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Relative activity level per calendar month (index 0 = January). Fall
 * (August–December) and spring (January–May) are busy; the summer break
 * (June–July) is quiet, as are the exam weeks around the winter break.
 */
const MONTH_WEIGHTS = [1.0, 1.3, 1.3, 1.2, 0.8, 0.35, 0.25, 0.7, 1.3, 1.4, 1.3, 0.6];
const MAX_MONTH_WEIGHT = Math.max(...MONTH_WEIGHTS);

function parseIso(iso) {
  if (!ISO_DATE_RE.test(iso)) throw new Error(`Invalid date "${iso}". Use YYYY-MM-DD.`);
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new Error(`Invalid date "${iso}". Use YYYY-MM-DD.`);
  }
  return date;
}

function toIso(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  return toIso(new Date(parseIso(iso).getTime() + days * DAY_MS));
}

function addMonths(iso, months) {
  const date = parseIso(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return toIso(date);
}

/** Whole days from a to b (positive when b is later). */
function daysBetween(a, b) {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / DAY_MS);
}

function maxDate(a, b) {
  return a > b ? a : b;
}

function minDate(a, b) {
  return a < b ? a : b;
}

/** Today's calendar date in a time zone, as YYYY-MM-DD. */
function todayIn(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 0 = Sunday … 6 = Saturday. */
function weekday(iso) {
  return parseIso(iso).getUTCDay();
}

/** Move a Friday back to Thursday and a Saturday on to Sunday (the Qatar working week is Sunday–Thursday). */
function toWorkday(iso) {
  const day = weekday(iso);
  if (day === 5) return addDays(iso, -1);
  if (day === 6) return addDays(iso, 1);
  return iso;
}

/**
 * A random date in [from, to], weighted by the academic calendar and,
 * with trend > 0, increasingly likely towards the end of the range.
 * Prefers working days when the result stays inside the range.
 */
function sampleDate(rng, from, to, { trend = 0, workday = true } = {}) {
  if (from > to) throw new Error(`sampleDate: empty range ${from}..${to}`);
  const span = daysBetween(from, to);
  let candidate = from;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const offset = rng.int(0, span);
    candidate = addDays(from, offset);
    const monthWeight = MONTH_WEIGHTS[parseIso(candidate).getUTCMonth()] / MAX_MONTH_WEIGHT;
    const trendWeight = span > 0 ? (1 + trend * (offset / span)) / (1 + trend) : 1;
    if (rng.next() < monthWeight * trendWeight) break;
  }
  if (workday) {
    const shifted = toWorkday(candidate);
    if (shifted >= from && shifted <= to) return shifted;
  }
  return candidate;
}

/** A SQLite-style UTC timestamp ("YYYY-MM-DD HH:MM:SS") during Doha office hours on the given date. */
function officeTimestamp(rng, iso) {
  const minutes = rng.int(5 * 60, 13 * 60 + 59);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  const ss = String(rng.int(0, 59)).padStart(2, '0');
  return `${iso} ${hh}:${mm}:${ss}`;
}

module.exports = {
  parseIso,
  toIso,
  addDays,
  addMonths,
  daysBetween,
  maxDate,
  minDate,
  todayIn,
  weekday,
  toWorkday,
  sampleDate,
  officeTimestamp,
};
