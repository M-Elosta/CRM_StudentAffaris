'use strict';

/** The record tables whose rows count as an employer's activity, for the Trash messages. */
const ACTIVITY_TABLES = [
  'OutreachEngagement',
  'Recruitment',
  'CareerEvent',
  'StudentLedEvent',
  'AcademicClassroomEngagement',
  'HiringFeedback',
  'PotentialCollaboration',
];

/**
 * Company queries that go beyond generic CRUD: counts of the records that
 * belong to an employer, and the blacklist rule for its contacts. Counts
 * leave out records that are in the Trash themselves.
 * @param {import('better-sqlite3').Database} db
 */
function createCompaniesRepository(db) {
  const countIn = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE CompanyID = ? AND DeletedAt IS NULL`);
  const counters = {
    contacts: countIn('Contact'),
    outreach: countIn('OutreachEngagement'),
    recruitment: countIn('Recruitment'),
    events: countIn('CareerEvent'),
    academic: countIn('AcademicClassroomEngagement'),
    studentEvents: countIn('StudentLedEvent'),
  };
  const countActivities = db.prepare(
    `SELECT ${ACTIVITY_TABLES.map(
      (table) => `(SELECT COUNT(*) FROM ${table} WHERE CompanyID = @id AND DeletedAt IS NULL)`
    ).join(' + ')} AS n`
  );
  const markNonMailable = db.prepare("UPDATE Contact SET Status = 'Non-mailable' WHERE CompanyID = ?");

  return {
    /** Number of contacts, outreach records, postings, career events, academic engagements and student events. */
    countRelatedRecords(companyId) {
      return Object.fromEntries(Object.entries(counters).map(([key, statement]) => [key, statement.get(companyId).n]));
    },

    /**
     * How many contacts and activities (every other record type) belong to the
     * employer without being in the Trash themselves: what deleting the
     * employer hides with it, and what restoring it brings back.
     * @returns {{ contacts: number, activities: number }}
     */
    countHiddenWith(companyId) {
      return { contacts: counters.contacts.get(companyId).n, activities: countActivities.get({ id: companyId }).n };
    },

    /** Set every contact of the company to Non-mailable. */
    markContactsNonMailable(companyId) {
      return markNonMailable.run(companyId).changes;
    },
  };
}

module.exports = { createCompaniesRepository };
