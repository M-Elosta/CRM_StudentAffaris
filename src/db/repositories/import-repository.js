'use strict';

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

/**
 * Look-ups the import needs: resolving employer and contact names to ids,
 * and finding records that an imported row would duplicate.
 * @param {import('better-sqlite3').Database} db
 */
function createImportRepository(db) {
  const statements = {
    companyByName: db.prepare('SELECT CompanyID FROM Company WHERE LOWER(TRIM(CompanyName)) = ?'),
    contactByEmail: db.prepare('SELECT ContactID FROM Contact WHERE LOWER(TRIM(EmailAddress)) = ?'),
    contactByName: db.prepare(
      'SELECT ContactID FROM Contact WHERE LOWER(TRIM(FirstName)) = ? AND LOWER(TRIM(LastName)) = ?'
    ),
  };

  /** Import entity → the query that finds an existing record the row would duplicate. */
  const duplicateQueries = new Map([
    [
      'Company',
      {
        statement: db.prepare('SELECT CompanyID AS id FROM Company WHERE LOWER(TRIM(CompanyName)) = ?'),
        params: (row) => [normalize(row.CompanyName)],
      },
    ],
    [
      'Contact',
      {
        statement: db.prepare(
          'SELECT ContactID AS id FROM Contact WHERE LOWER(TRIM(EmailAddress)) = ? AND CompanyID = ?'
        ),
        params: (row) => [normalize(row.EmailAddress), row.CompanyID],
      },
    ],
    [
      'Outreach',
      {
        statement: db.prepare(
          `SELECT OutreachEngagementID AS id FROM OutreachEngagement
           WHERE CompanyID = ? AND ContactID = ? AND InteractionDate = ? AND InteractionType = ?`
        ),
        params: (row) => [row.CompanyID, row.ContactID, row.InteractionDate, row.InteractionType || ''],
      },
    ],
    [
      'Recruitment',
      {
        statement: db.prepare(
          `SELECT RecruitmentID AS id FROM Recruitment
           WHERE CompanyID = ? AND LOWER(TRIM(OpportunityTitle)) = ? AND (? IS NULL OR DatePosted = ?)`
        ),
        params: (row) => [
          row.CompanyID,
          normalize(row.OpportunityTitle),
          row.DatePosted || null,
          row.DatePosted || null,
        ],
      },
    ],
    [
      'Career Event',
      {
        statement: db.prepare(
          'SELECT CareerEventID AS id FROM CareerEvent WHERE CompanyID = ? AND LOWER(TRIM(EventName)) = ? AND EventDate = ?'
        ),
        params: (row) => [row.CompanyID, normalize(row.EventName), row.EventDate],
      },
    ],
    [
      'Student-Led Event',
      {
        statement: db.prepare(
          `SELECT StudentLedEventID AS id FROM StudentLedEvent
           WHERE CompanyID = ? AND ProposalDate = ? AND LOWER(TRIM(StudentEmail)) = ?`
        ),
        params: (row) => [row.CompanyID, row.ProposalDate, normalize(row.StudentEmail)],
      },
    ],
    [
      'Academic Engagement',
      {
        statement: db.prepare(
          `SELECT EngagementID AS id FROM AcademicClassroomEngagement
           WHERE CompanyID = ? AND SessionDate = ? AND LOWER(TRIM(GuestSpeakerName)) = ?`
        ),
        params: (row) => [row.CompanyID, row.SessionDate, normalize(row.GuestSpeakerName)],
      },
    ],
    [
      'Hiring Feedback',
      {
        statement: db.prepare(
          'SELECT HiringFeedbackID AS id FROM HiringFeedback WHERE CompanyID = ? AND ContactID = ? AND DateReported = ?'
        ),
        params: (row) => [row.CompanyID, row.ContactID, row.DateReported],
      },
    ],
    [
      'Potential Collaboration',
      {
        statement: db.prepare('SELECT PotentialCollaborationID AS id FROM PotentialCollaboration WHERE CompanyID = ?'),
        params: (row) => [row.CompanyID],
      },
    ],
  ]);

  return {
    /** The id of the employer with this name (case and surrounding spaces ignored), or undefined. */
    findCompanyIdByName(name) {
      return statements.companyByName.get(normalize(name))?.CompanyID;
    },

    /** The id of a contact with this email address (case ignored), or undefined. */
    findContactIdByEmail(email) {
      return statements.contactByEmail.get(normalize(email))?.ContactID;
    },

    /** The id of a contact with this first and last name (case ignored), or undefined. */
    findContactIdByName(firstName, lastName) {
      return statements.contactByName.get(normalize(firstName), normalize(lastName))?.ContactID;
    },

    /**
     * The id of an existing record the row would duplicate, or undefined.
     * The caller makes sure the row holds the fields the entity's rule needs,
     * as strings or numbers.
     */
    findDuplicateId(entity, row) {
      const query = duplicateQueries.get(entity);
      return query ? query.statement.get(...query.params(row))?.id : undefined;
    },
  };
}

module.exports = { createImportRepository };
