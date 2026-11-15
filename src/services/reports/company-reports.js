'use strict';

/** Company reports: lists and breakdowns of employers. */

const { PALETTE, monthLabel, sortedCounts, pieChart, barChart } = require('./chart-data');

const bySector = (row) => row.Sector;

module.exports = {
  'all-companies': ({ queries, from, to }) => {
    const rows = queries.allCompanies(from, to);
    return { rows, chartData: pieChart(sortedCounts(rows, bySector)) };
  },

  // Current state: every blacklisted employer, whatever the period.
  'blacklisted-companies': ({ queries }) => {
    const rows = queries.blacklistedCompanies();
    return { rows, chartData: barChart(sortedCounts(rows, (row) => row.Industry || 'Unknown'), 'Blacklisted', '#e71d36') };
  },

  'companies-by-country': ({ queries, from, to }) => {
    const rows = queries.companiesByCountry(from, to);
    return {
      rows,
      chartData: {
        type: 'bar',
        indexAxis: 'y',
        labels: rows.map((row) => row.Country),
        datasets: [
          {
            label: 'Companies',
            data: rows.map((row) => row['Company Count']),
            backgroundColor: '#4361ee',
            borderRadius: 4,
          },
        ],
      },
    };
  },

  'companies-by-sector': ({ queries, from, to }) => {
    const rows = queries.companiesBySector(from, to);
    return {
      rows,
      chartData: {
        type: 'doughnut',
        labels: rows.map((row) => row.Sector),
        datasets: [{ data: rows.map((row) => row['Company Count']), backgroundColor: PALETTE }],
      },
    };
  },

  'favorite-employers': ({ queries, from, to }) => {
    const rows = queries.favoriteEmployers(from, to);
    return { rows, chartData: barChart(sortedCounts(rows, bySector), 'Favorites', '#ff9f1c') };
  },

  'new-companies': ({ queries, from, to }) => {
    const rows = queries.newCompanies(from, to);
    const perMonth = {};
    for (const row of rows) {
      const month = (row['Date Added'] || '').slice(0, 7);
      if (month) perMonth[month] = (perMonth[month] || 0) + 1;
    }
    const months = Object.keys(perMonth).sort();
    return {
      rows,
      chartData: {
        type: 'line',
        labels: months.map(monthLabel),
        datasets: [
          {
            label: 'New Companies',
            data: months.map((month) => perMonth[month]),
            borderColor: '#4361ee',
            backgroundColor: 'rgba(67,97,238,0.1)',
            fill: true,
            tension: 0.3,
          },
        ],
      },
    };
  },

  // Current state: every employer with a signed MoU, whatever the period.
  'mou-partners': ({ queries }) => {
    const rows = queries.mouPartners();
    return { rows, chartData: pieChart(sortedCounts(rows, bySector)) };
  },
};
