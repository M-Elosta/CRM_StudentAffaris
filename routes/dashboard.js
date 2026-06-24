const express = require('express');
const router  = express.Router();
const { optionalIsoDate, sendValidationError } = require('./_validation');

function parseDateRange(query) {
  const from = optionalIsoDate(query.from, 'from');
  const to = optionalIsoDate(query.to, 'to');
  return { from, to };
}

function buildDateRange(field, from, to) {
  const params = [];
  let sql = '';
  if (from) {
    sql += ` AND ${field}>=?`;
    params.push(from);
  }
  if (to) {
    sql += ` AND ${field}<=?`;
    params.push(to);
  }
  return { sql, params };
}

// GET /api/dashboard/stats
router.get('/stats', (req, res) => {
  const db = req.app.locals.db;
  try {
    const { from, to } = parseDateRange(req.query);
    const today = new Date().toISOString().slice(0, 10);
    const companyRange = buildDateRange('DateAdded', from, to);
    const contactRange = buildDateRange('DateAdded', from, to);
    const outreachRange = buildDateRange('InteractionDate', from, to);
    const followUpRange = from || to
      ? buildDateRange('FollowUpDate', from, to)
      : { sql: ' AND FollowUpDate>=?', params: [today] };

    res.json({
      totalCompanies: db.prepare(`SELECT COUNT(*) AS n FROM Company WHERE Blacklisted=0${companyRange.sql}`).get(...companyRange.params).n,
      totalBlacklisted: db.prepare(`SELECT COUNT(*) AS n FROM Company WHERE Blacklisted=1${companyRange.sql}`).get(...companyRange.params).n,
      totalContacts: db.prepare(`SELECT COUNT(*) AS n FROM Contact WHERE 1=1${contactRange.sql}`).get(...contactRange.params).n,
      mailableContacts: db.prepare(`SELECT COUNT(*) AS n FROM Contact WHERE Status='Mailable' AND ExcludeFromMailing=0${contactRange.sql}`).get(...contactRange.params).n,
      outreachThisMonth: db.prepare(`SELECT COUNT(*) AS n FROM OutreachEngagement WHERE 1=1${outreachRange.sql}`).get(...outreachRange.params).n,
      upcomingFollowUps: db.prepare(`SELECT COUNT(*) AS n FROM OutreachEngagement WHERE InteractionStatus='In-progress'${followUpRange.sql}`).get(...followUpRange.params).n,
    });
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/companies-by-month
router.get('/companies-by-month', (req, res) => {
  const db = req.app.locals.db;
  try {
    const { from, to } = parseDateRange(req.query);
  let sql = `SELECT strftime('%Y-%m', DateAdded) AS month, COUNT(*) AS count FROM Company WHERE Blacklisted=0`;
  const p = [];
  if (from) { sql += ' AND DateAdded>=?'; p.push(from); }
  if (to)   { sql += ' AND DateAdded<=?'; p.push(to); }
  sql += ' GROUP BY month ORDER BY month';
    res.json(db.prepare(sql).all(...p));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/outreach-by-month
router.get('/outreach-by-month', (req, res) => {
  const db = req.app.locals.db;
  try {
    const { from, to } = parseDateRange(req.query);
  let sql = `SELECT strftime('%Y-%m', InteractionDate) AS month, InteractionType AS type, COUNT(*) AS count FROM OutreachEngagement WHERE 1=1`;
  const p = [];
  if (from) { sql += ' AND InteractionDate>=?'; p.push(from); }
  if (to)   { sql += ' AND InteractionDate<=?'; p.push(to); }
  sql += ' GROUP BY month, type ORDER BY month';
    res.json(db.prepare(sql).all(...p));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/companies-by-sector
router.get('/companies-by-sector', (req, res) => {
  const db = req.app.locals.db;
  try {
    const { from, to } = parseDateRange(req.query);
    const range = buildDateRange('DateAdded', from, to);
    res.json(db.prepare(`SELECT Sector AS label, COUNT(*) AS count FROM Company WHERE Blacklisted=0${range.sql} GROUP BY Sector ORDER BY count DESC`).all(...range.params));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/recruitment-by-major
router.get('/recruitment-by-major', (req, res) => {
  const db = req.app.locals.db;
  try {
    const { from, to } = parseDateRange(req.query);
  let sql = `SELECT m.Major AS label, COUNT(*) AS count FROM Recruitment_TargetMajors m JOIN Recruitment r ON m.RecruitmentID=r.RecruitmentID WHERE 1=1`;
  const p = [];
  if (from) { sql += ' AND r.DatePosted>=?'; p.push(from); }
  if (to)   { sql += ' AND r.DatePosted<=?'; p.push(to); }
  sql += ' GROUP BY m.Major ORDER BY count DESC';
    res.json(db.prepare(sql).all(...p));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/event-attendance
router.get('/event-attendance', (req, res) => {
  const db = req.app.locals.db;
  try {
    const { from, to } = parseDateRange(req.query);
  let sql = `SELECT EventName, RegisteredStatus AS status, COUNT(*) AS count FROM CareerEvent WHERE 1=1`;
  const p = [];
  if (from) { sql += ' AND EventDate>=?'; p.push(from); }
  if (to)   { sql += ' AND EventDate<=?'; p.push(to); }
  sql += ' GROUP BY EventName, RegisteredStatus ORDER BY EventName';
    res.json(db.prepare(sql).all(...p));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/top-engaged
router.get('/top-engaged', (req, res) => {
  const db = req.app.locals.db;
  try {
    const { from, to } = parseDateRange(req.query);
  const p1=[], p2=[], p3=[], p4=[];
  let of='',rf='',ef='',af='';
  if (from) { of+=' AND InteractionDate>=?'; p1.push(from); }
  if (to)   { of+=' AND InteractionDate<=?'; p1.push(to); }
  if (from) { rf+=' AND DatePosted>=?';      p2.push(from); }
  if (to)   { rf+=' AND DatePosted<=?';      p2.push(to); }
  if (from) { ef+=' AND EventDate>=?';       p3.push(from); }
  if (to)   { ef+=' AND EventDate<=?';       p3.push(to); }
  if (from) { af+=' AND SessionDate>=?';     p4.push(from); }
  if (to)   { af+=' AND SessionDate<=?';     p4.push(to); }

    const rows = db.prepare(`
      SELECT c.CompanyName AS company,
        (SELECT COUNT(*) FROM OutreachEngagement WHERE CompanyID=c.CompanyID${of}) +
        (SELECT COUNT(*) FROM Recruitment WHERE CompanyID=c.CompanyID${rf}) +
        (SELECT COUNT(*) FROM CareerEvent WHERE CompanyID=c.CompanyID${ef}) +
        (SELECT COUNT(*) FROM AcademicClassroomEngagement WHERE CompanyID=c.CompanyID${af}) AS total
      FROM Company c
      ORDER BY total DESC LIMIT 10`
    ).all(...p1,...p2,...p3,...p4);
    res.json(rows);
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/hiring-trends
router.get('/hiring-trends', (req, res) => {
  const db = req.app.locals.db;
  try {
    const { from, to } = parseDateRange(req.query);
  let sql = `SELECT strftime('%Y-%m', DateReported) AS month, COUNT(*) AS count FROM HiringFeedback WHERE HiredStudentAlumni='Yes'`;
  const p = [];
  if (from) { sql += ' AND DateReported>=?'; p.push(from); }
  if (to)   { sql += ' AND DateReported<=?'; p.push(to); }
  sql += ' GROUP BY month ORDER BY month';
    res.json(db.prepare(sql).all(...p));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
