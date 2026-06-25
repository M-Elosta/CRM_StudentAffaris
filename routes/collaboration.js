const express = require('express');
const router = express.Router();
const {
  optionalStringArray,
  optionalTrimmedString,
  requirePositiveInt,
  sendValidationError,
} = require('./_validation');
const { ensureRecordNotStale } = require('./_records');

function getOpps(db, id) {
  return db.prepare('SELECT OpportunityType FROM PotentialCollaboration_Opportunities WHERE PotentialCollaborationID=?').all(id).map(r=>r.OpportunityType);
}
function setOpps(db, id, values) {
  db.prepare('DELETE FROM PotentialCollaboration_Opportunities WHERE PotentialCollaborationID=?').run(id);
  const ins = db.prepare('INSERT INTO PotentialCollaboration_Opportunities (PotentialCollaborationID, OpportunityType) VALUES (?,?)');
  for (const v of (values||[])) ins.run(id, v);
}

router.param('id', (req, res, next, id) => {
  try {
    req.recordId = requirePositiveInt(id, 'Potential collaboration ID');
    next();
  } catch (err) {
    sendValidationError(res, err);
  }
});

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const rows = db.prepare(`
      SELECT p.*, c.CompanyName FROM PotentialCollaboration p JOIN Company c ON p.CompanyID=c.CompanyID ORDER BY p.CreatedAt DESC`
    ).all().map(r => ({ ...r, Opportunities: getOpps(db, r.PotentialCollaborationID) }));
    res.json(rows);
  } catch (err) { req.app.locals.respondServerError(req, res, err); }
});

router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare(`SELECT p.*, c.CompanyName FROM PotentialCollaboration p JOIN Company c ON p.CompanyID=c.CompanyID WHERE p.PotentialCollaborationID=?`).get(req.recordId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ...row, Opportunities: getOpps(db, row.PotentialCollaborationID) });
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    ensureRecordNotStale(db, 'PotentialCollaboration', 'PotentialCollaborationID', req.recordId, req.body.UpdatedAt, 'Not found');
    const CompanyID = requirePositiveInt(req.body.CompanyID, 'CompanyID');
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const Opportunities = optionalStringArray(req.body.Opportunities, 'Opportunities');
    const info = db.prepare('INSERT INTO PotentialCollaboration (CompanyID, Comment) VALUES (?,?)').run(CompanyID, Comment||null);
    setOpps(db, info.lastInsertRowid, Opportunities);
    const row = db.prepare('SELECT * FROM PotentialCollaboration WHERE PotentialCollaborationID=?').get(info.lastInsertRowid);
    res.status(201).json({ ...row, Opportunities: getOpps(db, info.lastInsertRowid) });
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const CompanyID = requirePositiveInt(req.body.CompanyID, 'CompanyID');
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const Opportunities = optionalStringArray(req.body.Opportunities, 'Opportunities');
    const info = db.prepare('UPDATE PotentialCollaboration SET CompanyID=?,Comment=? WHERE PotentialCollaborationID=?').run(CompanyID, Comment||null, req.recordId);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    setOpps(db, req.recordId, Opportunities);
    const row = db.prepare('SELECT * FROM PotentialCollaboration WHERE PotentialCollaborationID=?').get(req.recordId);
    res.json({ ...row, Opportunities: getOpps(db, req.recordId) });
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = db.prepare('DELETE FROM PotentialCollaboration WHERE PotentialCollaborationID=?').run(req.recordId);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { req.app.locals.respondServerError(req, res, err); }
});

module.exports = router;
