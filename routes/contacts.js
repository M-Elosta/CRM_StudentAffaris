const express = require('express');
const router = express.Router();
const {
  optionalDateString,
  optionalInteger,
  optionalTrimmed,
  parseBooleanFlag,
  requiredTrimmed,
  resolveContactStatus,
  todayDate,
} = require('./_helpers');

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

  try {
    const companyId = requiredTrimmed(CompanyID, 'CompanyID');
    const firstName = requiredTrimmed(FirstName, 'FirstName');
    const lastName = requiredTrimmed(LastName, 'LastName');
    const emailAddress = requiredTrimmed(EmailAddress, 'EmailAddress');
    const resolvedStatus = resolveContactStatus(db, companyId, Status);
    const stmt = db.prepare(`
      INSERT INTO Contact
        (CompanyID, FirstName, LastName, DateAdded, JobTitle, EmailAddress,
         Address, Country, WorkPhone, Mobile, LinkedInURL, HandshakeURL,
         CMUQGraduate, Major, GraduationYear, PrimaryContact, Status,
         ResumeBook, EventInvitation, ExcludeFromMailing)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      companyId,
      firstName,
      lastName,
      optionalDateString(DateAdded) || todayDate(),
      optionalTrimmed(JobTitle),
      emailAddress,
      optionalTrimmed(Address),
      optionalTrimmed(Country),
      optionalTrimmed(WorkPhone),
      optionalTrimmed(Mobile),
      optionalTrimmed(LinkedInURL),
      optionalTrimmed(HandshakeURL),
      parseBooleanFlag(CMUQGraduate),
      optionalTrimmed(Major),
      optionalInteger(GraduationYear, 'GraduationYear'),
      parseBooleanFlag(PrimaryContact),
      resolvedStatus,
      parseBooleanFlag(ResumeBook),
      parseBooleanFlag(EventInvitation),
      parseBooleanFlag(ExcludeFromMailing)
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

  try {
    const companyId = requiredTrimmed(CompanyID, 'CompanyID');
    const firstName = requiredTrimmed(FirstName, 'FirstName');
    const lastName = requiredTrimmed(LastName, 'LastName');
    const emailAddress = requiredTrimmed(EmailAddress, 'EmailAddress');
    const resolvedStatus = resolveContactStatus(db, companyId, Status);
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
      companyId,
      firstName,
      lastName,
      optionalDateString(DateAdded) || todayDate(),
      optionalTrimmed(JobTitle),
      emailAddress,
      optionalTrimmed(Address),
      optionalTrimmed(Country),
      optionalTrimmed(WorkPhone),
      optionalTrimmed(Mobile),
      optionalTrimmed(LinkedInURL),
      optionalTrimmed(HandshakeURL),
      parseBooleanFlag(CMUQGraduate),
      optionalTrimmed(Major),
      optionalInteger(GraduationYear, 'GraduationYear'),
      parseBooleanFlag(PrimaryContact),
      resolvedStatus,
      parseBooleanFlag(ResumeBook),
      parseBooleanFlag(EventInvitation),
      parseBooleanFlag(ExcludeFromMailing),
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
