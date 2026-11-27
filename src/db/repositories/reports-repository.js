'use strict';

const { liveTable, contactNameSql } = require('../../domain/live');

/**
 * Every query behind the quick reports. Each reads live records only
 * (src/domain/live.js): records in the Trash and everything that belongs to
 * a deleted employer are left out. Activity keeps a deleted contact's name,
 * followed by " (deleted)". Methods take already validated
 * YYYY-MM-DD bounds (from/to may be null) and return plain rows; the report
 * modules in src/services/reports shape them into tables and charts.
 */

/** ' AND column >= ? AND column <= ?' for whichever bounds are given, with their parameters. */
function dateClause(column, from, to) {
  const parts = [];
  const params = [];
  if (from) {
    parts.push(`${column} >= ?`);
    params.push(from);
  }
  if (to) {
    parts.push(`${column} <= ?`);
    params.push(to);
  }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
}

const CONTACT_LIST_COLUMNS = `co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
       co.EmailAddress AS "Email", co.JobTitle AS "Job Title",
       COALESCE(co.WorkPhone, co.Mobile) AS "Phone", COALESCE(co.Country, c.Country) AS "Country"`;

const MAILABLE = "co.Status='Mailable' AND co.ExcludeFromMailing=0 AND c.Blacklisted=0";

/** Activity tables with their date column, for the per-company activity counts. */
const COMPANY_ACTIVITY = [
  { table: 'OutreachEngagement', dateColumn: 'InteractionDate' },
  { table: 'Recruitment', dateColumn: 'DatePosted' },
  { table: 'CareerEvent', dateColumn: 'EventDate' },
  { table: 'AcademicClassroomEngagement', dateColumn: 'SessionDate' },
  { table: 'StudentLedEvent', dateColumn: 'ProposalDate' },
  { table: 'HiringFeedback', dateColumn: 'DateReported' },
];

/**
 * @param {import('better-sqlite3').Database} db
 */
function createReportsRepository(db) {
  const all = (sql, params = []) => db.prepare(sql).all(...params);
  const get = (sql, params = []) => db.prepare(sql).get(...params);

  /** Per-company activity filters for engagement-summary and inactive-companies, in COMPANY_ACTIVITY order. */
  function activityFilters(from, to) {
    const clauses = COMPANY_ACTIVITY.map(({ dateColumn }) => dateClause(dateColumn, from, to));
    return { sql: clauses.map((clause) => clause.sql), params: clauses.flatMap((clause) => clause.params) };
  }

  /** Rows of `sql` (a SELECT ... WHERE ... without the date filter) limited to the range on `dateColumn`. */
  function datesBetween(sql, dateColumn, from, to) {
    const range = dateClause(dateColumn, from, to);
    return all(`${sql}${range.sql}`, range.params);
  }

  return {
    // ── Shared ──────────────────────────────────────────────────────────────

    /** Earliest and latest activity date across all record types: { minDate, maxDate }. */
    dateBounds() {
      return get(`
        SELECT MIN(d) AS minDate, MAX(d) AS maxDate
        FROM (
          SELECT DateAdded AS d FROM ${liveTable('Company')}
          UNION ALL SELECT DateAdded FROM ${liveTable('Contact')}
          UNION ALL SELECT InteractionDate FROM ${liveTable('OutreachEngagement')}
          UNION ALL SELECT DatePosted FROM ${liveTable('Recruitment')}
          UNION ALL SELECT DateReported FROM ${liveTable('HiringFeedback')}
          UNION ALL SELECT EventDate FROM ${liveTable('CareerEvent')}
          UNION ALL SELECT ProposalDate FROM ${liveTable('StudentLedEvent')}
          UNION ALL SELECT SessionDate FROM ${liveTable('AcademicClassroomEngagement')}
        )
        WHERE d IS NOT NULL AND d != ''`);
    },

    // ── Contact lists (current state, no date filter) ───────────────────────

    mailableContacts() {
      return all(`
        SELECT ${CONTACT_LIST_COLUMNS}
        FROM ${liveTable('Contact')} co JOIN ${liveTable('Company')} c ON co.CompanyID=c.CompanyID
        WHERE ${MAILABLE}
        ORDER BY c.CompanyName, co.LastName`);
    },

    eventInvitationContacts() {
      return all(`
        SELECT ${CONTACT_LIST_COLUMNS}
        FROM ${liveTable('Contact')} co JOIN ${liveTable('Company')} c ON co.CompanyID=c.CompanyID
        WHERE co.EventInvitation=1 AND ${MAILABLE}
        ORDER BY c.CompanyName, co.LastName`);
    },

    resumeBookContacts() {
      return all(`
        SELECT ${CONTACT_LIST_COLUMNS},
               co.Major AS "Major", co.GraduationYear AS "Grad Year"
        FROM ${liveTable('Contact')} co JOIN ${liveTable('Company')} c ON co.CompanyID=c.CompanyID
        WHERE co.ResumeBook=1 AND ${MAILABLE}
        ORDER BY co.Major, co.LastName`);
    },

    nonMailableContacts() {
      return all(`
        SELECT co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
               co.EmailAddress AS "Email",
               CASE WHEN c.Blacklisted=1 THEN 'Blacklisted Company' ELSE 'Manually Set' END AS "Reason"
        FROM ${liveTable('Contact')} co JOIN ${liveTable('Company')} c ON co.CompanyID=c.CompanyID
        WHERE co.Status='Non-mailable'
        ORDER BY co.LastName`);
    },

    primaryContacts() {
      return all(`
        SELECT co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
               co.EmailAddress AS "Email", co.JobTitle AS "Job Title",
               COALESCE(co.WorkPhone, co.Mobile) AS "Phone"
        FROM ${liveTable('Contact')} co JOIN ${liveTable('Company')} c ON co.CompanyID=c.CompanyID
        WHERE co.PrimaryContact=1 AND ${MAILABLE}
        ORDER BY c.CompanyName, co.LastName`);
    },

    alumniContacts() {
      return all(`
        SELECT co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
               co.Major AS "Major", co.GraduationYear AS "Grad Year",
               co.EmailAddress AS "Email", co.JobTitle AS "Job Title"
        FROM ${liveTable('Contact')} co JOIN ${liveTable('Company')} c ON co.CompanyID=c.CompanyID
        WHERE co.CMUQGraduate=1 AND c.Blacklisted=0
        ORDER BY co.GraduationYear DESC, co.LastName`);
    },

    // ── Companies ───────────────────────────────────────────────────────────

    allCompanies(from, to) {
      const range = dateClause('c.DateAdded', from, to);
      return all(
        `SELECT c.CompanyName AS "Name", c.Industry, c.Sector, c.Country,
                date(c.DateAdded) AS "Date Added", c.Website,
                CASE WHEN c.SignedMoU=1 THEN 'Yes' ELSE 'No' END AS "Signed MoU",
                CASE WHEN c.FavoriteEmployer=1 THEN 'Yes' ELSE 'No' END AS "Favorite"
         FROM ${liveTable('Company')} c WHERE c.Blacklisted=0${range.sql}
         ORDER BY c.CompanyName`,
        range.params
      );
    },

    blacklistedCompanies() {
      return all(`
        SELECT CompanyName AS "Name", Industry, Country, Comment
        FROM ${liveTable('Company')} WHERE Blacklisted=1
        ORDER BY CompanyName`);
    },

    companiesByCountry(from, to) {
      const range = dateClause('c.DateAdded', from, to);
      return all(
        `SELECT c.Country, COUNT(DISTINCT c.CompanyID) AS "Company Count",
                COUNT(DISTINCT co.ContactID) AS "Contact Count"
         FROM ${liveTable('Company')} c LEFT JOIN ${liveTable('Contact')} co ON c.CompanyID=co.CompanyID
         WHERE c.Blacklisted=0${range.sql}
         GROUP BY c.Country ORDER BY "Company Count" DESC`,
        range.params
      );
    },

    companiesBySector(from, to) {
      const range = dateClause('c.DateAdded', from, to);
      const total = get(
        `SELECT COUNT(*) AS n FROM ${liveTable('Company')} c WHERE c.Blacklisted=0${range.sql}`,
        range.params
      ).n;
      return all(
        `SELECT c.Sector AS Sector, COUNT(*) AS "Company Count",
                ROUND(COUNT(*)*100.0/?, 1) AS "Percentage"
         FROM ${liveTable('Company')} c WHERE c.Blacklisted=0${range.sql}
         GROUP BY c.Sector ORDER BY "Company Count" DESC`,
        [total, ...range.params]
      );
    },

    favoriteEmployers(from, to) {
      const range = dateClause('c.DateAdded', from, to);
      return all(
        `SELECT c.CompanyName AS "Name", c.Industry, c.Sector, c.Country,
                COUNT(co.ContactID) AS "Contact Count"
         FROM ${liveTable('Company')} c LEFT JOIN ${liveTable('Contact')} co ON c.CompanyID=co.CompanyID
         WHERE c.FavoriteEmployer=1${range.sql}
         GROUP BY c.CompanyID ORDER BY "Contact Count" DESC`,
        range.params
      );
    },

    newCompanies(from, to) {
      const range = dateClause('c.DateAdded', from, to);
      return all(
        `SELECT c.CompanyName AS "Name", c.Industry, c.Sector, c.Country, date(c.DateAdded) AS "Date Added"
         FROM ${liveTable('Company')} c WHERE 1=1${range.sql}
         ORDER BY c.DateAdded DESC`,
        range.params
      );
    },

    mouPartners() {
      return all(`
        SELECT c.CompanyName AS "Name", c.Industry, c.Sector, c.Country,
               COUNT(co.ContactID) AS "Contact Count"
        FROM ${liveTable('Company')} c LEFT JOIN ${liveTable('Contact')} co ON c.CompanyID=co.CompanyID
        WHERE c.SignedMoU=1
        GROUP BY c.CompanyID ORDER BY c.CompanyName`);
    },

    // ── Engagement and activity ─────────────────────────────────────────────

    /** Open follow-ups with their urgency relative to `today` (overdue, due by `weekEnd`, later). */
    followUpActions(today, weekEnd) {
      return all(
        `SELECT c.CompanyName AS "Company", ${contactNameSql('co')} AS "Contact",
                o.InteractionType AS "Type", date(o.InteractionDate) AS "Interaction Date",
                date(o.FollowUpDate) AS "Follow-Up Date", o.DiscussionItems AS "Discussion Items",
                o.ActionPlan AS "Action Plan",
                CAST(julianday(o.FollowUpDate) - julianday(?) AS INTEGER) AS "_days_until",
                CASE
                  WHEN o.FollowUpDate < ? THEN 'overdue'
                  WHEN o.FollowUpDate <= ? THEN 'this-week'
                  ELSE 'upcoming'
                END AS "_urgency"
         FROM ${liveTable('OutreachEngagement')} o
         JOIN ${liveTable('Company')} c  ON o.CompanyID=c.CompanyID
         JOIN Contact co ON o.ContactID=co.ContactID
         WHERE o.InteractionStatus='In-progress' AND o.FollowUpDate IS NOT NULL
         ORDER BY o.FollowUpDate ASC`,
        [today, today, weekEnd]
      );
    },

    /** Activity counts per non-blacklisted company, by record type. */
    engagementSummary(from, to) {
      const filters = activityFilters(from, to);
      return all(
        `SELECT c.CompanyName AS "Company",
           (SELECT COUNT(*) FROM ${liveTable('OutreachEngagement')} WHERE CompanyID=c.CompanyID${filters.sql[0]}) AS "Outreach",
           (SELECT COUNT(*) FROM ${liveTable('Recruitment')} WHERE CompanyID=c.CompanyID${filters.sql[1]}) AS "Recruitment",
           (SELECT COUNT(*) FROM ${liveTable('CareerEvent')} WHERE CompanyID=c.CompanyID${filters.sql[2]}) AS "Career Events",
           (SELECT COUNT(*) FROM ${liveTable('AcademicClassroomEngagement')} WHERE CompanyID=c.CompanyID${filters.sql[3]}) AS "Academic",
           (SELECT COUNT(*) FROM ${liveTable('StudentLedEvent')} WHERE CompanyID=c.CompanyID${filters.sql[4]}) AS "Student Events",
           (SELECT COUNT(*) FROM ${liveTable('HiringFeedback')} WHERE CompanyID=c.CompanyID${filters.sql[5]}) AS "Hiring Feedback"
         FROM ${liveTable('Company')} c WHERE c.Blacklisted=0
         ORDER BY c.CompanyName`,
        filters.params
      );
    },

    /** Non-blacklisted companies with no activity of any kind in the range. */
    inactiveCompanies(from, to) {
      const filters = activityFilters(from, to);
      return all(
        `SELECT c.CompanyName AS "Name", c.Sector, c.Country,
                date(c.DateAdded) AS "Date Added",
                date((SELECT MAX(o.InteractionDate) FROM ${liveTable('OutreachEngagement')} o WHERE o.CompanyID=c.CompanyID)) AS "Last Outreach"
         FROM ${liveTable('Company')} c WHERE c.Blacklisted=0
           AND (SELECT COUNT(*) FROM ${liveTable('OutreachEngagement')} WHERE CompanyID=c.CompanyID${filters.sql[0]})=0
           AND (SELECT COUNT(*) FROM ${liveTable('Recruitment')} WHERE CompanyID=c.CompanyID${filters.sql[1]})=0
           AND (SELECT COUNT(*) FROM ${liveTable('CareerEvent')} WHERE CompanyID=c.CompanyID${filters.sql[2]})=0
           AND (SELECT COUNT(*) FROM ${liveTable('AcademicClassroomEngagement')} WHERE CompanyID=c.CompanyID${filters.sql[3]})=0
           AND (SELECT COUNT(*) FROM ${liveTable('StudentLedEvent')} WHERE CompanyID=c.CompanyID${filters.sql[4]})=0
           AND (SELECT COUNT(*) FROM ${liveTable('HiringFeedback')} WHERE CompanyID=c.CompanyID${filters.sql[5]})=0
         ORDER BY c.CompanyName`,
        filters.params
      );
    },

    /** Records per month for outreach, recruitment, career events, academic and student events: { key: [{ m, n }] }. */
    monthlyActivity(from, to) {
      const sources = {
        outreach: ['OutreachEngagement', 'InteractionDate'],
        recruitment: ['Recruitment', 'DatePosted'],
        careerEvents: ['CareerEvent', 'EventDate'],
        academic: ['AcademicClassroomEngagement', 'SessionDate'],
        studentEvents: ['StudentLedEvent', 'ProposalDate'],
      };
      return Object.fromEntries(
        Object.entries(sources).map(([key, [table, dateColumn]]) => {
          const range = dateClause(dateColumn, from, to);
          const rows = all(
            `SELECT strftime('%Y-%m', ${dateColumn}) AS m, COUNT(*) AS n FROM ${table}
             WHERE ${dateColumn} IS NOT NULL${range.sql} GROUP BY m ORDER BY m`,
            range.params
          );
          return [key, rows];
        })
      );
    },

    // ── Recruitment and hiring ──────────────────────────────────────────────

    recruitmentPostings(from, to) {
      const range = dateClause('r.DatePosted', from, to);
      return all(
        `SELECT c.CompanyName AS "Company", r.OpportunityTitle AS "Title",
                date(r.DatePosted) AS "Date", r.Mode, r.Status AS "Paid/Unpaid",
                r.TargetGroup AS "Target Group", r.HiredStudentAlumni AS "Hired",
                r.Country, r.Comment
         FROM ${liveTable('Recruitment')} r JOIN ${liveTable('Company')} c ON r.CompanyID=c.CompanyID
         WHERE 1=1${range.sql} ORDER BY r.DatePosted DESC`,
        range.params
      );
    },

    recruitmentByMajor(from, to) {
      const range = dateClause('r.DatePosted', from, to);
      return all(
        `SELECT tm.Major,
                COUNT(*) AS "Posting Count",
                SUM(CASE WHEN r.Status='Paid' THEN 1 ELSE 0 END) AS "Paid Count",
                SUM(CASE WHEN r.Status='Unpaid' THEN 1 ELSE 0 END) AS "Unpaid Count"
         FROM Recruitment_TargetMajors tm JOIN ${liveTable('Recruitment')} r ON tm.RecruitmentID=r.RecruitmentID
         WHERE 1=1${range.sql}
         GROUP BY tm.Major ORDER BY "Posting Count" DESC`,
        range.params
      );
    },

    hiringOutcomes(from, to) {
      const range = dateClause('h.DateReported', from, to);
      return all(
        `SELECT c.CompanyName AS "Company", ${contactNameSql('co')} AS "Contact",
                h.FeedbackProvider AS "Provider", h.HiredStudentAlumni AS "Hired?",
                h.HiredStudentName AS "Student Name", date(h.DateReported) AS "Date"
         FROM ${liveTable('HiringFeedback')} h
         JOIN ${liveTable('Company')} c ON h.CompanyID=c.CompanyID JOIN Contact co ON h.ContactID=co.ContactID
         WHERE 1=1${range.sql} ORDER BY h.DateReported DESC`,
        range.params
      );
    },

    careerEventAttendance(from, to) {
      const range = dateClause('e.EventDate', from, to);
      return all(
        `SELECT c.CompanyName AS "Company", ${contactNameSql('co')} AS "Contact",
                e.EventName AS "Event", date(e.EventDate) AS "Date",
                e.RegisteredStatus AS "Status",
                CASE WHEN e.CMUQAlumniAtBooth=1 THEN 'Yes' ELSE 'No' END AS "Alumni at Booth"
         FROM ${liveTable('CareerEvent')} e
         JOIN ${liveTable('Company')} c ON e.CompanyID=c.CompanyID JOIN Contact co ON e.ContactID=co.ContactID
         WHERE 1=1${range.sql} ORDER BY e.EventDate DESC`,
        range.params
      );
    },

    /** Hires per month with the hiring companies: [{ m, n, Companies }]. */
    hiresByMonth(from, to) {
      const range = dateClause('h.DateReported', from, to);
      return all(
        `SELECT strftime('%Y-%m', h.DateReported) AS m,
                COUNT(*) AS n,
                GROUP_CONCAT(DISTINCT c.CompanyName) AS Companies
         FROM ${liveTable('HiringFeedback')} h JOIN ${liveTable('Company')} c ON h.CompanyID=c.CompanyID
         WHERE h.HiredStudentAlumni='Yes'${range.sql}
         GROUP BY m ORDER BY m`,
        range.params
      );
    },

    // ── Academic and student events ─────────────────────────────────────────

    academicEngagements(from, to) {
      const range = dateClause('a.SessionDate', from, to);
      return all(
        `SELECT c.CompanyName AS "Company", a.EngagementType AS "Type",
                a.GuestSpeakerName AS "Guest Speaker", a.FacultyName AS "Faculty",
                a.CourseNumber||' – '||a.CourseTitle AS "Course", date(a.SessionDate) AS "Date"
         FROM ${liveTable('AcademicClassroomEngagement')} a
         JOIN ${liveTable('Company')} c ON a.CompanyID=c.CompanyID
         WHERE 1=1${range.sql} ORDER BY a.SessionDate DESC`,
        range.params
      );
    },

    studentLedEvents(from, to) {
      const range = dateClause('s.ProposalDate', from, to);
      return all(
        `SELECT c.CompanyName AS "Company", s.OrganizationName AS "Organization",
                s.StudentName AS "Student Name", s.EventTitle AS "Event Title",
                date(s.EventDate) AS "Date", s.CollaborationOutcome AS "Outcome"
         FROM ${liveTable('StudentLedEvent')} s JOIN ${liveTable('Company')} c ON s.CompanyID=c.CompanyID
         WHERE 1=1${range.sql} ORDER BY s.ProposalDate DESC`,
        range.params
      );
    },

    guestSpeakers(from, to) {
      const range = dateClause('a.SessionDate', from, to);
      return all(
        `SELECT a.GuestSpeakerName AS "Name", a.GuestTitle AS "Title",
                c.CompanyName AS "Company", a.CourseNumber||' – '||a.CourseTitle AS "Course",
                a.TopicTheme AS "Topic", date(a.SessionDate) AS "Date"
         FROM ${liveTable('AcademicClassroomEngagement')} a JOIN ${liveTable('Company')} c ON a.CompanyID=c.CompanyID
         WHERE 1=1${range.sql} ORDER BY a.GuestSpeakerName`,
        range.params
      );
    },

    // ── Trends ──────────────────────────────────────────────────────────────

    /** Dates and employer industries of postings, attended career events and outreach: { recruitment, events, outreach }. */
    industryActivity(from, to) {
      return {
        recruitment: datesBetween(
          `SELECT r.DatePosted AS d, c.Industry AS industry FROM ${liveTable('Recruitment')} r JOIN ${liveTable('Company')} c ON r.CompanyID=c.CompanyID WHERE 1=1`,
          'r.DatePosted',
          from,
          to
        ),
        events: datesBetween(
          `SELECT e.EventDate AS d, c.Industry AS industry FROM ${liveTable('CareerEvent')} e JOIN ${liveTable('Company')} c ON e.CompanyID=c.CompanyID WHERE e.RegisteredStatus='Attended'`,
          'e.EventDate',
          from,
          to
        ),
        outreach: datesBetween(
          `SELECT o.InteractionDate AS d, c.Industry AS industry FROM ${liveTable('OutreachEngagement')} o JOIN ${liveTable('Company')} c ON o.CompanyID=c.CompanyID WHERE 1=1`,
          'o.InteractionDate',
          from,
          to
        ),
      };
    },

    /**
     * Opportunities: postings (kind 'recruitment') and engagements (outreach,
     * attended career events, academic sessions), each with date, industry and company.
     */
    opportunityActivity(from, to) {
      const sources = [
        {
          kind: 'recruitment',
          sql: `SELECT r.DatePosted AS d, c.Industry AS industry, c.CompanyName AS company FROM ${liveTable('Recruitment')} r JOIN ${liveTable('Company')} c ON r.CompanyID=c.CompanyID WHERE 1=1`,
          dateColumn: 'DatePosted',
        },
        {
          kind: 'engagement',
          sql: `SELECT o.InteractionDate AS d, c.Industry AS industry, c.CompanyName AS company FROM ${liveTable('OutreachEngagement')} o JOIN ${liveTable('Company')} c ON o.CompanyID=c.CompanyID WHERE 1=1`,
          dateColumn: 'InteractionDate',
        },
        {
          kind: 'engagement',
          sql: `SELECT e.EventDate AS d, c.Industry AS industry, c.CompanyName AS company FROM ${liveTable('CareerEvent')} e JOIN ${liveTable('Company')} c ON e.CompanyID=c.CompanyID WHERE e.RegisteredStatus='Attended'`,
          dateColumn: 'EventDate',
        },
        {
          kind: 'engagement',
          sql: `SELECT a.SessionDate AS d, c.Industry AS industry, c.CompanyName AS company FROM ${liveTable('AcademicClassroomEngagement')} a JOIN ${liveTable('Company')} c ON a.CompanyID=c.CompanyID WHERE 1=1`,
          dateColumn: 'SessionDate',
        },
      ];
      return sources.flatMap((source) =>
        datesBetween(source.sql, source.dateColumn, from, to).map((row) => ({ ...row, kind: source.kind }))
      );
    },

    /** Postings per company between two dates: [{ company, n }]. */
    postingsByCompany(range) {
      return all(
        `SELECT c.CompanyName AS company, COUNT(*) AS n FROM ${liveTable('Recruitment')} r JOIN ${liveTable('Company')} c ON r.CompanyID=c.CompanyID
         WHERE r.DatePosted>=? AND r.DatePosted<=? GROUP BY c.CompanyName`,
        [range.from, range.to]
      );
    },

    /** Reported hires per company between two dates: [{ company, n }]. */
    hiresByCompany(range) {
      return all(
        `SELECT c.CompanyName AS company, COUNT(*) AS n FROM ${liveTable('HiringFeedback')} h JOIN ${liveTable('Company')} c ON h.CompanyID=c.CompanyID
         WHERE h.HiredStudentAlumni='Yes' AND h.DateReported>=? AND h.DateReported<=? GROUP BY c.CompanyName`,
        [range.from, range.to]
      );
    },

    /** One row per posting, target major and role type. */
    rolesByProgram(from, to) {
      const range = dateClause('r.DatePosted', from, to);
      return all(
        `SELECT DISTINCT r.RecruitmentID AS recruitmentId,
                COALESCE(NULLIF(TRIM(m.Major), ''), 'Unspecified') AS major,
                COALESCE(NULLIF(TRIM(t.Type), ''), 'Unspecified') AS roleType,
                TRIM(COALESCE(r.OpportunityTitle, '')) AS title,
                r.Status AS payStatus,
                r.HiredStudentAlumni AS hired
         FROM ${liveTable('Recruitment')} r
         LEFT JOIN Recruitment_TargetMajors m ON m.RecruitmentID = r.RecruitmentID
         LEFT JOIN Recruitment_OpportunityType t ON t.RecruitmentID = r.RecruitmentID
         WHERE 1=1${range.sql}`,
        range.params
      );
    },

    /** Activity dates by kind: { outreach, recruitment, careerEvents, academic, studentEvents, hires }, each [{ d }]. */
    activityDates(from, to) {
      return {
        outreach: datesBetween(
          `SELECT o.InteractionDate AS d FROM ${liveTable('OutreachEngagement')} o WHERE 1=1`,
          'o.InteractionDate',
          from,
          to
        ),
        recruitment: datesBetween(
          `SELECT r.DatePosted AS d FROM ${liveTable('Recruitment')} r WHERE 1=1`,
          'r.DatePosted',
          from,
          to
        ),
        careerEvents: datesBetween(
          `SELECT e.EventDate AS d FROM ${liveTable('CareerEvent')} e WHERE e.RegisteredStatus='Attended'`,
          'e.EventDate',
          from,
          to
        ),
        academic: datesBetween(
          `SELECT a.SessionDate AS d FROM ${liveTable('AcademicClassroomEngagement')} a WHERE 1=1`,
          'a.SessionDate',
          from,
          to
        ),
        studentEvents: datesBetween(
          `SELECT s.ProposalDate AS d FROM ${liveTable('StudentLedEvent')} s WHERE 1=1`,
          's.ProposalDate',
          from,
          to
        ),
        hires: datesBetween(
          `SELECT h.DateReported AS d FROM ${liveTable('HiringFeedback')} h WHERE h.HiredStudentAlumni='Yes'`,
          'h.DateReported',
          from,
          to
        ),
      };
    },

    /** One row per activity record with its date and the employer's sector: [{ d, sector }]. */
    sectorActivity(from, to) {
      const sources = [
        ['OutreachEngagement o', 'o.InteractionDate', 'o.CompanyID'],
        ['Recruitment r', 'r.DatePosted', 'r.CompanyID'],
        ['CareerEvent e', 'e.EventDate', 'e.CompanyID'],
        ['AcademicClassroomEngagement a', 'a.SessionDate', 'a.CompanyID'],
        ['StudentLedEvent s', 's.ProposalDate', 's.CompanyID'],
        ['HiringFeedback h', 'h.DateReported', 'h.CompanyID'],
      ];
      return sources.flatMap(([table, dateColumn, companyColumn]) =>
        datesBetween(
          `SELECT ${dateColumn} AS d, c.Sector AS sector FROM ${table} JOIN ${liveTable('Company')} c ON ${companyColumn}=c.CompanyID WHERE 1=1`,
          dateColumn,
          from,
          to
        )
      );
    },

    /** Posting dates and hire dates: { postings: [{ d }], hires: [{ d }] }. */
    postingAndHireDates(from, to) {
      return {
        postings: datesBetween(
          `SELECT DatePosted AS d FROM ${liveTable('Recruitment')} WHERE 1=1`,
          'DatePosted',
          from,
          to
        ),
        hires: datesBetween(
          `SELECT DateReported AS d FROM ${liveTable('HiringFeedback')} WHERE HiredStudentAlumni='Yes'`,
          'DateReported',
          from,
          to
        ),
      };
    },

    /**
     * Dates of one kind of opportunity between two dates: 'recruitment' (postings)
     * or 'engagement' (outreach, attended career events, academic sessions).
     */
    opportunityDates(range, kind) {
      return all(
        `SELECT d FROM (
           SELECT DatePosted AS d, 'recruitment' AS kind FROM ${liveTable('Recruitment')} WHERE DatePosted >= ? AND DatePosted <= ?
           UNION ALL
           SELECT InteractionDate AS d, 'engagement' AS kind FROM ${liveTable('OutreachEngagement')} WHERE InteractionDate >= ? AND InteractionDate <= ?
           UNION ALL
           SELECT EventDate AS d, 'engagement' AS kind FROM ${liveTable('CareerEvent')} WHERE RegisteredStatus='Attended' AND EventDate >= ? AND EventDate <= ?
           UNION ALL
           SELECT SessionDate AS d, 'engagement' AS kind FROM ${liveTable('AcademicClassroomEngagement')} WHERE SessionDate >= ? AND SessionDate <= ?
         ) WHERE kind = ?`,
        [range.from, range.to, range.from, range.to, range.from, range.to, range.from, range.to, kind]
      );
    },

    /** The headline counts of one period { from, to }. */
    periodMetrics(range) {
      const bounds = [range.from, range.to];
      const count = (sql) => get(sql, bounds).n;
      return {
        companiesEngaged: count(`
          SELECT COUNT(DISTINCT CompanyID) AS n FROM (
            SELECT CompanyID, InteractionDate AS d FROM ${liveTable('OutreachEngagement')}
            UNION ALL SELECT CompanyID, DatePosted FROM ${liveTable('Recruitment')}
            UNION ALL SELECT CompanyID, EventDate FROM ${liveTable('CareerEvent')}
            UNION ALL SELECT CompanyID, SessionDate FROM ${liveTable('AcademicClassroomEngagement')}
          ) WHERE d >= ? AND d <= ?`),
        newCompanies: count(`SELECT COUNT(*) AS n FROM ${liveTable('Company')} WHERE DateAdded>=? AND DateAdded<=?`),
        recruitmentPostings: count(
          `SELECT COUNT(*) AS n FROM ${liveTable('Recruitment')} WHERE DatePosted>=? AND DatePosted<=?`
        ),
        careerEventsAttended: count(
          `SELECT COUNT(*) AS n FROM ${liveTable('CareerEvent')} WHERE RegisteredStatus='Attended' AND EventDate>=? AND EventDate<=?`
        ),
        studentsHired: count(
          `SELECT COUNT(*) AS n FROM ${liveTable('HiringFeedback')} WHERE HiredStudentAlumni='Yes' AND DateReported>=? AND DateReported<=?`
        ),
        academicEngagements: count(
          `SELECT COUNT(*) AS n FROM ${liveTable('AcademicClassroomEngagement')} WHERE SessionDate>=? AND SessionDate<=?`
        ),
        outreachInteractions: count(
          `SELECT COUNT(*) AS n FROM ${liveTable('OutreachEngagement')} WHERE InteractionDate>=? AND InteractionDate<=?`
        ),
      };
    },
  };
}

module.exports = { createReportsRepository };
