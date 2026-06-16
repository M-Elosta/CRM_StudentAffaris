const express = require('express');
const router = express.Router();
const {
  optionalIsoDate,
  optionalTrimmedString,
  requireIsoDate,
  requirePositiveInt,
  requireTrimmedString,
  sendValidationError,
} = require('./_validation');
const { ensureRecordNotStale } = require('./_records');

router.param('id', (req, res, next, id) => {
  try {
    req.recordId = requirePositiveInt(id, 'Hiring feedback ID');
    next();
  } catch (err) {
    sendValidationError(res, err);
  }
});

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const feedbackProvider = optionalTrimmedString(req.query.feedbackProvider, 'feedbackProvider', 100);
    const hiredStudentAlumni = optionalTrimmedString(req.query.hiredStudentAlumni, 'hiredStudentAlumni', 100);
    const from = optionalIsoDate(req.query.from, 'from');
    const to = optionalIsoDate(req.query.to, 'to');
    let sql = `
      SELECT h.*, c.CompanyName, co.FirstName||' '||co.LastName AS ContactName
      FROM HiringFeedback h JOIN Company c ON h.CompanyID=c.CompanyID JOIN Contact co ON h.ContactID=co.ContactID
      WHERE 1=1`;
    const p = [];
    if (feedbackProvider)    { sql += ' AND h.FeedbackProvider=?';   p.push(feedbackProvider); }
    if (hiredStudentAlumni)  { sql += ' AND h.HiredStudentAlumni=?'; p.push(hiredStudentAlumni); }
    if (from)                { sql += ' AND h.DateReported>=?';      p.push(from); }
    if (to)                  { sql += ' AND h.DateReported<=?';      p.push(to); }
    sql += ' ORDER BY h.DateReported DESC';
    res.json(db.prepare(sql).all(...p));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare(`SELECT h.*, c.CompanyName, co.FirstName||' '||co.LastName AS ContactName FROM HiringFeedback h JOIN Company c ON h.CompanyID=c.CompanyID JOIN Contact co ON h.ContactID=co.ContactID WHERE h.HiringFeedbackID=?`).get(req.recordId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    ensureRecordNotStale(db, 'HiringFeedback', 'HiringFeedbackID', req.recordId, req.body.UpdatedAt, 'Not found');
    const CompanyID = requirePositiveInt(req.body.CompanyID, 'CompanyID');
    const ContactID = requirePositiveInt(req.body.ContactID, 'ContactID');
    const FeedbackProvider = requireTrimmedString(req.body.FeedbackProvider, 'FeedbackProvider', 100);
    const HiredStudentAlumni = requireTrimmedString(req.body.HiredStudentAlumni, 'HiredStudentAlumni', 100);
    const DateReported = requireIsoDate(req.body.DateReported, 'DateReported');
    const HiredStudentName = optionalTrimmedString(req.body.HiredStudentName, 'HiredStudentName', 255);
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const info = db.prepare(`INSERT INTO HiringFeedback (CompanyID,ContactID,FeedbackProvider,HiredStudentAlumni,DateReported,HiredStudentName,Comment) VALUES (?,?,?,?,?,?,?)`
    ).run(CompanyID,ContactID,FeedbackProvider,HiredStudentAlumni,DateReported,HiredStudentName||null,Comment||null);
    res.status(201).json(db.prepare('SELECT * FROM HiringFeedback WHERE HiringFeedbackID=?').get(info.lastInsertRowid));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const CompanyID = requirePositiveInt(req.body.CompanyID, 'CompanyID');
    const ContactID = requirePositiveInt(req.body.ContactID, 'ContactID');
    const FeedbackProvider = requireTrimmedString(req.body.FeedbackProvider, 'FeedbackProvider', 100);
    const HiredStudentAlumni = requireTrimmedString(req.body.HiredStudentAlumni, 'HiredStudentAlumni', 100);
    const DateReported = requireIsoDate(req.body.DateReported, 'DateReported');
    const HiredStudentName = optionalTrimmedString(req.body.HiredStudentName, 'HiredStudentName', 255);
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const info = db.prepare(`UPDATE HiringFeedback SET CompanyID=?,ContactID=?,FeedbackProvider=?,HiredStudentAlumni=?,DateReported=?,HiredStudentName=?,Comment=? WHERE HiringFeedbackID=?`
    ).run(CompanyID,ContactID,FeedbackProvider,HiredStudentAlumni,DateReported,HiredStudentName||null,Comment||null,req.recordId);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM HiringFeedback WHERE HiringFeedbackID=?').get(req.recordId));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = db.prepare('DELETE FROM HiringFeedback WHERE HiringFeedbackID=?').run(req.recordId);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
