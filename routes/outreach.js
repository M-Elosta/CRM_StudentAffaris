const express = require('express');
const router = express.Router();

const VALID_TYPES    = ['Call', 'Meeting', 'Company Visit'];
const VALID_STATUSES = ['Complete', 'In-progress'];

// GET /api/outreach
router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const { companyId, contactId, interactionType, interactionStatus, from, to } = req.query;

  let sql = `
    SELECT o.*,
           c.CompanyName,
           co.FirstName || ' ' || co.LastName AS ContactName
    FROM OutreachEngagement o
    JOIN Company c  ON o.CompanyID  = c.CompanyID
    JOIN Contact co ON o.ContactID  = co.ContactID
    WHERE 1=1
  `;
  const params = [];

  if (companyId)         { sql += ' AND o.CompanyID = ?';        params.push(companyId); }
  if (contactId)         { sql += ' AND o.ContactID = ?';        params.push(contactId); }
  if (interactionType)   { sql += ' AND o.InteractionType = ?';  params.push(interactionType); }
  if (interactionStatus) { sql += ' AND o.InteractionStatus = ?';params.push(interactionStatus); }
  if (from)              { sql += ' AND o.InteractionDate >= ?'; params.push(from); }
  if (to)                { sql += ' AND o.InteractionDate <= ?'; params.push(to); }

  sql += ' ORDER BY o.InteractionDate DESC';

  try {
    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/outreach/:id
router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare(`
    SELECT o.*, c.CompanyName, co.FirstName || ' ' || co.LastName AS ContactName
    FROM OutreachEngagement o
    JOIN Company c  ON o.CompanyID = c.CompanyID
    JOIN Contact co ON o.ContactID = co.ContactID
    WHERE o.OutreachEngagementID = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Record not found' });
  res.json(row);
});

// POST /api/outreach
router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const { CompanyID, ContactID, InteractionType, InteractionDate,
          DiscussionItems, ActionPlan, FollowUpDate, InteractionStatus } = req.body;

  if (!CompanyID)       return res.status(400).json({ error: 'CompanyID is required' });
  if (!ContactID)       return res.status(400).json({ error: 'ContactID is required' });
  if (!InteractionType) return res.status(400).json({ error: 'InteractionType is required' });
  if (!InteractionDate) return res.status(400).json({ error: 'InteractionDate is required' });
  if (!DiscussionItems) return res.status(400).json({ error: 'DiscussionItems is required' });
  if (!VALID_TYPES.includes(InteractionType))
    return res.status(400).json({ error: `InteractionType must be one of: ${VALID_TYPES.join(', ')}` });

  try {
    const info = db.prepare(`
      INSERT INTO OutreachEngagement
        (CompanyID, ContactID, InteractionType, InteractionDate,
         DiscussionItems, ActionPlan, FollowUpDate, InteractionStatus)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      CompanyID, ContactID, InteractionType, InteractionDate,
      DiscussionItems.trim(),
      ActionPlan || null,
      FollowUpDate || null,
      InteractionStatus || 'In-progress'
    );
    res.status(201).json(db.prepare('SELECT * FROM OutreachEngagement WHERE OutreachEngagementID = ?').get(info.lastInsertRowid));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/outreach/:id
router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const { CompanyID, ContactID, InteractionType, InteractionDate,
          DiscussionItems, ActionPlan, FollowUpDate, InteractionStatus } = req.body;

  if (!CompanyID)       return res.status(400).json({ error: 'CompanyID is required' });
  if (!ContactID)       return res.status(400).json({ error: 'ContactID is required' });
  if (!InteractionType) return res.status(400).json({ error: 'InteractionType is required' });
  if (!InteractionDate) return res.status(400).json({ error: 'InteractionDate is required' });
  if (!DiscussionItems) return res.status(400).json({ error: 'DiscussionItems is required' });

  try {
    const info = db.prepare(`
      UPDATE OutreachEngagement SET
        CompanyID = ?, ContactID = ?, InteractionType = ?, InteractionDate = ?,
        DiscussionItems = ?, ActionPlan = ?, FollowUpDate = ?, InteractionStatus = ?
      WHERE OutreachEngagementID = ?
    `).run(
      CompanyID, ContactID, InteractionType, InteractionDate,
      DiscussionItems.trim(), ActionPlan || null, FollowUpDate || null,
      InteractionStatus || 'In-progress',
      req.params.id
    );
    if (info.changes === 0) return res.status(404).json({ error: 'Record not found' });
    res.json(db.prepare('SELECT * FROM OutreachEngagement WHERE OutreachEngagementID = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/outreach/:id
router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = db.prepare('DELETE FROM OutreachEngagement WHERE OutreachEngagementID = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Record not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
