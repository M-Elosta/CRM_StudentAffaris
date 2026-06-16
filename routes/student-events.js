const express = require('express');
const router = express.Router();
const {
  optionalIsoDate,
  optionalTrimmedString,
  requireEmail,
  requireIsoDate,
  requirePositiveInt,
  requireTrimmedString,
  sendValidationError,
} = require('./_validation');

router.param('id', (req, res, next, id) => {
  try {
    req.recordId = requirePositiveInt(id, 'Student event ID');
    next();
  } catch (err) {
    sendValidationError(res, err);
  }
});

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const collaborationOutcome = optionalTrimmedString(req.query.collaborationOutcome, 'collaborationOutcome', 100);
    const from = optionalIsoDate(req.query.from, 'from');
    const to = optionalIsoDate(req.query.to, 'to');
    let sql = `
      SELECT s.*, c.CompanyName, co.FirstName||' '||co.LastName AS ContactName
      FROM StudentLedEvent s JOIN Company c ON s.CompanyID=c.CompanyID JOIN Contact co ON s.ContactID=co.ContactID
      WHERE 1=1`;
    const p = [];
    if (collaborationOutcome) { sql += ' AND s.CollaborationOutcome=?'; p.push(collaborationOutcome); }
    if (from)                 { sql += ' AND s.ProposalDate>=?';        p.push(from); }
    if (to)                   { sql += ' AND s.ProposalDate<=?';        p.push(to); }
    sql += ' ORDER BY s.ProposalDate DESC';
    res.json(db.prepare(sql).all(...p));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare(`SELECT s.*, c.CompanyName, co.FirstName||' '||co.LastName AS ContactName FROM StudentLedEvent s JOIN Company c ON s.CompanyID=c.CompanyID JOIN Contact co ON s.ContactID=co.ContactID WHERE s.StudentLedEventID=?`).get(req.recordId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const CompanyID = requirePositiveInt(req.body.CompanyID, 'CompanyID');
    const ContactID = requirePositiveInt(req.body.ContactID, 'ContactID');
    const ProposalDate = requireIsoDate(req.body.ProposalDate, 'ProposalDate');
    const OrganizationName = requireTrimmedString(req.body.OrganizationName, 'OrganizationName');
    const StudentName = requireTrimmedString(req.body.StudentName, 'StudentName');
    const StudentEmail = requireEmail(req.body.StudentEmail, 'StudentEmail');
    const StudentPhoneNumber = requireTrimmedString(req.body.StudentPhoneNumber, 'StudentPhoneNumber', 50);
    const CollaborationOutcome = optionalTrimmedString(req.body.CollaborationOutcome, 'CollaborationOutcome', 100) || 'Pending';
    const EventDate = optionalIsoDate(req.body.EventDate, 'EventDate');
    const EventTitle = optionalTrimmedString(req.body.EventTitle, 'EventTitle', 255);
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const info = db.prepare(`INSERT INTO StudentLedEvent (CompanyID,ContactID,ProposalDate,OrganizationName,StudentName,StudentEmail,StudentPhoneNumber,CollaborationOutcome,EventDate,EventTitle,Comment) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(CompanyID,ContactID,ProposalDate,OrganizationName,StudentName,StudentEmail,StudentPhoneNumber,CollaborationOutcome,EventDate||null,EventTitle||null,Comment||null);
    res.status(201).json(db.prepare('SELECT * FROM StudentLedEvent WHERE StudentLedEventID=?').get(info.lastInsertRowid));
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
    const ProposalDate = requireIsoDate(req.body.ProposalDate, 'ProposalDate');
    const OrganizationName = requireTrimmedString(req.body.OrganizationName, 'OrganizationName');
    const StudentName = requireTrimmedString(req.body.StudentName, 'StudentName');
    const StudentEmail = requireEmail(req.body.StudentEmail, 'StudentEmail');
    const StudentPhoneNumber = requireTrimmedString(req.body.StudentPhoneNumber, 'StudentPhoneNumber', 50);
    const CollaborationOutcome = optionalTrimmedString(req.body.CollaborationOutcome, 'CollaborationOutcome', 100) || 'Pending';
    const EventDate = optionalIsoDate(req.body.EventDate, 'EventDate');
    const EventTitle = optionalTrimmedString(req.body.EventTitle, 'EventTitle', 255);
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const info = db.prepare(`UPDATE StudentLedEvent SET CompanyID=?,ContactID=?,ProposalDate=?,OrganizationName=?,StudentName=?,StudentEmail=?,StudentPhoneNumber=?,CollaborationOutcome=?,EventDate=?,EventTitle=?,Comment=? WHERE StudentLedEventID=?`
    ).run(CompanyID,ContactID,ProposalDate,OrganizationName,StudentName,StudentEmail,StudentPhoneNumber,CollaborationOutcome,EventDate||null,EventTitle||null,Comment||null,req.recordId);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM StudentLedEvent WHERE StudentLedEventID=?').get(req.recordId));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = db.prepare('DELETE FROM StudentLedEvent WHERE StudentLedEventID=?').run(req.recordId);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
