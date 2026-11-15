'use strict';

/**
 * Company queries that go beyond generic CRUD: counts of the records that
 * belong to an employer, and the blacklist rule for its contacts.
 * @param {import('better-sqlite3').Database} db
 */
function createCompaniesRepository(db) {
  const countIn = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE CompanyID = ?`);
  const counters = {
    contacts: countIn('Contact'),
    outreach: countIn('OutreachEngagement'),
    recruitment: countIn('Recruitment'),
    events: countIn('CareerEvent'),
    academic: countIn('AcademicClassroomEngagement'),
    studentEvents: countIn('StudentLedEvent'),
  };
  const markNonMailable = db.prepare("UPDATE Contact SET Status = 'Non-mailable' WHERE CompanyID = ?");

  return {
    /** Number of contacts, outreach records, postings, career events, academic engagements and student events. */
    countRelatedRecords(companyId) {
      return Object.fromEntries(Object.entries(counters).map(([key, statement]) => [key, statement.get(companyId).n]));
    },

    /** Set every contact of the company to Non-mailable. */
    markContactsNonMailable(companyId) {
      return markNonMailable.run(companyId).changes;
    },
  };
}

module.exports = { createCompaniesRepository };
