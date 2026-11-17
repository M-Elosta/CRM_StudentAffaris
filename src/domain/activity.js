'use strict';

/**
 * The activity record types: everything that counts as "contact" with an
 * employer. Used for an employer's timeline, the dashboard's recent
 * activity and the "last contact" date.
 *
 * Every SQL fragment here is fixed text; nothing from a request is ever
 * interpolated. `summary` and `title` are expressions over the table's own
 * columns (alias x) and never read a sensitive field.
 */
const ACTIVITY_SOURCES = Object.freeze([
  {
    type: 'outreach',
    label: 'Interaction',
    table: 'OutreachEngagement',
    idColumn: 'OutreachEngagementID',
    dateColumn: 'InteractionDate',
    hasContact: true,
    title: 'x.InteractionType',
    summary: 'x.DiscussionItems',
  },
  {
    type: 'recruitment',
    label: 'Posting',
    table: 'Recruitment',
    idColumn: 'RecruitmentID',
    dateColumn: 'DatePosted',
    hasContact: true,
    title: "'Posting'",
    summary: 'x.OpportunityTitle',
  },
  {
    type: 'career-events',
    label: 'Career event',
    table: 'CareerEvent',
    idColumn: 'CareerEventID',
    dateColumn: 'EventDate',
    hasContact: true,
    title: "'Career event'",
    summary: "x.EventName || ' (' || x.RegisteredStatus || ')'",
  },
  {
    type: 'student-events',
    label: 'Student-led event',
    table: 'StudentLedEvent',
    idColumn: 'StudentLedEventID',
    dateColumn: 'ProposalDate',
    hasContact: true,
    title: "'Student-led event'",
    summary: "COALESCE(x.EventTitle, x.OrganizationName) || ' (' || x.CollaborationOutcome || ')'",
  },
  {
    type: 'academic',
    label: 'Academic engagement',
    table: 'AcademicClassroomEngagement',
    idColumn: 'EngagementID',
    dateColumn: 'SessionDate',
    hasContact: true,
    title: 'x.EngagementType',
    summary: "x.CourseNumber || ' ' || x.CourseTitle || ': ' || x.TopicTheme",
  },
  {
    type: 'hiring-feedback',
    label: 'Hiring outcome',
    table: 'HiringFeedback',
    idColumn: 'HiringFeedbackID',
    dateColumn: 'DateReported',
    hasContact: true,
    title: "'Hiring outcome'",
    summary: "'Hired: ' || x.HiredStudentAlumni || ', reported by ' || x.FeedbackProvider",
  },
]);

/**
 * A common table expression `last_activity(CompanyID, LastContactAt)`: the
 * most recent activity date of each employer, across every activity type,
 * up to and including today, ignoring activity in the Trash. Join it to live
 * employers only. Takes one parameter: today's date (YYYY-MM-DD).
 */
const LAST_ACTIVITY_CTE = `last_activity AS (
  SELECT CompanyID, MAX(d) AS LastContactAt FROM (
    ${ACTIVITY_SOURCES.map(
      (source) => `SELECT CompanyID, ${source.dateColumn} AS d FROM ${source.table} WHERE DeletedAt IS NULL`
    ).join('\n    UNION ALL ')}
  ) WHERE d <= ? GROUP BY CompanyID
)`;

/** An employer is dormant after this many days without activity. */
const DORMANT_AFTER_DAYS = 180;

module.exports = { ACTIVITY_SOURCES, LAST_ACTIVITY_CTE, DORMANT_AFTER_DAYS };
