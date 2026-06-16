const express = require('express');
const router = express.Router();
const {
  optionalIsoDate,
  optionalTrimmedString,
  parseBoolean,
  requireIsoDate,
  requirePositiveInt,
  requireTrimmedString,
  sendValidationError,
} = require('./_validation');

router.param('id', (req, res, next, id) => {
  try {
    req.recordId = requirePositiveInt(id, 'Career event ID');
    next();
  } catch (err) {
    sendValidationError(res, err);
  }
});

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const eventName = optionalTrimmedString(req.query.eventName, 'eventName', 100);
    const registeredStatus = optionalTrimmedString(req.query.registeredStatus, 'registeredStatus', 100);
    const from = optionalIsoDate(req.query.from, 'from');
    const to = optionalIsoDate(req.query.to, 'to');
    let sql = `
      SELECT e.*, c.CompanyName, co.FirstName || ' ' || co.LastName AS ContactName
      FROM CareerEvent e
      JOIN Company c  ON e.CompanyID = c.CompanyID
      JOIN Contact co ON e.ContactID = co.ContactID
      WHERE 1=1
    `;
    const p = [];
    if (eventName)        { sql += ' AND e.EventName LIKE ?';     p.push(`%${eventName}%`); }
    if (registeredStatus) { sql += ' AND e.RegisteredStatus = ?'; p.push(registeredStatus); }
    if (from)             { sql += ' AND e.EventDate >= ?';       p.push(from); }
    if (to)               { sql += ' AND e.EventDate <= ?';       p.push(to); }
    sql += ' ORDER BY e.EventDate DESC';
    res.json(db.prepare(sql).all(...p));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare(`
    SELECT e.*, c.CompanyName, co.FirstName || ' ' || co.LastName AS ContactName
    FROM CareerEvent e JOIN Company c ON e.CompanyID=c.CompanyID JOIN Contact co ON e.ContactID=co.ContactID
    WHERE e.CareerEventID = ?`).get(req.recordId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const CompanyID = requirePositiveInt(req.body.CompanyID, 'CompanyID');
    const ContactID = requirePositiveInt(req.body.ContactID, 'ContactID');
    const EventName = requireTrimmedString(req.body.EventName, 'EventName');
    const EventDate = requireIsoDate(req.body.EventDate, 'EventDate');
    const RegisteredStatus = requireTrimmedString(req.body.RegisteredStatus, 'RegisteredStatus', 100);
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const info = db.prepare(`
      INSERT INTO CareerEvent (CompanyID, ContactID, EventName, EventDate, RegisteredStatus, CMUQAlumniAtBooth, Comment)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(CompanyID, ContactID, EventName, EventDate, RegisteredStatus, parseBoolean(req.body.CMUQAlumniAtBooth)?1:0, Comment||null);
    res.status(201).json(db.prepare('SELECT * FROM CareerEvent WHERE CareerEventID = ?').get(info.lastInsertRowid));
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
    const EventName = requireTrimmedString(req.body.EventName, 'EventName');
    const EventDate = requireIsoDate(req.body.EventDate, 'EventDate');
    const RegisteredStatus = requireTrimmedString(req.body.RegisteredStatus, 'RegisteredStatus', 100);
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const info = db.prepare(`
      UPDATE CareerEvent SET CompanyID=?,ContactID=?,EventName=?,EventDate=?,RegisteredStatus=?,CMUQAlumniAtBooth=?,Comment=?
      WHERE CareerEventID=?`
    ).run(CompanyID, ContactID, EventName, EventDate, RegisteredStatus, parseBoolean(req.body.CMUQAlumniAtBooth)?1:0, Comment||null, req.recordId);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM CareerEvent WHERE CareerEventID=?').get(req.recordId));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = db.prepare('DELETE FROM CareerEvent WHERE CareerEventID=?').run(req.recordId);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
