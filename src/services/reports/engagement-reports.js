'use strict';

/** Engagement and activity reports. */

const { addDaysToIsoDate } = require('../../lib/dates');
const { monthLabel, sortedCounts, pieChart } = require('./chart-data');

/** The modules of the monthly activity report, in display order. */
const MONTHLY_MODULES = [
  { key: 'outreach', name: 'Outreach', color: '#4361ee' },
  { key: 'recruitment', name: 'Recruitment', color: '#f72585' },
  { key: 'careerEvents', name: 'Career Events', color: '#4cc9f0' },
  { key: 'academic', name: 'Academic', color: '#2ec4b6' },
  { key: 'studentEvents', name: 'Student Events', color: '#ff9f1c' },
];

module.exports = {
  // Open follow-ups, whatever the period: overdue, due within a week, or later.
  'followup-actions': ({ queries, today }) => {
    const rows = queries.followUpActions(today, addDaysToIsoDate(today, 7));
    const counts = { overdue: 0, 'this-week': 0, upcoming: 0 };
    for (const row of rows) counts[row._urgency] = (counts[row._urgency] || 0) + 1;
    return {
      rows,
      chartData: {
        type: 'bar',
        labels: ['Overdue', 'Due This Week', 'Upcoming'],
        datasets: [
          {
            label: 'Follow-ups',
            data: [counts.overdue, counts['this-week'], counts.upcoming],
            backgroundColor: ['#e71d36', '#ff9f1c', '#4361ee'],
            borderRadius: 4,
          },
        ],
      },
    };
  },

  'engagement-summary': ({ queries, from, to }) => {
    const rows = queries
      .engagementSummary(from, to)
      .map((row) => ({
        ...row,
        Total:
          row.Outreach +
          row.Recruitment +
          row['Career Events'] +
          row.Academic +
          row['Student Events'] +
          row['Hiring Feedback'],
      }))
      .sort((a, b) => b.Total - a.Total);
    const top = rows.slice(0, 15);
    return {
      rows,
      chartData: {
        type: 'bar',
        indexAxis: 'y',
        labels: top.map((row) => row.Company),
        datasets: [
          { label: 'Total Engagements', data: top.map((row) => row.Total), backgroundColor: '#4361ee', borderRadius: 4 },
        ],
      },
    };
  },

  'inactive-companies': ({ queries, from, to }) => {
    const rows = queries.inactiveCompanies(from, to);
    return { rows, chartData: pieChart(sortedCounts(rows, (row) => row.Sector || 'Unknown')) };
  },

  'monthly-activity': ({ queries, from, to }) => {
    const perModule = queries.monthlyActivity(from, to);
    const monthData = {};
    for (const source of MONTHLY_MODULES) {
      for (const { m, n } of perModule[source.key]) {
        monthData[m] = monthData[m] || {};
        monthData[m][source.name] = n;
      }
    }
    const months = Object.keys(monthData).sort();
    const rows = months.map((month) => {
      const entry = { Month: monthLabel(`${month}-01`) };
      for (const source of MONTHLY_MODULES) entry[source.name] = monthData[month][source.name] || 0;
      entry.Total = MONTHLY_MODULES.reduce((sum, source) => sum + (monthData[month][source.name] || 0), 0);
      return entry;
    });
    return {
      rows,
      chartData: {
        type: 'bar',
        labels: months.map((month) => monthLabel(`${month}-01`)),
        datasets: MONTHLY_MODULES.map((source) => ({
          label: source.name,
          data: months.map((month) => monthData[month][source.name] || 0),
          backgroundColor: source.color,
          borderRadius: 2,
          stack: 'stack',
        })),
      },
    };
  },
};
