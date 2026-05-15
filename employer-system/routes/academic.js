const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const { engagementType, from, to } = req.query;
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
  try { res.json(db.prepare(sql).all(...p)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare(`
    SELECT a.*, c.CompanyName, co.FirstName||' '||co.LastName AS ContactName
    FROM AcademicClassroomEngagement a JOIN Company c ON a.CompanyID=c.CompanyID JOIN Contact co ON a.ContactID=co.ContactID
    WHERE a.EngagementID=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const { CompanyID, ContactID, EngagementType, GuestSpeakerName, GuestTitle, Email, PhoneNumber,
          FacultyName, CourseNumber, CourseTitle, TopicTheme, SessionDate, SessionTime, Comment } = req.body;
  if (!CompanyID||!ContactID||!EngagementType||!GuestSpeakerName||!GuestTitle||!FacultyName||!CourseNumber||!CourseTitle||!TopicTheme||!SessionDate||!SessionTime)
    return res.status(400).json({ error: 'All required fields must be filled' });
  try {
    const info = db.prepare(`
      INSERT INTO AcademicClassroomEngagement
        (CompanyID,ContactID,EngagementType,GuestSpeakerName,GuestTitle,Email,PhoneNumber,FacultyName,CourseNumber,CourseTitle,TopicTheme,SessionDate,SessionTime,Comment)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(CompanyID,ContactID,EngagementType,GuestSpeakerName.trim(),GuestTitle.trim(),Email||null,PhoneNumber||null,FacultyName.trim(),CourseNumber.trim(),CourseTitle.trim(),TopicTheme.trim(),SessionDate,SessionTime,Comment||null);
    res.status(201).json(db.prepare('SELECT * FROM AcademicClassroomEngagement WHERE EngagementID=?').get(info.lastInsertRowid));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const { CompanyID, ContactID, EngagementType, GuestSpeakerName, GuestTitle, Email, PhoneNumber,
          FacultyName, CourseNumber, CourseTitle, TopicTheme, SessionDate, SessionTime, Comment } = req.body;
  if (!CompanyID||!ContactID||!EngagementType||!GuestSpeakerName||!GuestTitle||!FacultyName||!CourseNumber||!CourseTitle||!TopicTheme||!SessionDate||!SessionTime)
    return res.status(400).json({ error: 'All required fields must be filled' });
  try {
    const info = db.prepare(`
      UPDATE AcademicClassroomEngagement SET
        CompanyID=?,ContactID=?,EngagementType=?,GuestSpeakerName=?,GuestTitle=?,Email=?,PhoneNumber=?,FacultyName=?,CourseNumber=?,CourseTitle=?,TopicTheme=?,SessionDate=?,SessionTime=?,Comment=?
      WHERE EngagementID=?`
    ).run(CompanyID,ContactID,EngagementType,GuestSpeakerName.trim(),GuestTitle.trim(),Email||null,PhoneNumber||null,FacultyName.trim(),CourseNumber.trim(),CourseTitle.trim(),TopicTheme.trim(),SessionDate,SessionTime,Comment||null,req.params.id);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM AcademicClassroomEngagement WHERE EngagementID=?').get(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = db.prepare('DELETE FROM AcademicClassroomEngagement WHERE EngagementID=?').run(req.params.id);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
