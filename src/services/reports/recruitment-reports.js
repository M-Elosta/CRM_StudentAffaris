'use strict';

/** Recruitment and hiring reports. */

const { monthLabel } = require('./chart-data');

const CAREER_EVENT_STATUSES = ['Attended', 'No-Show', 'Cancelled'];

module.exports = {
  'recruitment-postings': ({ queries, from, to }) => {
    const rows = queries.recruitmentPostings(from, to);
    const byMode = {};
    for (const row of rows) byMode[row.Mode] = (byMode[row.Mode] || 0) + 1;
    return {
      rows,
      chartData: {
        type: 'bar',
        labels: Object.keys(byMode),
        datasets: [
          {
            label: 'Postings',
            data: Object.values(byMode),
            backgroundColor: ['#4361ee', '#f72585', '#4cc9f0'],
            borderRadius: 4,
          },
        ],
      },
    };
  },

  'recruitment-by-major': ({ queries, from, to }) => {
    const rows = queries.recruitmentByMajor(from, to);
    return {
      rows,
      chartData: {
        type: 'bar',
        labels: rows.map((row) => row.Major),
        datasets: [
          {
            label: 'Paid',
            data: rows.map((row) => row['Paid Count']),
            backgroundColor: '#2ec4b6',
            borderRadius: 4,
            stack: 's',
          },
          {
            label: 'Unpaid',
            data: rows.map((row) => row['Unpaid Count']),
            backgroundColor: '#adb5bd',
            borderRadius: 4,
            stack: 's',
          },
        ],
      },
    };
  },

  'hiring-outcomes': ({ queries, from, to }) => {
    const rows = queries.hiringOutcomes(from, to);
    const hired = rows.filter((row) => row['Hired?'] === 'Yes').length;
    return {
      rows,
      chartData: {
        type: 'pie',
        labels: ['Hired (Yes)', 'Not Hired (No)'],
        datasets: [{ data: [hired, rows.length - hired], backgroundColor: ['#2ec4b6', '#e71d36'] }],
      },
    };
  },

  'career-event-attendance': ({ queries, from, to }) => {
    const rows = queries.careerEventAttendance(from, to);
    const byStatus = {};
    for (const row of rows) byStatus[row.Status] = (byStatus[row.Status] || 0) + 1;
    return {
      rows,
      chartData: {
        type: 'bar',
        labels: CAREER_EVENT_STATUSES,
        datasets: [
          {
            label: 'Events',
            data: CAREER_EVENT_STATUSES.map((status) => byStatus[status] || 0),
            backgroundColor: ['#2ec4b6', '#e71d36', '#adb5bd'],
            borderRadius: 4,
          },
        ],
      },
    };
  },

  'hiring-trends': ({ queries, from, to }) => {
    const rows = queries.hiresByMonth(from, to).map((row) => ({
      Month: monthLabel(`${row.m}-01`),
      'Hired Count': row.n,
      Companies: row.Companies,
    }));
    return {
      rows,
      chartData: {
        type: 'line',
        labels: rows.map((row) => row.Month),
        datasets: [
          {
            label: 'Hired Students/Alumni',
            data: rows.map((row) => row['Hired Count']),
            borderColor: '#2ec4b6',
            backgroundColor: 'rgba(46,196,182,0.1)',
            fill: true,
            tension: 0.3,
          },
        ],
      },
    };
  },
};
