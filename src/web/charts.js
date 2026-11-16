'use strict';

/**
 * Chart descriptions for the client script (app.js turns them into Chart.js
 * charts in the neutral style): { type, labels, series: [{ label, data }], xLabel, yLabel }.
 * Bar and line only; one series, or two with the second as the accent.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The `count` months ending with the month of `today` (YYYY-MM-DD), oldest first, as 'YYYY-MM'. */
function lastMonths(today, count = 12) {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const months = [];
  for (let index = 0; index < count; index++) {
    months.unshift(`${year}-${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

/** 'YYYY-MM' -> 'Nov 2026'. */
function monthLabel(key) {
  return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

/**
 * A one-series chart over months, with zero for months without rows.
 * @param {string[]} months  'YYYY-MM' keys
 * @param {Array<{ month: string, count: number }>} rows  several rows per month are added up
 */
function monthlyChart(months, rows, { label, type = 'bar', yLabel = label }) {
  const totals = new Map(months.map((month) => [month, 0]));
  for (const row of rows) {
    if (totals.has(row.month)) totals.set(row.month, totals.get(row.month) + Number(row.count || 0));
  }
  return {
    type,
    labels: months.map(monthLabel),
    series: [{ label, data: months.map((month) => totals.get(month)) }],
    xLabel: 'Month',
    yLabel,
  };
}

/** First and last day of the month of a date. */
function monthRange(today) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = today.slice(0, 7);
  return { from: `${prefix}-01`, to: `${prefix}-${String(lastDay).padStart(2, '0')}` };
}

module.exports = { lastMonths, monthLabel, monthlyChart, monthRange, MONTHS };
