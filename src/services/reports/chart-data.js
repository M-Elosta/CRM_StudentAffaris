'use strict';

/** Chart colour palette, the same as the dashboard's. */
const PALETTE = [
  '#4361ee',
  '#f72585',
  '#4cc9f0',
  '#2ec4b6',
  '#ff9f1c',
  '#e71d36',
  '#3a0ca3',
  '#7209b7',
  '#06d6a0',
  '#118ab2',
  '#ffd166',
  '#ef476f',
];

/** Meta for the current-state lists, which ignore the period filter. */
const SNAPSHOT_META = Object.freeze({ periodLabel: 'Current records', periodMode: 'snapshot' });

/** 'YYYY-MM...' → 'Mar 2025'; 'Unknown' for an empty value. */
function monthLabel(value) {
  if (!value) return 'Unknown';
  const date = new Date(`${value.slice(0, 7)}-01`);
  return Number.isNaN(date.getTime())
    ? value.slice(0, 7)
    : date.toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Count rows by a key and return [key, count] pairs, largest first.
 * @param {object[]} rows
 * @param {(row: object) => string} keyOf
 * @param {number} [limit]
 */
function sortedCounts(rows, keyOf, limit) {
  const counts = {};
  for (const row of rows) {
    const key = keyOf(row);
    counts[key] = (counts[key] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return limit === undefined ? sorted : sorted.slice(0, limit);
}

/** A single-series pie chart from [label, count] pairs. */
function pieChart(pairs) {
  return {
    type: 'pie',
    labels: pairs.map(([label]) => label),
    datasets: [{ data: pairs.map(([, count]) => count), backgroundColor: PALETTE }],
  };
}

/** A single-series bar chart from [label, count] pairs. */
function barChart(pairs, label, backgroundColor) {
  return {
    type: 'bar',
    labels: pairs.map(([name]) => name),
    datasets: [{ label, data: pairs.map(([, count]) => count), backgroundColor, borderRadius: 4 }],
  };
}

/** '▲ +3', '▼ -2' or '—' for a difference. */
function changeLabel(diff) {
  if (diff > 0) return `▲ +${diff}`;
  if (diff < 0) return `▼ ${diff}`;
  return '—';
}

module.exports = { PALETTE, SNAPSHOT_META, monthLabel, sortedCounts, pieChart, barChart, changeLabel };
