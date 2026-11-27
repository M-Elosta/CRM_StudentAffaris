'use strict';

/**
 * Contact lists. These are current-state lists (mailing status, flags,
 * alumni status), so they ignore the period filter and always show the live set.
 */

const { SNAPSHOT_META, sortedCounts, pieChart, barChart } = require('./chart-data');

const byCompany = (row) => row.Company;
const byMajor = (row) => row.Major || 'Not Set';

module.exports = {
  'mailable-contacts': ({ queries }) => {
    const rows = queries.mailableContacts();
    return { rows, chartData: pieChart(sortedCounts(rows, byCompany)), meta: SNAPSHOT_META };
  },

  'event-invitation': ({ queries }) => {
    const rows = queries.eventInvitationContacts();
    return { rows, chartData: barChart(sortedCounts(rows, byCompany, 20), 'Contacts', '#4361ee'), meta: SNAPSHOT_META };
  },

  'resume-book': ({ queries }) => {
    const rows = queries.resumeBookContacts();
    return { rows, chartData: barChart(sortedCounts(rows, byMajor), 'Contacts', '#2ec4b6'), meta: SNAPSHOT_META };
  },

  'non-mailable': ({ queries }) => {
    const rows = queries.nonMailableContacts();
    const blacklisted = rows.filter((row) => row.Reason === 'Blacklisted Company').length;
    return {
      rows,
      chartData: {
        type: 'pie',
        labels: ['Blacklisted Company', 'Manually Set'],
        datasets: [{ data: [blacklisted, rows.length - blacklisted], backgroundColor: ['#e71d36', '#adb5bd'] }],
      },
      meta: SNAPSHOT_META,
    };
  },

  'primary-contacts': ({ queries }) => {
    const rows = queries.primaryContacts();
    return {
      rows,
      chartData: barChart(sortedCounts(rows, byCompany, 20), 'Primary Contacts', '#f72585'),
      meta: SNAPSHOT_META,
    };
  },

  'alumni-contacts': ({ queries }) => {
    const rows = queries.alumniContacts();
    return { rows, chartData: barChart(sortedCounts(rows, byMajor), 'Alumni', '#7209b7'), meta: SNAPSHOT_META };
  },
};
