const express = require('express');
const router = express.Router();
const {
  optionalStringArray,
  optionalTrimmedString,
  requirePositiveInt,
  sendValidationError,
} = require('./_validation');
const { ensureRecordNotStale } = require('./_records');

async function getOpps(db, id) {
  return (await db.prepare('SELECT OpportunityType FROM PotentialCollaboration_Opportunities WHERE PotentialCollaborationID=?').all(id)).map(r=>r.OpportunityType);
}
async function setOpps(db, id, values) {
  await db.prepare('DELETE FROM PotentialCollaboration_Opportunities WHERE PotentialCollaborationID=?').run(id);
  const ins = db.prepare('INSERT INTO PotentialCollaboration_Opportunities (PotentialCollaborationID, OpportunityType) VALUES (?,?)');
  for (const v of (values||[])) {
    await ins.run(id, v);
  }
}

router.param('id', (req, res, next, id) => {
  try {
    req.recordId = requirePositiveInt(id, 'Potential collaboration ID');
    next();
  } catch (err) {
    sendValidationError(res, err);
  }
});

router.get('/', async (req, res) => {
  const db = req.app.locals.db;
  try {
    const rows = await Promise.all((await db.prepare(`
      SELECT p.*, c.CompanyName FROM PotentialCollaboration p JOIN Company c ON p.CompanyID=c.CompanyID ORDER BY p.CreatedAt DESC`
    ).all()).map(async (r) => ({ ...r, Opportunities: await getOpps(db, r.PotentialCollaborationID) })));
    res.json(rows);
  } catch (err) { req.app.locals.respondServerError(req, res, err); }
});

router.get('/:id', async (req, res) => {
  const db = req.app.locals.db;
  const row = (await db.prepare(`SELECT p.*, c.CompanyName FROM PotentialCollaboration p JOIN Company c ON p.CompanyID=c.CompanyID WHERE p.PotentialCollaborationID=?`).get(req.recordId));
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ...row, Opportunities: await getOpps(db, row.PotentialCollaborationID) });
});

router.post('/', async (req, res) => {
  const db = req.app.locals.db;
  try {
    const CompanyID = requirePositiveInt(req.body.CompanyID, 'CompanyID');
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const Opportunities = optionalStringArray(req.body.Opportunities, 'Opportunities');
    const created = await db.withTransaction(async (tx) => {
      const info = await tx.prepare('INSERT INTO PotentialCollaboration (CompanyID, Comment) VALUES (?,?)').run(CompanyID, Comment||null);
      await setOpps(tx, info.lastInsertRowid, Opportunities);
      const row = await tx.prepare('SELECT * FROM PotentialCollaboration WHERE PotentialCollaborationID=?').get(info.lastInsertRowid);
      return { ...row, Opportunities: await getOpps(tx, info.lastInsertRowid) };
    });
    res.status(201).json(created);
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

router.put('/:id', async (req, res) => {
  const db = req.app.locals.db;
  try {
    await ensureRecordNotStale(db, 'PotentialCollaboration', 'PotentialCollaborationID', req.recordId, req.body.UpdatedAt, 'Not found');
    const CompanyID = requirePositiveInt(req.body.CompanyID, 'CompanyID');
    const Comment = optionalTrimmedString(req.body.Comment, 'Comment', 2000);
    const Opportunities = optionalStringArray(req.body.Opportunities, 'Opportunities');
    const updated = await db.withTransaction(async (tx) => {
      const info = await tx.prepare('UPDATE PotentialCollaboration SET CompanyID=?,Comment=? WHERE PotentialCollaborationID=?').run(CompanyID, Comment||null, req.recordId);
      if (info.changes===0) return null;
      await setOpps(tx, req.recordId, Opportunities);
      const row = await tx.prepare('SELECT * FROM PotentialCollaboration WHERE PotentialCollaborationID=?').get(req.recordId);
      return { ...row, Opportunities: await getOpps(tx, req.recordId) };
    });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

router.delete('/:id', async (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = (await db.prepare('DELETE FROM PotentialCollaboration WHERE PotentialCollaborationID=?').run(req.recordId));
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { req.app.locals.respondServerError(req, res, err); }
});

module.exports = router;
