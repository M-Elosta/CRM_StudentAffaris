const express = require('express');
const router = express.Router();
const {
  optionalIsoDate,
  optionalPositiveInt,
  optionalStringArray,
  optionalTrimmedString,
  parseBoolean,
  requireIsoDate,
  requirePositiveInt,
  requireTrimmedString,
  sendValidationError,
} = require('./_validation');

function getJunction(db, table, col, id) {
  return db.prepare(`SELECT ${col} FROM ${table} WHERE RecruitmentID = ?`).all(id).map(r => r[col]);
}

function setJunction(db, table, col, recruitmentId, values) {
  db.prepare(`DELETE FROM ${table} WHERE RecruitmentID = ?`).run(recruitmentId);
  const ins = db.prepare(`INSERT INTO ${table} (RecruitmentID, ${col}) VALUES (?, ?)`);
  for (const v of (values || [])) ins.run(recruitmentId, v);
}

function hydrate(db, row) {
  if (!row) return null;
  return {
    ...row,
    OpportunityTypes:      getJunction(db, 'Recruitment_OpportunityType', 'Type', row.RecruitmentID),
    CollectApplications:   getJunction(db, 'Recruitment_CollectApplications', 'Channel', row.RecruitmentID),
    TargetMajors:          getJunction(db, 'Recruitment_TargetMajors', 'Major', row.RecruitmentID),
    ClassLevels:           getJunction(db, 'Recruitment_ClassLevel', 'ClassLevel', row.RecruitmentID),
  };
}

router.param('id', (req, res, next, id) => {
  try {
    req.recordId = requirePositiveInt(id, 'Recruitment ID');
    next();
  } catch (err) {
    sendValidationError(res, err);
  }
});

// GET /api/recruitment
router.get('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const companyId = optionalPositiveInt(req.query.companyId, 'companyId');
    const mode = optionalTrimmedString(req.query.mode, 'mode', 100);
    const status = optionalTrimmedString(req.query.status, 'status', 100);
    const targetGroup = optionalTrimmedString(req.query.targetGroup, 'targetGroup', 100);
    const from = optionalIsoDate(req.query.from, 'from');
    const to = optionalIsoDate(req.query.to, 'to');

    let sql = `
      SELECT r.*, c.CompanyName, co.FirstName || ' ' || co.LastName AS ContactName
      FROM Recruitment r
      JOIN Company c  ON r.CompanyID = c.CompanyID
      JOIN Contact co ON r.ContactID = co.ContactID
      WHERE 1=1
    `;
    const params = [];
    if (companyId)   { sql += ' AND r.CompanyID = ?';   params.push(companyId); }
    if (mode)        { sql += ' AND r.Mode = ?';        params.push(mode); }
    if (status)      { sql += ' AND r.Status = ?';      params.push(status); }
    if (targetGroup) { sql += ' AND r.TargetGroup = ?'; params.push(targetGroup); }
    if (from)        { sql += ' AND r.DatePosted >= ?'; params.push(from); }
    if (to)          { sql += ' AND r.DatePosted <= ?'; params.push(to); }
    sql += ' ORDER BY r.DatePosted DESC';
    const rows = db.prepare(sql).all(...params).map(r => hydrate(db, r));
    res.json(rows);
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/recruitment/:id
router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare(`
    SELECT r.*, c.CompanyName, co.FirstName || ' ' || co.LastName AS ContactName
    FROM Recruitment r
    JOIN Company c  ON r.CompanyID = c.CompanyID
    JOIN Contact co ON r.ContactID = co.ContactID
    WHERE r.RecruitmentID = ?
  `).get(req.recordId);
  if (!row) return res.status(404).json({ error: 'Record not found' });
  res.json(hydrate(db, row));
});

// POST /api/recruitment
router.post('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const CompanyID = requirePositiveInt(req.body.CompanyID, 'CompanyID');
    const ContactID = requirePositiveInt(req.body.ContactID, 'ContactID');
    const DatePosted = req.body.DatePosted ? requireIsoDate(req.body.DatePosted, 'DatePosted') : null;
    const OpportunityTitle = requireTrimmedString(req.body.OpportunityTitle, 'OpportunityTitle');
    const Duration = optionalTrimmedString(req.body.Duration, 'Duration', 100);
    const HiringStartDate = optionalIsoDate(req.body.HiringStartDate, 'HiringStartDate');
    const HiringEndDate = optionalIsoDate(req.body.HiringEndDate, 'HiringEndDate');
    const Country = optionalTrimmedString(req.body.Country, 'Country', 100);
    const Mode = requireTrimmedString(req.body.Mode, 'Mode', 100);
    const Status = requireTrimmedString(req.body.Status, 'Status', 100);
    const PayAmount = optionalTrimmedString(req.body.PayAmount, 'PayAmount', 100);
    const TargetGroup = requireTrimmedString(req.body.TargetGroup, 'TargetGroup', 100);
    const HiredStudentAlumni = optionalTrimmedString(req.body.HiredStudentAlumni, 'HiredStudentAlumni', 100) || 'Not Reported';
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const OpportunityTypes = optionalStringArray(req.body.OpportunityTypes, 'OpportunityTypes');
    const CollectApplications = optionalStringArray(req.body.CollectApplications, 'CollectApplications');
    const TargetMajors = optionalStringArray(req.body.TargetMajors, 'TargetMajors');
    const ClassLevels = optionalStringArray(req.body.ClassLevels, 'ClassLevels');

    const info = db.prepare(`
      INSERT INTO Recruitment
        (CompanyID, ContactID, DatePosted, OpportunityTitle, Duration,
         HiringStartDate, HiringEndDate, Country, Mode, Status, PayAmount,
         TargetGroup, ArabicSpeaker, HiredStudentAlumni, Comment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      CompanyID, ContactID,
      DatePosted || new Date().toISOString().slice(0,10),
      OpportunityTitle, Duration || null,
      HiringStartDate || null, HiringEndDate || null, Country || null,
      Mode, Status, PayAmount || null, TargetGroup,
      parseBoolean(req.body.ArabicSpeaker) ? 1 : 0,
      HiredStudentAlumni,
      Comment || null
    );
    const id = info.lastInsertRowid;
    setJunction(db, 'Recruitment_OpportunityType', 'Type', id, OpportunityTypes);
    setJunction(db, 'Recruitment_CollectApplications', 'Channel', id, CollectApplications);
    setJunction(db, 'Recruitment_TargetMajors', 'Major', id, TargetMajors);
    setJunction(db, 'Recruitment_ClassLevel', 'ClassLevel', id, ClassLevels);

    res.status(201).json(hydrate(db, db.prepare('SELECT * FROM Recruitment WHERE RecruitmentID = ?').get(id)));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/recruitment/:id
router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const CompanyID = requirePositiveInt(req.body.CompanyID, 'CompanyID');
    const ContactID = requirePositiveInt(req.body.ContactID, 'ContactID');
    const DatePosted = req.body.DatePosted ? requireIsoDate(req.body.DatePosted, 'DatePosted') : null;
    const OpportunityTitle = requireTrimmedString(req.body.OpportunityTitle, 'OpportunityTitle');
    const Duration = optionalTrimmedString(req.body.Duration, 'Duration', 100);
    const HiringStartDate = optionalIsoDate(req.body.HiringStartDate, 'HiringStartDate');
    const HiringEndDate = optionalIsoDate(req.body.HiringEndDate, 'HiringEndDate');
    const Country = optionalTrimmedString(req.body.Country, 'Country', 100);
    const Mode = requireTrimmedString(req.body.Mode, 'Mode', 100);
    const Status = requireTrimmedString(req.body.Status, 'Status', 100);
    const PayAmount = optionalTrimmedString(req.body.PayAmount, 'PayAmount', 100);
    const TargetGroup = requireTrimmedString(req.body.TargetGroup, 'TargetGroup', 100);
    const HiredStudentAlumni = optionalTrimmedString(req.body.HiredStudentAlumni, 'HiredStudentAlumni', 100) || 'Not Reported';
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const OpportunityTypes = optionalStringArray(req.body.OpportunityTypes, 'OpportunityTypes');
    const CollectApplications = optionalStringArray(req.body.CollectApplications, 'CollectApplications');
    const TargetMajors = optionalStringArray(req.body.TargetMajors, 'TargetMajors');
    const ClassLevels = optionalStringArray(req.body.ClassLevels, 'ClassLevels');

    const info = db.prepare(`
      UPDATE Recruitment SET
        CompanyID = ?, ContactID = ?, DatePosted = ?, OpportunityTitle = ?, Duration = ?,
        HiringStartDate = ?, HiringEndDate = ?, Country = ?, Mode = ?, Status = ?, PayAmount = ?,
        TargetGroup = ?, ArabicSpeaker = ?, HiredStudentAlumni = ?, Comment = ?
      WHERE RecruitmentID = ?
    `).run(
      CompanyID, ContactID,
      DatePosted || new Date().toISOString().slice(0,10),
      OpportunityTitle, Duration || null,
      HiringStartDate || null, HiringEndDate || null, Country || null,
      Mode, Status, PayAmount || null, TargetGroup,
      parseBoolean(req.body.ArabicSpeaker) ? 1 : 0,
      HiredStudentAlumni,
      Comment || null,
      req.recordId
    );
    if (info.changes === 0) return res.status(404).json({ error: 'Record not found' });

    const id = req.recordId;
    setJunction(db, 'Recruitment_OpportunityType', 'Type', id, OpportunityTypes);
    setJunction(db, 'Recruitment_CollectApplications', 'Channel', id, CollectApplications);
    setJunction(db, 'Recruitment_TargetMajors', 'Major', id, TargetMajors);
    setJunction(db, 'Recruitment_ClassLevel', 'ClassLevel', id, ClassLevels);

    res.json(hydrate(db, db.prepare('SELECT * FROM Recruitment WHERE RecruitmentID = ?').get(id)));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/recruitment/:id
router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = db.prepare('DELETE FROM Recruitment WHERE RecruitmentID = ?').run(req.recordId);
    if (info.changes === 0) return res.status(404).json({ error: 'Record not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
