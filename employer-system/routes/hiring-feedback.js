const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const { feedbackProvider, hiredStudentAlumni, from, to } = req.query;
  let sql = `
    SELECT h.*, c.CompanyName, co.FirstName||' '||co.LastName AS ContactName
    FROM HiringFeedback h JOIN Company c ON h.CompanyID=c.CompanyID JOIN Contact co ON h.ContactID=co.ContactID
    WHERE 1=1`;
  const p = [];
  if (feedbackProvider)    { sql += ' AND h.FeedbackProvider=?';    p.push(feedbackProvider); }
  if (hiredStudentAlumni)  { sql += ' AND h.HiredStudentAlumni=?';  p.push(hiredStudentAlumni); }
  if (from)                { sql += ' AND h.DateReported>=?';       p.push(from); }
  if (to)                  { sql += ' AND h.DateReported<=?';       p.push(to); }
  sql += ' ORDER BY h.DateReported DESC';
  try { res.json(db.prepare(sql).all(...p)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare(`SELECT h.*, c.CompanyName, co.FirstName||' '||co.LastName AS ContactName FROM HiringFeedback h JOIN Company c ON h.CompanyID=c.CompanyID JOIN Contact co ON h.ContactID=co.ContactID WHERE h.HiringFeedbackID=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const { CompanyID, ContactID, FeedbackProvider, HiredStudentAlumni, DateReported, HiredStudentName, Comment } = req.body;
  if (!CompanyID||!ContactID||!FeedbackProvider||!HiredStudentAlumni||!DateReported)
    return res.status(400).json({ error: 'CompanyID, ContactID, FeedbackProvider, HiredStudentAlumni, DateReported are required' });
  try {
    const info = db.prepare(`INSERT INTO HiringFeedback (CompanyID,ContactID,FeedbackProvider,HiredStudentAlumni,DateReported,HiredStudentName,Comment) VALUES (?,?,?,?,?,?,?)`
    ).run(CompanyID,ContactID,FeedbackProvider,HiredStudentAlumni,DateReported,HiredStudentName||null,Comment||null);
    res.status(201).json(db.prepare('SELECT * FROM HiringFeedback WHERE HiringFeedbackID=?').get(info.lastInsertRowid));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const { CompanyID, ContactID, FeedbackProvider, HiredStudentAlumni, DateReported, HiredStudentName, Comment } = req.body;
  if (!CompanyID||!ContactID||!FeedbackProvider||!HiredStudentAlumni||!DateReported)
    return res.status(400).json({ error: 'CompanyID, ContactID, FeedbackProvider, HiredStudentAlumni, DateReported are required' });
  try {
    const info = db.prepare(`UPDATE HiringFeedback SET CompanyID=?,ContactID=?,FeedbackProvider=?,HiredStudentAlumni=?,DateReported=?,HiredStudentName=?,Comment=? WHERE HiringFeedbackID=?`
    ).run(CompanyID,ContactID,FeedbackProvider,HiredStudentAlumni,DateReported,HiredStudentName||null,Comment||null,req.params.id);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM HiringFeedback WHERE HiringFeedbackID=?').get(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = db.prepare('DELETE FROM HiringFeedback WHERE HiringFeedbackID=?').run(req.params.id);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
