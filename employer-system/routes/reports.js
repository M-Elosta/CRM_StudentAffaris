const express = require('express');
const router  = express.Router();
const XLSX    = require('xlsx');

// ── Query builders ─────────────────────────────────────────────────────────────
const QUERIES = {
  companies: (db, { from, to }) => {
    let sql = `SELECT CompanyName AS "Company Name", Industry, Sector, Country,
               DateAdded AS "Date Added", Website, SignedMoU AS "MoU"
               FROM Company WHERE Blacklisted=0`;
    const p = [];
    if (from) { sql += ' AND DateAdded>=?'; p.push(from); }
    if (to)   { sql += ' AND DateAdded<=?'; p.push(to); }
    sql += ' ORDER BY CompanyName';
    return db.prepare(sql).all(...p);
  },

  mailable: (db) =>
    db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name",
             c.CompanyName AS "Company", co.EmailAddress AS "Email",
             co.JobTitle AS "Job Title", co.WorkPhone AS "Work Phone",
             co.Mobile AS "Mobile"
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.Status='Mailable' AND co.ExcludeFromMailing=0
      ORDER BY co.LastName, co.FirstName`).all(),

  event_invitation: (db) =>
    db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name",
             c.CompanyName AS "Company", co.EmailAddress AS "Email",
             co.JobTitle AS "Job Title", co.WorkPhone AS "Work Phone"
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.EventInvitation=1 AND co.Status='Mailable' AND co.ExcludeFromMailing=0
      ORDER BY co.LastName, co.FirstName`).all(),

  resume_book: (db) =>
    db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name",
             c.CompanyName AS "Company", co.EmailAddress AS "Email",
             co.JobTitle AS "Job Title", co.Major AS "Major",
             co.GraduationYear AS "Grad Year"
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.ResumeBook=1 AND co.Status='Mailable' AND co.ExcludeFromMailing=0
      ORDER BY co.LastName, co.FirstName`).all(),

  non_mailable: (db) =>
    db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name",
             c.CompanyName AS "Company", co.EmailAddress AS "Email",
             co.JobTitle AS "Job Title", co.Status AS "Status",
             CASE WHEN c.Blacklisted=1 THEN 'Company Blacklisted' ELSE 'Manually Set' END AS "Reason"
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.Status='Non-mailable'
      ORDER BY co.LastName, co.FirstName`).all(),

  follow_up: (db) =>
    db.prepare(`
      SELECT c.CompanyName AS "Company",
             co.FirstName||' '||co.LastName AS "Contact",
             o.InteractionType AS "Type",
             o.InteractionDate AS "Interaction Date",
             o.FollowUpDate AS "Follow-up Date",
             o.DiscussionItems AS "Discussion",
             o.ActionPlan AS "Action Plan",
             CASE WHEN o.FollowUpDate < date('now') THEN 'OVERDUE' ELSE 'Upcoming' END AS "Urgency"
      FROM OutreachEngagement o
      JOIN Company c  ON o.CompanyID=c.CompanyID
      JOIN Contact co ON o.ContactID=co.ContactID
      WHERE o.InteractionStatus='In-progress' AND o.FollowUpDate IS NOT NULL
      ORDER BY o.FollowUpDate ASC`).all(),

  engagement_summary: (db, { from, to }) => {
    const p1 = [], p2 = [], p3 = [], p4 = [];
    let outreachFilter = '', recruitFilter = '', eventFilter = '', academicFilter = '';
    if (from) { outreachFilter+=' AND InteractionDate>=?'; p1.push(from); }
    if (to)   { outreachFilter+=' AND InteractionDate<=?'; p1.push(to); }
    if (from) { recruitFilter+=' AND DatePosted>=?';       p2.push(from); }
    if (to)   { recruitFilter+=' AND DatePosted<=?';       p2.push(to); }
    if (from) { eventFilter+=' AND EventDate>=?';          p3.push(from); }
    if (to)   { eventFilter+=' AND EventDate<=?';          p3.push(to); }
    if (from) { academicFilter+=' AND SessionDate>=?';     p4.push(from); }
    if (to)   { academicFilter+=' AND SessionDate<=?';     p4.push(to); }

    return db.prepare(`
      SELECT c.CompanyName AS "Company",
        (SELECT COUNT(*) FROM OutreachEngagement WHERE CompanyID=c.CompanyID${outreachFilter}) AS "Outreach",
        (SELECT COUNT(*) FROM Recruitment WHERE CompanyID=c.CompanyID${recruitFilter}) AS "Recruitment",
        (SELECT COUNT(*) FROM CareerEvent WHERE CompanyID=c.CompanyID${eventFilter}) AS "Career Events",
        (SELECT COUNT(*) FROM AcademicClassroomEngagement WHERE CompanyID=c.CompanyID${academicFilter}) AS "Academic"
      FROM Company c
      ORDER BY ("Outreach"+"Recruitment"+"Career Events"+"Academic") DESC`
    ).all(...p1,...p2,...p3,...p4).map(r => ({
      ...r,
      "Total": r["Outreach"]+r["Recruitment"]+r["Career Events"]+r["Academic"]
    }));
  },

  recruitment: (db, { from, to }) => {
    let sql = `
      SELECT c.CompanyName AS "Company", r.OpportunityTitle AS "Title",
             r.DatePosted AS "Date Posted", r.Mode, r.Status,
             r.TargetGroup AS "Target", r.HiredStudentAlumni AS "Hired",
             r.Country, r.ArabicSpeaker AS "Arabic Speaker"
      FROM Recruitment r JOIN Company c ON r.CompanyID=c.CompanyID WHERE 1=1`;
    const p = [];
    if (from) { sql+=' AND r.DatePosted>=?'; p.push(from); }
    if (to)   { sql+=' AND r.DatePosted<=?'; p.push(to); }
    sql+=' ORDER BY r.DatePosted DESC';
    return db.prepare(sql).all(...p);
  },

  career_events: (db, { from, to }) => {
    let sql = `
      SELECT c.CompanyName AS "Company",
             co.FirstName||' '||co.LastName AS "Contact",
             e.EventName AS "Event", e.EventDate AS "Date",
             e.RegisteredStatus AS "Status",
             e.CMUQAlumniAtBooth AS "Alumni at Booth"
      FROM CareerEvent e JOIN Company c ON e.CompanyID=c.CompanyID JOIN Contact co ON e.ContactID=co.ContactID
      WHERE 1=1`;
    const p = [];
    if (from) { sql+=' AND e.EventDate>=?'; p.push(from); }
    if (to)   { sql+=' AND e.EventDate<=?'; p.push(to); }
    sql+=' ORDER BY e.EventDate DESC';
    return db.prepare(sql).all(...p);
  },

  hiring_feedback: (db, { from, to }) => {
    let sql = `
      SELECT c.CompanyName AS "Company",
             co.FirstName||' '||co.LastName AS "Contact",
             h.FeedbackProvider AS "Provider",
             h.HiredStudentAlumni AS "Hired",
             h.DateReported AS "Date", h.HiredStudentName AS "Student Name",
             h.Comment AS "Comment"
      FROM HiringFeedback h JOIN Company c ON h.CompanyID=c.CompanyID JOIN Contact co ON h.ContactID=co.ContactID
      WHERE 1=1`;
    const p = [];
    if (from) { sql+=' AND h.DateReported>=?'; p.push(from); }
    if (to)   { sql+=' AND h.DateReported<=?'; p.push(to); }
    sql+=' ORDER BY h.DateReported DESC';
    return db.prepare(sql).all(...p);
  },

  job_outreach: (db) =>
    db.prepare(`
      SELECT DISTINCT co.FirstName||' '||co.LastName AS "Name",
             c.CompanyName AS "Company", co.EmailAddress AS "Email",
             co.JobTitle AS "Job Title", co.WorkPhone AS "Work Phone"
      FROM Contact co
      JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.Status='Mailable' AND co.ExcludeFromMailing=0
        AND c.CompanyID IN (SELECT DISTINCT CompanyID FROM Recruitment)
      ORDER BY c.CompanyName, co.LastName`).all(),
};

// GET /api/reports/:type
router.get('/:type', (req, res) => {
  const db   = req.app.locals.db;
  const type = req.params.type;
  const { from, to, export: doExport } = req.query;

  const fn = QUERIES[type];
  if (!fn) return res.status(404).json({ error: `Unknown report type: ${type}` });

  try {
    const rows = fn(db, { from, to });

    if (doExport === '1') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Report');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', `attachment; filename="report-${type}-${Date.now()}.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buf);
    }

    res.json({ rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
