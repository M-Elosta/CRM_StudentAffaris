const express = require('express');
const router = express.Router();

// GET /api/contacts  — optional ?search=, ?companyId=, ?status=
router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const { search, companyId, status } = req.query;

  let sql = `
    SELECT c.*, co.CompanyName
    FROM Contact c
    JOIN Company co ON c.CompanyID = co.CompanyID
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    sql += ' AND (c.FirstName LIKE ? OR c.LastName LIKE ? OR c.EmailAddress LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (companyId) {
    sql += ' AND c.CompanyID = ?';
    params.push(companyId);
  }
  if (status) {
    sql += ' AND c.Status = ?';
    params.push(status);
  }

  sql += ' ORDER BY c.LastName ASC, c.FirstName ASC';

  try {
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contacts/:id
router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare(`
    SELECT c.*, co.CompanyName
    FROM Contact c
    JOIN Company co ON c.CompanyID = co.CompanyID
    WHERE c.ContactID = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Contact not found' });
  res.json(row);
});

// POST /api/contacts
router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const {
    CompanyID, FirstName, LastName, DateAdded, JobTitle,
    EmailAddress, Address, Country, WorkPhone, Mobile,
    LinkedInURL, HandshakeURL, CMUQGraduate, Major, GraduationYear,
    PrimaryContact, Status, ResumeBook, EventInvitation, ExcludeFromMailing
  } = req.body;

  if (!CompanyID)    return res.status(400).json({ error: 'CompanyID is required' });
  if (!FirstName)    return res.status(400).json({ error: 'FirstName is required' });
  if (!LastName)     return res.status(400).json({ error: 'LastName is required' });
  if (!EmailAddress) return res.status(400).json({ error: 'EmailAddress is required' });

  const validStatuses = ['Mailable', 'Non-mailable'];
  const resolvedStatus = Status || 'Mailable';
  if (!validStatuses.includes(resolvedStatus)) {
    return res.status(400).json({ error: 'Status must be Mailable or Non-mailable' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO Contact
        (CompanyID, FirstName, LastName, DateAdded, JobTitle, EmailAddress,
         Address, Country, WorkPhone, Mobile, LinkedInURL, HandshakeURL,
         CMUQGraduate, Major, GraduationYear, PrimaryContact, Status,
         ResumeBook, EventInvitation, ExcludeFromMailing)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      CompanyID,
      FirstName.trim(), LastName.trim(),
      DateAdded || new Date().toISOString().slice(0, 10),
      JobTitle || null, EmailAddress.trim(),
      Address || null, Country || null, WorkPhone || null, Mobile || null,
      LinkedInURL || null, HandshakeURL || null,
      CMUQGraduate ? 1 : 0, Major || null,
      GraduationYear ? parseInt(GraduationYear) : null,
      PrimaryContact ? 1 : 0, resolvedStatus,
      ResumeBook ? 1 : 0, EventInvitation ? 1 : 0, ExcludeFromMailing ? 1 : 0
    );
    const created = db.prepare('SELECT * FROM Contact WHERE ContactID = ?').get(info.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/contacts/:id
router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const {
    CompanyID, FirstName, LastName, DateAdded, JobTitle,
    EmailAddress, Address, Country, WorkPhone, Mobile,
    LinkedInURL, HandshakeURL, CMUQGraduate, Major, GraduationYear,
    PrimaryContact, Status, ResumeBook, EventInvitation, ExcludeFromMailing
  } = req.body;

  if (!CompanyID)    return res.status(400).json({ error: 'CompanyID is required' });
  if (!FirstName)    return res.status(400).json({ error: 'FirstName is required' });
  if (!LastName)     return res.status(400).json({ error: 'LastName is required' });
  if (!EmailAddress) return res.status(400).json({ error: 'EmailAddress is required' });

  const validStatuses = ['Mailable', 'Non-mailable'];
  if (Status && !validStatuses.includes(Status)) {
    return res.status(400).json({ error: 'Status must be Mailable or Non-mailable' });
  }

  try {
    const stmt = db.prepare(`
      UPDATE Contact SET
        CompanyID = ?, FirstName = ?, LastName = ?, DateAdded = ?, JobTitle = ?,
        EmailAddress = ?, Address = ?, Country = ?, WorkPhone = ?, Mobile = ?,
        LinkedInURL = ?, HandshakeURL = ?, CMUQGraduate = ?, Major = ?,
        GraduationYear = ?, PrimaryContact = ?, Status = ?,
        ResumeBook = ?, EventInvitation = ?, ExcludeFromMailing = ?
      WHERE ContactID = ?
    `);
    const info = stmt.run(
      CompanyID,
      FirstName.trim(), LastName.trim(),
      DateAdded || new Date().toISOString().slice(0, 10),
      JobTitle || null, EmailAddress.trim(),
      Address || null, Country || null, WorkPhone || null, Mobile || null,
      LinkedInURL || null, HandshakeURL || null,
      CMUQGraduate ? 1 : 0, Major || null,
      GraduationYear ? parseInt(GraduationYear) : null,
      PrimaryContact ? 1 : 0, Status || 'Mailable',
      ResumeBook ? 1 : 0, EventInvitation ? 1 : 0, ExcludeFromMailing ? 1 : 0,
      req.params.id
    );
    if (info.changes === 0) return res.status(404).json({ error: 'Contact not found' });
    const updated = db.prepare('SELECT * FROM Contact WHERE ContactID = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const contact = db.prepare('SELECT FirstName, LastName FROM Contact WHERE ContactID = ?').get(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    db.prepare('DELETE FROM Contact WHERE ContactID = ?').run(req.params.id);
    res.json({ message: 'Contact deleted', name: `${contact.FirstName} ${contact.LastName}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
