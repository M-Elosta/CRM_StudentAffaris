const express = require('express');
const router = express.Router();

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
  if (!CompanyID || !ContactID || !EventName || !EventDate || !RegisteredStatus)
    return res.status(400).json({ error: 'CompanyID, ContactID, EventName, EventDate, RegisteredStatus are required' });
  try {
    const info = db.prepare(`
      INSERT INTO CareerEvent (CompanyID, ContactID, EventName, EventDate, RegisteredStatus, CMUQAlumniAtBooth, Comment)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(CompanyID, ContactID, EventName.trim(), EventDate, RegisteredStatus, CMUQAlumniAtBooth?1:0, Comment||null);
    res.status(201).json(db.prepare('SELECT * FROM CareerEvent WHERE CareerEventID = ?').get(info.lastInsertRowid));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const { CompanyID, ContactID, EventName, EventDate, RegisteredStatus, CMUQAlumniAtBooth, Comment } = req.body;
  if (!CompanyID || !ContactID || !EventName || !EventDate || !RegisteredStatus)
    return res.status(400).json({ error: 'CompanyID, ContactID, EventName, EventDate, RegisteredStatus are required' });
  try {
    const info = db.prepare(`
      UPDATE CareerEvent SET CompanyID=?,ContactID=?,EventName=?,EventDate=?,RegisteredStatus=?,CMUQAlumniAtBooth=?,Comment=?
      WHERE CareerEventID=?`
    ).run(CompanyID, ContactID, EventName.trim(), EventDate, RegisteredStatus, CMUQAlumniAtBooth?1:0, Comment||null, req.params.id);
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
