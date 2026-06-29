const express = require('express');
const router = express.Router();
const {
  ensureEnum,
  optionalDateString,
  optionalTrimmed,
  parseBooleanFlag,
  requiredTrimmed,
  todayDate,
} = require('./_helpers');

// GET /api/companies  — list all, optional ?search=
router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const { search } = req.query;

  let sql = 'SELECT * FROM Company';
  const params = [];

  if (search) {
    sql += ' WHERE (CompanyName LIKE ? OR Country LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY CompanyName ASC';

  try {
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/companies/:id
router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare('SELECT * FROM Company WHERE CompanyID = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Company not found' });
  res.json(row);
});

// POST /api/companies
router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const {
    CompanyName, DateAdded, Industry, Sector, Country,
    Address, Website, LinkedInURL, HandshakeURL,
    SignedMoU, FavoriteEmployer, Blacklisted, Comment
  } = req.body;

  try {
    const companyName = requiredTrimmed(CompanyName, 'CompanyName');
    const industry = requiredTrimmed(Industry, 'Industry');
    const sector = ensureEnum(Sector, ['Government', 'NGO', 'Private', 'Semi-government', 'Startup'], 'Sector');
    const country = requiredTrimmed(Country, 'Country');
    const stmt = db.prepare(`
      INSERT INTO Company
        (CompanyName, DateAdded, Industry, Sector, Country, Address, Website,
         LinkedInURL, HandshakeURL, SignedMoU, FavoriteEmployer, Blacklisted, Comment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      companyName,
      optionalDateString(DateAdded) || todayDate(),
      industry,
      sector,
      country,
      optionalTrimmed(Address),
      optionalTrimmed(Website),
      optionalTrimmed(LinkedInURL),
      optionalTrimmed(HandshakeURL),
      parseBooleanFlag(SignedMoU),
      parseBooleanFlag(FavoriteEmployer),
      parseBooleanFlag(Blacklisted),
      optionalTrimmed(Comment)
    );
    const created = db.prepare('SELECT * FROM Company WHERE CompanyID = ?').get(info.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/companies/:id
router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const {
    CompanyName, DateAdded, Industry, Sector, Country,
    Address, Website, LinkedInURL, HandshakeURL,
    SignedMoU, FavoriteEmployer, Blacklisted, Comment
  } = req.body;

  try {
    const companyName = requiredTrimmed(CompanyName, 'CompanyName');
    const industry = requiredTrimmed(Industry, 'Industry');
    const sector = ensureEnum(Sector, ['Government', 'NGO', 'Private', 'Semi-government', 'Startup'], 'Sector');
    const country = requiredTrimmed(Country, 'Country');
    const stmt = db.prepare(`
      UPDATE Company SET
        CompanyName = ?, DateAdded = ?, Industry = ?, Sector = ?, Country = ?,
        Address = ?, Website = ?, LinkedInURL = ?, HandshakeURL = ?,
        SignedMoU = ?, FavoriteEmployer = ?, Blacklisted = ?, Comment = ?
      WHERE CompanyID = ?
    `);
    const info = stmt.run(
      companyName,
      optionalDateString(DateAdded) || todayDate(),
      industry,
      sector,
      country,
      optionalTrimmed(Address),
      optionalTrimmed(Website),
      optionalTrimmed(LinkedInURL),
      optionalTrimmed(HandshakeURL),
      parseBooleanFlag(SignedMoU),
      parseBooleanFlag(FavoriteEmployer),
      parseBooleanFlag(Blacklisted),
      optionalTrimmed(Comment),
      req.params.id
    );
    if (info.changes === 0) return res.status(404).json({ error: 'Company not found' });
    if (parseBooleanFlag(Blacklisted)) {
      db.prepare("UPDATE Contact SET Status='Non-mailable' WHERE CompanyID=?").run(req.params.id);
    }
    const updated = db.prepare('SELECT * FROM Company WHERE CompanyID = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/companies/:id
router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  const id = req.params.id;

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
    res.status(500).json({ error: err.message });
  }
});

// GET /api/companies/:id/related-counts  — pre-delete warning counts
router.get('/:id/related-counts', (req, res) => {
  const db = req.app.locals.db;
  const id = req.params.id;
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
