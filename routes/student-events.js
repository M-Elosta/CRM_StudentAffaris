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
const { ensureRecordNotStale } = require('./_records');

router.param('id', (req, res, next, id) => {
  try {
    req.recordId = requirePositiveInt(id, 'Student event ID');
    next();
  } catch (err) {
    sendValidationError(res, err);
  }
});

router.get('/', async (req, res) => {
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
    res.json((await db.prepare(sql).all(...p)));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

router.get('/:id', async (req, res) => {
  const db = req.app.locals.db;
  const row = (await db.prepare(`SELECT s.*, c.CompanyName, co.FirstName||' '||co.LastName AS ContactName FROM StudentLedEvent s JOIN Company c ON s.CompanyID=c.CompanyID JOIN Contact co ON s.ContactID=co.ContactID WHERE s.StudentLedEventID=?`).get(req.recordId));
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', async (req, res) => {
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
    const info = await db.prepare(`INSERT INTO StudentLedEvent (CompanyID,ContactID,ProposalDate,OrganizationName,StudentName,StudentEmail,StudentPhoneNumber,CollaborationOutcome,EventDate,EventTitle,Comment) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(CompanyID,ContactID,ProposalDate,OrganizationName,StudentName,StudentEmail,StudentPhoneNumber,CollaborationOutcome,EventDate||null,EventTitle||null,Comment||null);
    res.status(201).json((await db.prepare('SELECT * FROM StudentLedEvent WHERE StudentLedEventID=?').get(info.lastInsertRowid)));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

router.put('/:id', async (req, res) => {
  const db = req.app.locals.db;
  try {
    await ensureRecordNotStale(db, 'StudentLedEvent', 'StudentLedEventID', req.recordId, req.body.UpdatedAt, 'Not found');
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
    const info = await db.prepare(`UPDATE StudentLedEvent SET CompanyID=?,ContactID=?,ProposalDate=?,OrganizationName=?,StudentName=?,StudentEmail=?,StudentPhoneNumber=?,CollaborationOutcome=?,EventDate=?,EventTitle=?,Comment=? WHERE StudentLedEventID=?`
    ).run(CompanyID,ContactID,ProposalDate,OrganizationName,StudentName,StudentEmail,StudentPhoneNumber,CollaborationOutcome,EventDate||null,EventTitle||null,Comment||null,req.recordId);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json((await db.prepare('SELECT * FROM StudentLedEvent WHERE StudentLedEventID=?').get(req.recordId)));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

router.delete('/:id', async (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = (await db.prepare('DELETE FROM StudentLedEvent WHERE StudentLedEventID=?').run(req.recordId));
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { req.app.locals.respondServerError(req, res, err); }
});

module.exports = router;
