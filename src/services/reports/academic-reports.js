'use strict';

/** Academic engagement and student-led event reports. */

const { sortedCounts, barChart } = require('./chart-data');

module.exports = {
  'academic-engagements': ({ queries, from, to }) => {
    const rows = queries.academicEngagements(from, to);
    return {
      rows,
      chartData: barChart(
        sortedCounts(rows, (row) => row.Type),
        'Engagements',
        '#7209b7'
      ),
    };
  },

  'student-led-events': ({ queries, from, to }) => {
    const rows = queries.studentLedEvents(from, to);
    const completed = rows.filter((row) => row.Outcome === 'Completed').length;
    return {
      rows,
      chartData: {
        type: 'pie',
        labels: ['Completed', 'Pending'],
        datasets: [{ data: [completed, rows.length - completed], backgroundColor: ['#2ec4b6', '#ff9f1c'] }],
      },
    };
  },

  'guest-speakers': ({ queries, from, to }) => {
    const rows = queries.guestSpeakers(from, to);
    return {
      rows,
      chartData: barChart(
        sortedCounts(rows, (row) => row.Company, 15),
        'Speakers',
        '#3a0ca3'
      ),
    };
  },
};
