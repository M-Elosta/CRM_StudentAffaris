'use strict';

/** Response key → table, for /api/meta/last-updated. */
const LAST_UPDATED_TABLES = Object.freeze({
  companies: 'Company',
  contacts: 'Contact',
  outreach: 'OutreachEngagement',
  recruitment: 'Recruitment',
  careerEvents: 'CareerEvent',
  studentEvents: 'StudentLedEvent',
  academic: 'AcademicClassroomEngagement',
  hiringFeedback: 'HiringFeedback',
  collaboration: 'PotentialCollaboration',
});

/**
 * Small queries about the database as a whole.
 * @param {import('better-sqlite3').Database} db
 */
function createMetaRepository(db) {
  // The later of UpdatedAt and CreatedAt of every row; NULLs are ignored.
  const latestChange = Object.entries(LAST_UPDATED_TABLES).map(([key, table]) => [
    key,
    db.prepare(
      `SELECT MAX(MAX(COALESCE(UpdatedAt, CreatedAt), COALESCE(CreatedAt, UpdatedAt))) AS ts FROM ${table}`
    ),
  ]);

  return {
    /** The latest creation or edit timestamp of each record type, or null when it has no rows. */
    lastUpdated() {
      return Object.fromEntries(latestChange.map(([key, statement]) => [key, statement.get().ts ?? null]));
    },

    /** Run a trivial query; throws when the database cannot be used. */
    ping() {
      db.prepare('SELECT 1').get();
    },
  };
}

module.exports = { createMetaRepository };
