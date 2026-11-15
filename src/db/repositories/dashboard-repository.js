'use strict';

/** ' AND column >= ? AND column <= ?' for whichever bounds are given, with their parameters. */
function rangeClause(column, from, to) {
  let sql = '';
  const params = [];
  if (from) {
    sql += ` AND ${column} >= ?`;
    params.push(from);
  }
  if (to) {
    sql += ` AND ${column} <= ?`;
    params.push(to);
  }
  return { sql, params };
}

/**
 * Queries behind the /api/dashboard endpoints. Every method takes an
 * optional, already validated { from, to } range.
 * @param {import('better-sqlite3').Database} db
 */
function createDashboardRepository(db) {
  const count = (sql, params) => db.prepare(sql).get(...params).n;

  return {
    /**
     * Headline counts. Without a range, upcoming follow-ups are those due on
     * or after `today`.
     */
    stats({ from, to, today }) {
      const added = rangeClause('DateAdded', from, to);
      const outreach = rangeClause('InteractionDate', from, to);
      const followUps =
        from || to ? rangeClause('FollowUpDate', from, to) : { sql: ' AND FollowUpDate >= ?', params: [today] };
      return {
        totalCompanies: count(`SELECT COUNT(*) AS n FROM Company WHERE Blacklisted = 0${added.sql}`, added.params),
        totalBlacklisted: count(`SELECT COUNT(*) AS n FROM Company WHERE Blacklisted = 1${added.sql}`, added.params),
        totalContacts: count(`SELECT COUNT(*) AS n FROM Contact WHERE 1 = 1${added.sql}`, added.params),
        mailableContacts: count(
          `SELECT COUNT(*) AS n FROM Contact WHERE Status = 'Mailable' AND ExcludeFromMailing = 0${added.sql}`,
          added.params
        ),
        outreachThisMonth: count(`SELECT COUNT(*) AS n FROM OutreachEngagement WHERE 1 = 1${outreach.sql}`, outreach.params),
        upcomingFollowUps: count(
          `SELECT COUNT(*) AS n FROM OutreachEngagement WHERE InteractionStatus = 'In-progress'${followUps.sql}`,
          followUps.params
        ),
      };
    },

    /** New non-blacklisted companies per month: [{ month, count }]. */
    companiesByMonth({ from, to }) {
      const range = rangeClause('DateAdded', from, to);
      return db
        .prepare(
          `SELECT strftime('%Y-%m', DateAdded) AS month, COUNT(*) AS count FROM Company
           WHERE Blacklisted = 0${range.sql} GROUP BY month ORDER BY month`
        )
        .all(...range.params);
    },

    /** Outreach interactions per month and type: [{ month, type, count }]. */
    outreachByMonth({ from, to }) {
      const range = rangeClause('InteractionDate', from, to);
      return db
        .prepare(
          `SELECT strftime('%Y-%m', InteractionDate) AS month, InteractionType AS type, COUNT(*) AS count
           FROM OutreachEngagement WHERE 1 = 1${range.sql} GROUP BY month, type ORDER BY month`
        )
        .all(...range.params);
    },

    /** Non-blacklisted companies per sector: [{ label, count }]. */
    companiesBySector({ from, to }) {
      const range = rangeClause('DateAdded', from, to);
      return db
        .prepare(
          `SELECT Sector AS label, COUNT(*) AS count FROM Company
           WHERE Blacklisted = 0${range.sql} GROUP BY Sector ORDER BY count DESC`
        )
        .all(...range.params);
    },

    /** Recruitment postings per target major: [{ label, count }]. */
    recruitmentByMajor({ from, to }) {
      const range = rangeClause('r.DatePosted', from, to);
      return db
        .prepare(
          `SELECT m.Major AS label, COUNT(*) AS count
           FROM Recruitment_TargetMajors m JOIN Recruitment r ON m.RecruitmentID = r.RecruitmentID
           WHERE 1 = 1${range.sql} GROUP BY m.Major ORDER BY count DESC`
        )
        .all(...range.params);
    },

    /** Career event registrations per event and status: [{ EventName, status, count }]. */
    eventAttendance({ from, to }) {
      const range = rangeClause('EventDate', from, to);
      return db
        .prepare(
          `SELECT EventName, RegisteredStatus AS status, COUNT(*) AS count FROM CareerEvent
           WHERE 1 = 1${range.sql} GROUP BY EventName, RegisteredStatus ORDER BY EventName`
        )
        .all(...range.params);
    },

    /** The ten companies with the most outreach, postings, career events and academic sessions. */
    topEngaged({ from, to }) {
      const outreach = rangeClause('InteractionDate', from, to);
      const postings = rangeClause('DatePosted', from, to);
      const events = rangeClause('EventDate', from, to);
      const sessions = rangeClause('SessionDate', from, to);
      return db
        .prepare(
          `SELECT c.CompanyName AS company,
             (SELECT COUNT(*) FROM OutreachEngagement WHERE CompanyID = c.CompanyID${outreach.sql}) +
             (SELECT COUNT(*) FROM Recruitment WHERE CompanyID = c.CompanyID${postings.sql}) +
             (SELECT COUNT(*) FROM CareerEvent WHERE CompanyID = c.CompanyID${events.sql}) +
             (SELECT COUNT(*) FROM AcademicClassroomEngagement WHERE CompanyID = c.CompanyID${sessions.sql}) AS total
           FROM Company c
           ORDER BY total DESC LIMIT 10`
        )
        .all(...outreach.params, ...postings.params, ...events.params, ...sessions.params);
    },

    /** Students or alumni reported hired, per month: [{ month, count }]. */
    hiringTrends({ from, to }) {
      const range = rangeClause('DateReported', from, to);
      return db
        .prepare(
          `SELECT strftime('%Y-%m', DateReported) AS month, COUNT(*) AS count FROM HiringFeedback
           WHERE HiredStudentAlumni = 'Yes'${range.sql} GROUP BY month ORDER BY month`
        )
        .all(...range.params);
    },
  };
}

module.exports = { createDashboardRepository };
