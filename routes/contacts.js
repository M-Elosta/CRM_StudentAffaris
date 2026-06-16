const express = require('express');
const router = express.Router();
const {
  optionalPositiveInt,
  optionalTrimmedString,
  parseBoolean,
  requireEmail,
  requireEnum,
  requirePositiveInt,
  requireTrimmedString,
  sendValidationError,
} = require('./_validation');

const VALID_STATUSES = ['Mailable', 'Non-mailable'];

router.param('id', (req, res, next, id) => {
  try {
    req.recordId = requirePositiveInt(id, 'Contact ID');
    next();
  } catch (err) {
    sendValidationError(res, err);
  }
});

// GET /api/contacts  — optional ?search=, ?companyId=, ?status=
router.get('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const search = optionalTrimmedString(req.query.search, 'search', 100);
    const companyId = optionalPositiveInt(req.query.companyId, 'companyId');
    const status = req.query.status ? requireEnum(req.query.status, 'status', VALID_STATUSES) : null;

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
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
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
  `).get(req.recordId);
  if (!row) return res.status(404).json({ error: 'Contact not found' });
  res.json(row);
});

// POST /api/contacts
router.post('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const CompanyID = requirePositiveInt(req.body.CompanyID, 'CompanyID');
    const FirstName = requireTrimmedString(req.body.FirstName, 'FirstName');
    const LastName = requireTrimmedString(req.body.LastName, 'LastName');
    const DateAdded = req.body.DateAdded || null;
    const JobTitle = optionalTrimmedString(req.body.JobTitle, 'JobTitle', 255);
    const EmailAddress = requireEmail(req.body.EmailAddress, 'EmailAddress');
    const Address = optionalTrimmedString(req.body.Address, 'Address', 255);
    const Country = optionalTrimmedString(req.body.Country, 'Country', 100);
    const WorkPhone = optionalTrimmedString(req.body.WorkPhone, 'WorkPhone', 50);
    const Mobile = optionalTrimmedString(req.body.Mobile, 'Mobile', 50);
    const LinkedInURL = optionalTrimmedString(req.body.LinkedInURL, 'LinkedInURL', 255);
    const HandshakeURL = optionalTrimmedString(req.body.HandshakeURL, 'HandshakeURL', 255);
    const Major = optionalTrimmedString(req.body.Major, 'Major', 100);
    const GraduationYear = req.body.GraduationYear ? requirePositiveInt(req.body.GraduationYear, 'GraduationYear') : null;
    const resolvedStatus = req.body.Status ? requireEnum(req.body.Status, 'Status', VALID_STATUSES) : 'Mailable';

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
      FirstName, LastName,
      DateAdded || new Date().toISOString().slice(0, 10),
      JobTitle || null, EmailAddress,
      Address || null, Country || null, WorkPhone || null, Mobile || null,
      LinkedInURL || null, HandshakeURL || null,
      parseBoolean(req.body.CMUQGraduate) ? 1 : 0, Major || null,
      GraduationYear,
      parseBoolean(req.body.PrimaryContact) ? 1 : 0, resolvedStatus,
      parseBoolean(req.body.ResumeBook) ? 1 : 0, parseBoolean(req.body.EventInvitation) ? 1 : 0, parseBoolean(req.body.ExcludeFromMailing) ? 1 : 0
    );
    const created = db.prepare('SELECT * FROM Contact WHERE ContactID = ?').get(info.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/contacts/:id
router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const CompanyID = requirePositiveInt(req.body.CompanyID, 'CompanyID');
    const FirstName = requireTrimmedString(req.body.FirstName, 'FirstName');
    const LastName = requireTrimmedString(req.body.LastName, 'LastName');
    const DateAdded = req.body.DateAdded || null;
    const JobTitle = optionalTrimmedString(req.body.JobTitle, 'JobTitle', 255);
    const EmailAddress = requireEmail(req.body.EmailAddress, 'EmailAddress');
    const Address = optionalTrimmedString(req.body.Address, 'Address', 255);
    const Country = optionalTrimmedString(req.body.Country, 'Country', 100);
    const WorkPhone = optionalTrimmedString(req.body.WorkPhone, 'WorkPhone', 50);
    const Mobile = optionalTrimmedString(req.body.Mobile, 'Mobile', 50);
    const LinkedInURL = optionalTrimmedString(req.body.LinkedInURL, 'LinkedInURL', 255);
    const HandshakeURL = optionalTrimmedString(req.body.HandshakeURL, 'HandshakeURL', 255);
    const Major = optionalTrimmedString(req.body.Major, 'Major', 100);
    const GraduationYear = req.body.GraduationYear ? requirePositiveInt(req.body.GraduationYear, 'GraduationYear') : null;
    const Status = req.body.Status ? requireEnum(req.body.Status, 'Status', VALID_STATUSES) : 'Mailable';

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
      FirstName, LastName,
      DateAdded || new Date().toISOString().slice(0, 10),
      JobTitle || null, EmailAddress,
      Address || null, Country || null, WorkPhone || null, Mobile || null,
      LinkedInURL || null, HandshakeURL || null,
      parseBoolean(req.body.CMUQGraduate) ? 1 : 0, Major || null,
      GraduationYear,
      parseBoolean(req.body.PrimaryContact) ? 1 : 0, Status,
      parseBoolean(req.body.ResumeBook) ? 1 : 0, parseBoolean(req.body.EventInvitation) ? 1 : 0, parseBoolean(req.body.ExcludeFromMailing) ? 1 : 0,
      req.recordId
    );
    if (info.changes === 0) return res.status(404).json({ error: 'Contact not found' });
    const updated = db.prepare('SELECT * FROM Contact WHERE ContactID = ?').get(req.recordId);
    res.json(updated);
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const contact = db.prepare('SELECT FirstName, LastName FROM Contact WHERE ContactID = ?').get(req.recordId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    db.prepare('DELETE FROM Contact WHERE ContactID = ?').run(req.recordId);
    res.json({ message: 'Contact deleted', name: `${contact.FirstName} ${contact.LastName}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
