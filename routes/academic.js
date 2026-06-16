const express = require('express');
const router = express.Router();
const {
  optionalIsoDate,
  optionalTrimmedString,
  requireEmail,
  requireIsoDate,
  requireIsoTime,
  requirePositiveInt,
  requireTrimmedString,
  sendValidationError,
} = require('./_validation');

router.param('id', (req, res, next, id) => {
  try {
    req.recordId = requirePositiveInt(id, 'Academic engagement ID');
    next();
  } catch (err) {
    sendValidationError(res, err);
  }
});

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const engagementType = optionalTrimmedString(req.query.engagementType, 'engagementType', 100);
    const from = optionalIsoDate(req.query.from, 'from');
    const to = optionalIsoDate(req.query.to, 'to');
    let sql = `
      SELECT a.*, c.CompanyName, co.FirstName||' '||co.LastName AS ContactName
      FROM AcademicClassroomEngagement a
      JOIN Company c  ON a.CompanyID=c.CompanyID
      JOIN Contact co ON a.ContactID=co.ContactID
      WHERE 1=1`;
    const p = [];
    if (engagementType) { sql += ' AND a.EngagementType=?'; p.push(engagementType); }
    if (from)           { sql += ' AND a.SessionDate>=?';   p.push(from); }
    if (to)             { sql += ' AND a.SessionDate<=?';   p.push(to); }
    sql += ' ORDER BY a.SessionDate DESC';
    res.json(db.prepare(sql).all(...p));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare(`
    SELECT a.*, c.CompanyName, co.FirstName||' '||co.LastName AS ContactName
    FROM AcademicClassroomEngagement a JOIN Company c ON a.CompanyID=c.CompanyID JOIN Contact co ON a.ContactID=co.ContactID
    WHERE a.EngagementID=?`).get(req.recordId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const CompanyID = requirePositiveInt(req.body.CompanyID, 'CompanyID');
    const ContactID = requirePositiveInt(req.body.ContactID, 'ContactID');
    const EngagementType = requireTrimmedString(req.body.EngagementType, 'EngagementType', 100);
    const GuestSpeakerName = requireTrimmedString(req.body.GuestSpeakerName, 'GuestSpeakerName');
    const GuestTitle = requireTrimmedString(req.body.GuestTitle, 'GuestTitle');
    const Email = req.body.Email ? requireEmail(req.body.Email, 'Email') : null;
    const PhoneNumber = optionalTrimmedString(req.body.PhoneNumber, 'PhoneNumber', 50);
    const FacultyName = requireTrimmedString(req.body.FacultyName, 'FacultyName');
    const CourseNumber = requireTrimmedString(req.body.CourseNumber, 'CourseNumber', 50);
    const CourseTitle = requireTrimmedString(req.body.CourseTitle, 'CourseTitle');
    const TopicTheme = requireTrimmedString(req.body.TopicTheme, 'TopicTheme');
    const SessionDate = requireIsoDate(req.body.SessionDate, 'SessionDate');
    const SessionTime = requireIsoTime(req.body.SessionTime, 'SessionTime');
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const info = db.prepare(`
      INSERT INTO AcademicClassroomEngagement
        (CompanyID,ContactID,EngagementType,GuestSpeakerName,GuestTitle,Email,PhoneNumber,FacultyName,CourseNumber,CourseTitle,TopicTheme,SessionDate,SessionTime,Comment)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(CompanyID,ContactID,EngagementType,GuestSpeakerName,GuestTitle,Email||null,PhoneNumber||null,FacultyName,CourseNumber,CourseTitle,TopicTheme,SessionDate,SessionTime,Comment||null);
    res.status(201).json(db.prepare('SELECT * FROM AcademicClassroomEngagement WHERE EngagementID=?').get(info.lastInsertRowid));
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
    const EngagementType = requireTrimmedString(req.body.EngagementType, 'EngagementType', 100);
    const GuestSpeakerName = requireTrimmedString(req.body.GuestSpeakerName, 'GuestSpeakerName');
    const GuestTitle = requireTrimmedString(req.body.GuestTitle, 'GuestTitle');
    const Email = req.body.Email ? requireEmail(req.body.Email, 'Email') : null;
    const PhoneNumber = optionalTrimmedString(req.body.PhoneNumber, 'PhoneNumber', 50);
    const FacultyName = requireTrimmedString(req.body.FacultyName, 'FacultyName');
    const CourseNumber = requireTrimmedString(req.body.CourseNumber, 'CourseNumber', 50);
    const CourseTitle = requireTrimmedString(req.body.CourseTitle, 'CourseTitle');
    const TopicTheme = requireTrimmedString(req.body.TopicTheme, 'TopicTheme');
    const SessionDate = requireIsoDate(req.body.SessionDate, 'SessionDate');
    const SessionTime = requireIsoTime(req.body.SessionTime, 'SessionTime');
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const info = db.prepare(`
      UPDATE AcademicClassroomEngagement SET
        CompanyID=?,ContactID=?,EngagementType=?,GuestSpeakerName=?,GuestTitle=?,Email=?,PhoneNumber=?,FacultyName=?,CourseNumber=?,CourseTitle=?,TopicTheme=?,SessionDate=?,SessionTime=?,Comment=?
      WHERE EngagementID=?`
    ).run(CompanyID,ContactID,EngagementType,GuestSpeakerName,GuestTitle,Email||null,PhoneNumber||null,FacultyName,CourseNumber,CourseTitle,TopicTheme,SessionDate,SessionTime,Comment||null,req.recordId);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM AcademicClassroomEngagement WHERE EngagementID=?').get(req.recordId));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = db.prepare('DELETE FROM AcademicClassroomEngagement WHERE EngagementID=?').run(req.recordId);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
