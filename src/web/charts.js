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

/**
 * A report's Chart.js data in the neutral style: bar or line only (pie and
 * doughnut become bars), at most two series (the second is the accent).
 * Returns null when there is nothing to draw or more than two series, where
 * the table says it better.
 * @param {{ type: string, labels: string[], datasets: Array<{ label?: string, data: number[] }>, indexAxis?: string }} chartData
 * @param {string} name  the report name, used as the axis label of a single unnamed series
 */
function fromReportChart(chartData, name) {
  if (!chartData || !Array.isArray(chartData.labels) || !chartData.labels.length) return null;
  const datasets = (chartData.datasets ?? []).filter((dataset) => Array.isArray(dataset.data));
  if (!datasets.length || datasets.length > 2) return null;
  if (datasets.every((dataset) => dataset.data.every((value) => !Number(value)))) return null;
  const type = chartData.type === 'line' ? 'line' : 'bar';
  const series = datasets.map((dataset) => ({
    label: dataset.label || name,
    data: dataset.data.map((value) => Number(value) || 0),
  }));
  const wasRound = chartData.type === 'pie' || chartData.type === 'doughnut';
  const horizontal = type === 'bar' && (chartData.indexAxis === 'y' || wasRound || chartData.labels.length > 12);
  // A fixed-height box holds about a dozen bars side by side, or two dozen points on a line.
  if (chartData.labels.length > (horizontal ? 12 : 24)) return null;
  return {
    type,
    labels: chartData.labels.map(String),
    series,
    horizontal,
    yLabel: series.length === 1 ? series[0].label : '',
    xLabel: '',
  };
}

module.exports = { lastMonths, monthLabel, monthlyChart, monthRange, fromReportChart, MONTHS };
