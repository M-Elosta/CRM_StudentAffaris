'use strict';

/**
 * The one rule of the Trash, as SQL. A record is live when its own DeletedAt
 * is NULL and, for every record that belongs to an employer, the employer's
 * DeletedAt is NULL too: deleting an employer hides its contacts and its
 * activity without flagging them, and restoring it brings them back.
 *
 * A deleted contact does not hide the activity that refers to it; that
 * activity names the contact with CONTACT_DELETED_SUFFIX.
 *
 * Every fragment here is fixed text; table names come from the callers'
 * own constants, never from a request.
 */

/** The record tables that carry DeletedAt; every one but Company belongs to an employer. */
const RECORD_TABLES = Object.freeze([
  'Company',
  'Contact',
  'OutreachEngagement',
  'Recruitment',
  'CareerEvent',
  'StudentLedEvent',
  'AcademicClassroomEngagement',
  'HiringFeedback',
  'PotentialCollaboration',
]);

/** Shown after the name of a contact that is in the Trash. */
const CONTACT_DELETED_SUFFIX = ' (deleted)';

/** "alias.DeletedAt IS NULL": the record itself is not in the Trash. */
const notDeleted = (alias) => `${alias}.DeletedAt IS NULL`;

/**
 * A table expression of the live rows of a record table, for a FROM or JOIN
 * clause in place of the bare table name: `FROM ${liveTable('Contact')} co`.
 * @param {string} table  one of RECORD_TABLES
 */
function liveTable(table) {
  if (!RECORD_TABLES.includes(table)) throw new Error(`Not a record table: ${table}`);
  if (table === 'Company') return '(SELECT * FROM Company WHERE DeletedAt IS NULL)';
  return `(SELECT lt.* FROM ${table} lt JOIN Company lc ON lc.CompanyID = lt.CompanyID
    WHERE lt.DeletedAt IS NULL AND lc.DeletedAt IS NULL)`;
}

/**
 * The full name of a contact (alias), followed by " (deleted)" when the
 * contact is in the Trash.
 * @param {string} alias
 */
const contactNameSql = (alias) =>
  `(${alias}.FirstName || ' ' || ${alias}.LastName || CASE WHEN ${alias}.DeletedAt IS NULL THEN '' ELSE '${CONTACT_DELETED_SUFFIX}' END)`;

module.exports = { RECORD_TABLES, CONTACT_DELETED_SUFFIX, notDeleted, liveTable, contactNameSql };
