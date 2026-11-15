const express = require('express');
const router = express.Router();
const {
  optionalIsoDate,
  optionalHttpUrl,
  optionalTrimmedString,
  parseBoolean,
  requireEnum,
  requirePositiveInt,
  requireTrimmedString,
  sendValidationError,
} = require('./_validation');
const { ensureRecordNotStale } = require('./_records');

const VALID_SECTORS = ['Government', 'NGO', 'Private', 'Semi-government', 'Startup'];

router.param('id', (req, res, next, id) => {
  try {
    req.recordId = requirePositiveInt(id, 'Company ID');
    next();
  } catch (err) {
    sendValidationError(res, err);
  }
});

// GET /api/companies  — list all, optional ?search=
router.get('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const search = optionalTrimmedString(req.query.search, 'search', 100);
    let sql = 'SELECT * FROM Company';
    const params = [];

    if (search) {
      sql += ' WHERE (CompanyName LIKE ? OR Country LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY CompanyName ASC';
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

// GET /api/companies/:id
router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare('SELECT * FROM Company WHERE CompanyID = ?').get(req.recordId);
  if (!row) return res.status(404).json({ error: 'Company not found' });
  res.json(row);
});

// POST /api/companies
router.post('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    ensureRecordNotStale(db, 'Company', 'CompanyID', req.recordId, req.body.UpdatedAt, 'Company not found');
    const CompanyName = requireTrimmedString(req.body.CompanyName, 'CompanyName');
    const DateAdded = optionalIsoDate(req.body.DateAdded, 'DateAdded');
    const Industry = requireTrimmedString(req.body.Industry, 'Industry');
    const Sector = requireEnum(req.body.Sector, 'Sector', VALID_SECTORS);
    const Country = requireTrimmedString(req.body.Country, 'Country');
    const Address = optionalTrimmedString(req.body.Address, 'Address', 255);
    const Website = optionalHttpUrl(req.body.Website, 'Website', 255);
    const LinkedInURL = optionalHttpUrl(req.body.LinkedInURL, 'LinkedInURL', 255);
    const HandshakeURL = optionalHttpUrl(req.body.HandshakeURL, 'HandshakeURL', 255);
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const SignedMoU = parseBoolean(req.body.SignedMoU);
    const FavoriteEmployer = parseBoolean(req.body.FavoriteEmployer);
    const Blacklisted = parseBoolean(req.body.Blacklisted);

    const stmt = db.prepare(`
      INSERT INTO Company
        (CompanyName, DateAdded, Industry, Sector, Country, Address, Website,
         LinkedInURL, HandshakeURL, SignedMoU, FavoriteEmployer, Blacklisted, Comment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      CompanyName,
      DateAdded || new Date().toISOString().slice(0, 10),
      Industry, Sector, Country,
      Address || null, Website || null, LinkedInURL || null, HandshakeURL || null,
      SignedMoU ? 1 : 0, FavoriteEmployer ? 1 : 0, Blacklisted ? 1 : 0,
      Comment || null
    );
    const created = db.prepare('SELECT * FROM Company WHERE CompanyID = ?').get(info.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

// PUT /api/companies/:id
router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const CompanyName = requireTrimmedString(req.body.CompanyName, 'CompanyName');
    const DateAdded = optionalIsoDate(req.body.DateAdded, 'DateAdded');
    const Industry = requireTrimmedString(req.body.Industry, 'Industry');
    const Sector = requireEnum(req.body.Sector, 'Sector', VALID_SECTORS);
    const Country = requireTrimmedString(req.body.Country, 'Country');
    const Address = optionalTrimmedString(req.body.Address, 'Address', 255);
    const Website = optionalHttpUrl(req.body.Website, 'Website', 255);
    const LinkedInURL = optionalHttpUrl(req.body.LinkedInURL, 'LinkedInURL', 255);
    const HandshakeURL = optionalHttpUrl(req.body.HandshakeURL, 'HandshakeURL', 255);
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const SignedMoU = parseBoolean(req.body.SignedMoU);
    const FavoriteEmployer = parseBoolean(req.body.FavoriteEmployer);
    const Blacklisted = parseBoolean(req.body.Blacklisted);

    const stmt = db.prepare(`
      UPDATE Company SET
        CompanyName = ?, DateAdded = ?, Industry = ?, Sector = ?, Country = ?,
        Address = ?, Website = ?, LinkedInURL = ?, HandshakeURL = ?,
        SignedMoU = ?, FavoriteEmployer = ?, Blacklisted = ?, Comment = ?
      WHERE CompanyID = ?
    `);
    const info = stmt.run(
      CompanyName,
      DateAdded || new Date().toISOString().slice(0, 10),
      Industry, Sector, Country,
      Address || null, Website || null, LinkedInURL || null, HandshakeURL || null,
      SignedMoU ? 1 : 0, FavoriteEmployer ? 1 : 0, Blacklisted ? 1 : 0,
      Comment || null,
      req.recordId
    );
    if (info.changes === 0) return res.status(404).json({ error: 'Company not found' });
    if (Blacklisted) {
      db.prepare("UPDATE Contact SET Status='Non-mailable' WHERE CompanyID=?").run(req.recordId);
    }
    const updated = db.prepare('SELECT * FROM Company WHERE CompanyID = ?').get(req.recordId);
    res.json(updated);
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

// DELETE /api/companies/:id
router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  const id = req.recordId;

  const contactCount  = db.prepare('SELECT COUNT(*) AS n FROM Contact WHERE CompanyID = ?').get(id).n;
  const outreachCount = db.prepare('SELECT COUNT(*) AS n FROM OutreachEngagement WHERE CompanyID = ?').get(id).n;
  const recruitCount  = db.prepare('SELECT COUNT(*) AS n FROM Recruitment WHERE CompanyID = ?').get(id).n;
  const eventCount    = db.prepare('SELECT COUNT(*) AS n FROM CareerEvent WHERE CompanyID = ?').get(id).n;

  try {
    const info = db.prepare('DELETE FROM Company WHERE CompanyID = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ error: 'Company not found' });
    res.json({
      message: 'Company deleted',
      deleted: { contacts: contactCount, outreach: outreachCount, recruitment: recruitCount, events: eventCount }
    });
  } catch (err) {
    req.app.locals.respondServerError(req, res, err);
  }
});

// GET /api/companies/:id/related-counts  — pre-delete warning counts
router.get('/:id/related-counts', (req, res) => {
  const db = req.app.locals.db;
  const id = req.recordId;
  const company = db.prepare('SELECT CompanyName FROM Company WHERE CompanyID = ?').get(id);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  res.json({
    companyName: company.CompanyName,
    contacts:    db.prepare('SELECT COUNT(*) AS n FROM Contact WHERE CompanyID = ?').get(id).n,
    outreach:    db.prepare('SELECT COUNT(*) AS n FROM OutreachEngagement WHERE CompanyID = ?').get(id).n,
    recruitment: db.prepare('SELECT COUNT(*) AS n FROM Recruitment WHERE CompanyID = ?').get(id).n,
    events:      db.prepare('SELECT COUNT(*) AS n FROM CareerEvent WHERE CompanyID = ?').get(id).n,
    academic:    db.prepare('SELECT COUNT(*) AS n FROM AcademicClassroomEngagement WHERE CompanyID = ?').get(id).n,
    studentEvents: db.prepare('SELECT COUNT(*) AS n FROM StudentLedEvent WHERE CompanyID = ?').get(id).n,
  });
});

module.exports = router;
