'use strict';

/**
 * The reports people can run, grouped as the reports page shows them, with a
 * name and one line about each. Every type here is a key of QUICK_REPORTS.
 *
 * sensitive  the report lists personal contact details, student names or
 *            internal notes, so it needs sensitive:read
 * period     false for reports of the current state, which ignore the date range
 */
const REPORT_CATALOG = Object.freeze([
  {
    group: 'Contact lists',
    reports: [
      { type: 'mailable-contacts', name: 'Mailable contacts', description: 'Contacts who may receive email.' },
      { type: 'event-invitation', name: 'Event invitation list', description: 'Contacts to invite to events.' },
      { type: 'resume-book', name: 'Resume book', description: 'Contacts who receive the student resume book.' },
      { type: 'non-mailable', name: 'Non-mailable contacts', description: 'Contacts who must not be emailed.' },
      { type: 'primary-contacts', name: 'Primary contacts', description: 'The main contact at each employer.' },
      { type: 'alumni-contacts', name: 'Alumni contacts', description: 'CMU-Q graduates working at employers.' },
    ].map((report) => ({ ...report, sensitive: true, period: false })),
  },
  {
    group: 'Employers',
    reports: [
      { type: 'all-companies', name: 'All employers', description: 'Every employer added in the period.' },
      {
        type: 'blacklisted-companies',
        name: 'Do not engage',
        description: 'Employers marked do not engage, with the notes about them.',
        sensitive: true,
        period: false,
      },
      { type: 'companies-by-country', name: 'Employers by country', description: 'How many employers per country.' },
      { type: 'companies-by-sector', name: 'Employers by sector', description: 'How many employers per sector.' },
      { type: 'favorite-employers', name: 'Key partners', description: 'Employers marked as key partners.' },
      { type: 'new-companies', name: 'New employers', description: 'Employers added, month by month.' },
      { type: 'mou-partners', name: 'MoU partners', description: 'Employers with a signed MoU.', period: false },
    ],
  },
  {
    group: 'Engagement',
    reports: [
      {
        type: 'followup-actions',
        name: 'Follow-up actions',
        description: 'Follow-ups overdue and due this week.',
        period: false,
      },
      { type: 'engagement-summary', name: 'Engagement summary', description: 'Activity of every kind per employer.' },
      {
        type: 'inactive-companies',
        name: 'Inactive employers',
        description: 'Employers with no activity in the period.',
      },
      { type: 'monthly-activity', name: 'Monthly activity', description: 'Activity of every kind, month by month.' },
    ],
  },
  {
    group: 'Recruitment and hiring',
    reports: [
      { type: 'recruitment-postings', name: 'Postings', description: 'Jobs and internships posted in the period.' },
      { type: 'recruitment-by-major', name: 'Postings by major', description: 'Postings per target major.' },
      {
        type: 'hiring-outcomes',
        name: 'Hiring outcomes',
        description: 'Reported hires, with the students’ names.',
        sensitive: true,
      },
      {
        type: 'career-event-attendance',
        name: 'Career event attendance',
        description: 'Employers registered at career events and who came.',
      },
      { type: 'hiring-trends', name: 'Hiring trends', description: 'Reported hires, month by month.' },
    ],
  },
  {
    group: 'Academic and student-led',
    reports: [
      {
        type: 'academic-engagements',
        name: 'Academic engagements',
        description: 'Guest lectures, panels and other classroom sessions.',
      },
      {
        type: 'student-led-events',
        name: 'Student-led events',
        description: 'Events student organisations ran with employers.',
        sensitive: true,
      },
      { type: 'guest-speakers', name: 'Guest speakers', description: 'Speakers per employer.' },
    ],
  },
  {
    group: 'Trends',
    reports: [
      { type: 'industry-trends', name: 'Industry trends', description: 'Recruitment and engagement by industry.' },
      {
        type: 'opportunities-per-semester',
        name: 'Opportunities per semester',
        description: 'Industries and employers behind each semester’s opportunities.',
      },
      { type: 'top-recruiters', name: 'Top recruiters', description: 'Employers ranked against the previous period.' },
      {
        type: 'top-roles-by-program',
        name: 'Top roles by programme',
        description: 'The most common opportunities per target major.',
      },
      { type: 'activity-mix', name: 'Activity mix', description: 'How the kinds of activity shift over time.' },
      {
        type: 'year-over-year-comparison',
        name: 'Year-over-year comparison',
        description: 'Engagement and recruitment across academic years.',
      },
      { type: 'sector-engagement', name: 'Sector engagement', description: 'Activity per sector, by semester.' },
      { type: 'hiring-conversion', name: 'Hiring conversion', description: 'Postings against hires, by semester.' },
      {
        type: 'semester-comparison',
        name: 'Semester comparison',
        description: 'Key figures of one period beside the one before.',
      },
    ],
  },
]);

const BY_TYPE = new Map(
  REPORT_CATALOG.flatMap((group) =>
    group.reports.map((report) => [report.type, { sensitive: false, period: true, ...report, group: group.group }])
  )
);

module.exports = { REPORT_CATALOG, REPORT_BY_TYPE: BY_TYPE };
