const express = require('express');
const router = express.Router();
const {
  checkUpdateConflict,
  ensureEnum,
  idParam,
  optionalDateString,
  optionalTrimmed,
  parseBooleanFlag,
  requiredTrimmed,
  todayDate,
} = require('./_helpers');

router.param('id', idParam);

const VALID_MODES = ['Onsite', 'Hybrid', 'Remote'];
const VALID_PAY_STATUSES = ['Paid', 'Unpaid'];
const VALID_TARGET_GROUPS = ['Qatari only', 'Open to all'];
const VALID_HIRING_OUTCOMES = ['Yes', 'No', 'Not Reported'];

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

// GET /api/recruitment
router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const { companyId, mode, status, targetGroup, from, to } = req.query;

  let sql = `
    SELECT r.*, c.CompanyName, co.FirstName || ' ' || co.LastName AS ContactName
    FROM Recruitment r
    JOIN Company c  ON r.CompanyID = c.CompanyID
    JOIN Contact co ON r.ContactID = co.ContactID
    WHERE 1=1
  `;
  const params = [];
  if (companyId)   { sql += ' AND r.CompanyID = ?';    params.push(companyId); }
  if (mode)        { sql += ' AND r.Mode = ?';         params.push(mode); }
  if (status)      { sql += ' AND r.Status = ?';       params.push(status); }
  if (targetGroup) { sql += ' AND r.TargetGroup = ?';  params.push(targetGroup); }
  if (from)        { sql += ' AND r.DatePosted >= ?';  params.push(from); }
  if (to)          { sql += ' AND r.DatePosted <= ?';  params.push(to); }
  sql += ' ORDER BY r.DatePosted DESC';

  try {
    const rows = db.prepare(sql).all(...params).map(r => hydrate(db, r));
    res.json(rows);
  } catch (err) {
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
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Record not found' });
  res.json(hydrate(db, row));
});

// POST /api/recruitment
router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const {
    CompanyID, ContactID, DatePosted, OpportunityTitle, Duration,
    HiringStartDate, HiringEndDate, Country, Mode, Status, PayAmount,
    TargetGroup, ArabicSpeaker, HiredStudentAlumni, Comment,
    OpportunityTypes, CollectApplications, TargetMajors, ClassLevels
  } = req.body;

  try {
    const companyId = requiredTrimmed(CompanyID, 'CompanyID');
    const contactId = requiredTrimmed(ContactID, 'ContactID');
    const opportunityTitle = requiredTrimmed(OpportunityTitle, 'OpportunityTitle');
    const mode = ensureEnum(Mode, VALID_MODES, 'Mode');
    const status = ensureEnum(Status, VALID_PAY_STATUSES, 'Status');
    const targetGroup = ensureEnum(TargetGroup, VALID_TARGET_GROUPS, 'TargetGroup');
    const hiredStudentAlumni = HiredStudentAlumni
      ? ensureEnum(HiredStudentAlumni, VALID_HIRING_OUTCOMES, 'HiredStudentAlumni')
      : 'Not Reported';
    const info = db.prepare(`
      INSERT INTO Recruitment
        (CompanyID, ContactID, DatePosted, OpportunityTitle, Duration,
         HiringStartDate, HiringEndDate, Country, Mode, Status, PayAmount,
         TargetGroup, ArabicSpeaker, HiredStudentAlumni, Comment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      companyId,
      contactId,
      optionalDateString(DatePosted) || todayDate(),
      opportunityTitle,
      optionalTrimmed(Duration),
      optionalDateString(HiringStartDate),
      optionalDateString(HiringEndDate),
      optionalTrimmed(Country),
      mode,
      status,
      optionalTrimmed(PayAmount),
      targetGroup,
      parseBooleanFlag(ArabicSpeaker),
      hiredStudentAlumni,
      optionalTrimmed(Comment)
    );
    const id = info.lastInsertRowid;
    setJunction(db, 'Recruitment_OpportunityType', 'Type', id, OpportunityTypes);
    setJunction(db, 'Recruitment_CollectApplications', 'Channel', id, CollectApplications);
    setJunction(db, 'Recruitment_TargetMajors', 'Major', id, TargetMajors);
    setJunction(db, 'Recruitment_ClassLevel', 'ClassLevel', id, ClassLevels);

    res.status(201).json(hydrate(db, db.prepare('SELECT * FROM Recruitment WHERE RecruitmentID = ?').get(id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/recruitment/:id
router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const {
    CompanyID, ContactID, DatePosted, OpportunityTitle, Duration,
    HiringStartDate, HiringEndDate, Country, Mode, Status, PayAmount,
    TargetGroup, ArabicSpeaker, HiredStudentAlumni, Comment,
    OpportunityTypes, CollectApplications, TargetMajors, ClassLevels
  } = req.body;

  try {
    // Concurrency check applies to the parent Recruitment row only (junction tables excluded).
    if (!checkUpdateConflict(db, 'Recruitment', 'RecruitmentID', req.params.id, req.body.UpdatedAt, res, 'Record not found')) return;
    const companyId = requiredTrimmed(CompanyID, 'CompanyID');
    const contactId = requiredTrimmed(ContactID, 'ContactID');
    const opportunityTitle = requiredTrimmed(OpportunityTitle, 'OpportunityTitle');
    const mode = ensureEnum(Mode, VALID_MODES, 'Mode');
    const status = ensureEnum(Status, VALID_PAY_STATUSES, 'Status');
    const targetGroup = ensureEnum(TargetGroup, VALID_TARGET_GROUPS, 'TargetGroup');
    const hiredStudentAlumni = HiredStudentAlumni
      ? ensureEnum(HiredStudentAlumni, VALID_HIRING_OUTCOMES, 'HiredStudentAlumni')
      : 'Not Reported';
    const info = db.prepare(`
      UPDATE Recruitment SET
        CompanyID = ?, ContactID = ?, DatePosted = ?, OpportunityTitle = ?, Duration = ?,
        HiringStartDate = ?, HiringEndDate = ?, Country = ?, Mode = ?, Status = ?, PayAmount = ?,
        TargetGroup = ?, ArabicSpeaker = ?, HiredStudentAlumni = ?, Comment = ?
      WHERE RecruitmentID = ?
    `).run(
      companyId,
      contactId,
      optionalDateString(DatePosted) || todayDate(),
      opportunityTitle,
      optionalTrimmed(Duration),
      optionalDateString(HiringStartDate),
      optionalDateString(HiringEndDate),
      optionalTrimmed(Country),
      mode,
      status,
      optionalTrimmed(PayAmount),
      targetGroup,
      parseBooleanFlag(ArabicSpeaker),
      hiredStudentAlumni,
      optionalTrimmed(Comment),
      req.params.id
    );
    if (info.changes === 0) return res.status(404).json({ error: 'Record not found' });

    const id = parseInt(req.params.id);
    setJunction(db, 'Recruitment_OpportunityType', 'Type', id, OpportunityTypes);
    setJunction(db, 'Recruitment_CollectApplications', 'Channel', id, CollectApplications);
    setJunction(db, 'Recruitment_TargetMajors', 'Major', id, TargetMajors);
    setJunction(db, 'Recruitment_ClassLevel', 'ClassLevel', id, ClassLevels);

    res.json(hydrate(db, db.prepare('SELECT * FROM Recruitment WHERE RecruitmentID = ?').get(id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/recruitment/:id
router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = db.prepare('DELETE FROM Recruitment WHERE RecruitmentID = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Record not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
