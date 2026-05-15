const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const { collaborationOutcome, from, to } = req.query;
  let sql = `
    SELECT s.*, c.CompanyName, co.FirstName||' '||co.LastName AS ContactName
    FROM StudentLedEvent s JOIN Company c ON s.CompanyID=c.CompanyID JOIN Contact co ON s.ContactID=co.ContactID
    WHERE 1=1`;
  const p = [];
  if (collaborationOutcome) { sql += ' AND s.CollaborationOutcome=?'; p.push(collaborationOutcome); }
  if (from)                 { sql += ' AND s.ProposalDate>=?';        p.push(from); }
  if (to)                   { sql += ' AND s.ProposalDate<=?';        p.push(to); }
  sql += ' ORDER BY s.ProposalDate DESC';
  try { res.json(db.prepare(sql).all(...p)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare(`SELECT s.*, c.CompanyName, co.FirstName||' '||co.LastName AS ContactName FROM StudentLedEvent s JOIN Company c ON s.CompanyID=c.CompanyID JOIN Contact co ON s.ContactID=co.ContactID WHERE s.StudentLedEventID=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const { CompanyID, ContactID, ProposalDate, OrganizationName, StudentName, StudentEmail, StudentPhoneNumber, CollaborationOutcome, EventDate, EventTitle, Comment } = req.body;
  if (!CompanyID||!ContactID||!ProposalDate||!OrganizationName||!StudentName||!StudentEmail||!StudentPhoneNumber)
    return res.status(400).json({ error: 'Required fields missing' });
  try {
    const info = db.prepare(`INSERT INTO StudentLedEvent (CompanyID,ContactID,ProposalDate,OrganizationName,StudentName,StudentEmail,StudentPhoneNumber,CollaborationOutcome,EventDate,EventTitle,Comment) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(CompanyID,ContactID,ProposalDate,OrganizationName.trim(),StudentName.trim(),StudentEmail.trim(),StudentPhoneNumber.trim(),CollaborationOutcome||'Pending',EventDate||null,EventTitle||null,Comment||null);
    res.status(201).json(db.prepare('SELECT * FROM StudentLedEvent WHERE StudentLedEventID=?').get(info.lastInsertRowid));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const { CompanyID, ContactID, ProposalDate, OrganizationName, StudentName, StudentEmail, StudentPhoneNumber, CollaborationOutcome, EventDate, EventTitle, Comment } = req.body;
  if (!CompanyID||!ContactID||!ProposalDate||!OrganizationName||!StudentName||!StudentEmail||!StudentPhoneNumber)
    return res.status(400).json({ error: 'Required fields missing' });
  try {
    const info = db.prepare(`UPDATE StudentLedEvent SET CompanyID=?,ContactID=?,ProposalDate=?,OrganizationName=?,StudentName=?,StudentEmail=?,StudentPhoneNumber=?,CollaborationOutcome=?,EventDate=?,EventTitle=?,Comment=? WHERE StudentLedEventID=?`
    ).run(CompanyID,ContactID,ProposalDate,OrganizationName.trim(),StudentName.trim(),StudentEmail.trim(),StudentPhoneNumber.trim(),CollaborationOutcome||'Pending',EventDate||null,EventTitle||null,Comment||null,req.params.id);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM StudentLedEvent WHERE StudentLedEventID=?').get(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = db.prepare('DELETE FROM StudentLedEvent WHERE StudentLedEventID=?').run(req.params.id);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
