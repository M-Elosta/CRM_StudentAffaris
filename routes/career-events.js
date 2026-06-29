const express = require('express');
const router = express.Router();
const {
  ensureEnum,
  optionalTrimmed,
  parseBooleanFlag,
  requiredTrimmed,
} = require('./_helpers');

const VALID_REGISTERED_STATUSES = ['Attended', 'No-Show', 'Cancelled'];

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const { eventName, registeredStatus, from, to } = req.query;
  let sql = `
    SELECT e.*, c.CompanyName, co.FirstName || ' ' || co.LastName AS ContactName
    FROM CareerEvent e
    JOIN Company c  ON e.CompanyID = c.CompanyID
    JOIN Contact co ON e.ContactID = co.ContactID
    WHERE 1=1
  `;
  const p = [];
  if (eventName)        { sql += ' AND e.EventName LIKE ?';       p.push(`%${eventName}%`); }
  if (registeredStatus) { sql += ' AND e.RegisteredStatus = ?';   p.push(registeredStatus); }
  if (from)             { sql += ' AND e.EventDate >= ?';         p.push(from); }
  if (to)               { sql += ' AND e.EventDate <= ?';         p.push(to); }
  sql += ' ORDER BY e.EventDate DESC';
  try { res.json(db.prepare(sql).all(...p)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare(`
    SELECT e.*, c.CompanyName, co.FirstName || ' ' || co.LastName AS ContactName
    FROM CareerEvent e JOIN Company c ON e.CompanyID=c.CompanyID JOIN Contact co ON e.ContactID=co.ContactID
    WHERE e.CareerEventID = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const { CompanyID, ContactID, EventName, EventDate, RegisteredStatus, CMUQAlumniAtBooth, Comment } = req.body;
  try {
    const companyId = requiredTrimmed(CompanyID, 'CompanyID');
    const contactId = requiredTrimmed(ContactID, 'ContactID');
    const eventName = requiredTrimmed(EventName, 'EventName');
    const eventDate = requiredTrimmed(EventDate, 'EventDate');
    const registeredStatus = ensureEnum(RegisteredStatus, VALID_REGISTERED_STATUSES, 'RegisteredStatus');
    const info = db.prepare(`
      INSERT INTO CareerEvent (CompanyID, ContactID, EventName, EventDate, RegisteredStatus, CMUQAlumniAtBooth, Comment)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(companyId, contactId, eventName, eventDate, registeredStatus, parseBooleanFlag(CMUQAlumniAtBooth), optionalTrimmed(Comment));
    res.status(201).json(db.prepare('SELECT * FROM CareerEvent WHERE CareerEventID = ?').get(info.lastInsertRowid));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const { CompanyID, ContactID, EventName, EventDate, RegisteredStatus, CMUQAlumniAtBooth, Comment } = req.body;
  try {
    const companyId = requiredTrimmed(CompanyID, 'CompanyID');
    const contactId = requiredTrimmed(ContactID, 'ContactID');
    const eventName = requiredTrimmed(EventName, 'EventName');
    const eventDate = requiredTrimmed(EventDate, 'EventDate');
    const registeredStatus = ensureEnum(RegisteredStatus, VALID_REGISTERED_STATUSES, 'RegisteredStatus');
    const info = db.prepare(`
      UPDATE CareerEvent SET CompanyID=?,ContactID=?,EventName=?,EventDate=?,RegisteredStatus=?,CMUQAlumniAtBooth=?,Comment=?
      WHERE CareerEventID=?`
    ).run(companyId, contactId, eventName, eventDate, registeredStatus, parseBooleanFlag(CMUQAlumniAtBooth), optionalTrimmed(Comment), req.params.id);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM CareerEvent WHERE CareerEventID=?').get(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = db.prepare('DELETE FROM CareerEvent WHERE CareerEventID=?').run(req.params.id);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
