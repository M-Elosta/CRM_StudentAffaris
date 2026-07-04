const express = require('express');
const router = express.Router();
const { checkUpdateConflict, idParam } = require('./_helpers');

router.param('id', idParam);

function getOpps(db, id) {
  return db.prepare('SELECT OpportunityType FROM PotentialCollaboration_Opportunities WHERE PotentialCollaborationID=?').all(id).map(r=>r.OpportunityType);
}
function setOpps(db, id, values) {
  db.prepare('DELETE FROM PotentialCollaboration_Opportunities WHERE PotentialCollaborationID=?').run(id);
  const ins = db.prepare('INSERT INTO PotentialCollaboration_Opportunities (PotentialCollaborationID, OpportunityType) VALUES (?,?)');
  for (const v of (values||[])) ins.run(id, v);
}

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  try {
    const rows = db.prepare(`
      SELECT p.*, c.CompanyName FROM PotentialCollaboration p JOIN Company c ON p.CompanyID=c.CompanyID ORDER BY p.CreatedAt DESC`
    ).all().map(r => ({ ...r, Opportunities: getOpps(db, r.PotentialCollaborationID) }));
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare(`SELECT p.*, c.CompanyName FROM PotentialCollaboration p JOIN Company c ON p.CompanyID=c.CompanyID WHERE p.PotentialCollaborationID=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ...row, Opportunities: getOpps(db, row.PotentialCollaborationID) });
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const { CompanyID, Comment, Opportunities } = req.body;
  if (!CompanyID) return res.status(400).json({ error: 'CompanyID is required' });
  try {
    const info = db.prepare('INSERT INTO PotentialCollaboration (CompanyID, Comment) VALUES (?,?)').run(CompanyID, Comment||null);
    setOpps(db, info.lastInsertRowid, Opportunities);
    const row = db.prepare('SELECT * FROM PotentialCollaboration WHERE PotentialCollaborationID=?').get(info.lastInsertRowid);
    res.status(201).json({ ...row, Opportunities: getOpps(db, info.lastInsertRowid) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const { CompanyID, Comment, Opportunities } = req.body;
  if (!CompanyID) return res.status(400).json({ error: 'CompanyID is required' });
  try {
    // Concurrency check applies to the parent row only (junction table excluded).
    if (!checkUpdateConflict(db, 'PotentialCollaboration', 'PotentialCollaborationID', req.params.id, req.body.UpdatedAt, res, 'Not found')) return;
    const info = db.prepare('UPDATE PotentialCollaboration SET CompanyID=?,Comment=? WHERE PotentialCollaborationID=?').run(CompanyID, Comment||null, req.params.id);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    setOpps(db, parseInt(req.params.id), Opportunities);
    const row = db.prepare('SELECT * FROM PotentialCollaboration WHERE PotentialCollaborationID=?').get(req.params.id);
    res.json({ ...row, Opportunities: getOpps(db, parseInt(req.params.id)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = db.prepare('DELETE FROM PotentialCollaboration WHERE PotentialCollaborationID=?').run(req.params.id);
    if (info.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
