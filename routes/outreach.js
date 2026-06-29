const express = require('express');
const router = express.Router();
const {
  optionalIsoDate,
  optionalPositiveInt,
  optionalTrimmedString,
  requireEnum,
  requireIsoDate,
  requirePositiveInt,
  requireTrimmedString,
  sendValidationError,
} = require('./_validation');
const { ensureRecordNotStale } = require('./_records');

const VALID_TYPES    = ['Call', 'Meeting', 'Company Visit'];
const VALID_STATUSES = ['Complete', 'In-progress'];

router.param('id', (req, res, next, id) => {
  try {
    req.recordId = requirePositiveInt(id, 'Outreach record ID');
    next();
  } catch (err) {
    sendValidationError(res, err);
  }
});

// GET /api/outreach
router.get('/', async (req, res) => {
  const db = req.app.locals.db;
  try {
    const companyId = optionalPositiveInt(req.query.companyId, 'companyId');
    const contactId = optionalPositiveInt(req.query.contactId, 'contactId');
    const interactionType = req.query.interactionType ? requireEnum(req.query.interactionType, 'interactionType', VALID_TYPES) : null;
    const interactionStatus = req.query.interactionStatus ? requireEnum(req.query.interactionStatus, 'interactionStatus', VALID_STATUSES) : null;
    const from = optionalIsoDate(req.query.from, 'from');
    const to = optionalIsoDate(req.query.to, 'to');

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

    if (companyId)         { sql += ' AND o.CompanyID = ?';         params.push(companyId); }
    if (contactId)         { sql += ' AND o.ContactID = ?';         params.push(contactId); }
    if (interactionType)   { sql += ' AND o.InteractionType = ?';   params.push(interactionType); }
    if (interactionStatus) { sql += ' AND o.InteractionStatus = ?'; params.push(interactionStatus); }
    if (from)              { sql += ' AND o.InteractionDate >= ?';  params.push(from); }
    if (to)                { sql += ' AND o.InteractionDate <= ?';  params.push(to); }

    sql += ' ORDER BY o.InteractionDate DESC';
    res.json((await db.prepare(sql).all(...params)));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

// GET /api/outreach/:id
router.get('/:id', async (req, res) => {
  const db = req.app.locals.db;
  const row = (await db.prepare(`
    SELECT o.*, c.CompanyName, co.FirstName || ' ' || co.LastName AS ContactName
    FROM OutreachEngagement o
    JOIN Company c  ON o.CompanyID = c.CompanyID
    JOIN Contact co ON o.ContactID = co.ContactID
    WHERE o.OutreachEngagementID = ?
  `).get(req.recordId));
  if (!row) return res.status(404).json({ error: 'Record not found' });
  res.json(row);
});

// POST /api/outreach
router.post('/', async (req, res) => {
  const db = req.app.locals.db;
  try {
    const CompanyID = requirePositiveInt(req.body.CompanyID, 'CompanyID');
    const ContactID = requirePositiveInt(req.body.ContactID, 'ContactID');
    const InteractionType = requireEnum(req.body.InteractionType, 'InteractionType', VALID_TYPES);
    const InteractionDate = requireIsoDate(req.body.InteractionDate, 'InteractionDate');
    const DiscussionItems = requireTrimmedString(req.body.DiscussionItems, 'DiscussionItems', 2000);
    const ActionPlan = optionalTrimmedString(req.body.ActionPlan, 'ActionPlan', 2000);
    const FollowUpDate = optionalIsoDate(req.body.FollowUpDate, 'FollowUpDate');
    const InteractionStatus = req.body.InteractionStatus
      ? requireEnum(req.body.InteractionStatus, 'InteractionStatus', VALID_STATUSES)
      : 'In-progress';

    const info = await db.prepare(`
      INSERT INTO OutreachEngagement
        (CompanyID, ContactID, InteractionType, InteractionDate,
         DiscussionItems, ActionPlan, FollowUpDate, InteractionStatus)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      CompanyID, ContactID, InteractionType, InteractionDate,
      DiscussionItems,
      ActionPlan || null,
      FollowUpDate || null,
      InteractionStatus
    );
    res.status(201).json((await db.prepare('SELECT * FROM OutreachEngagement WHERE OutreachEngagementID = ?').get(info.lastInsertRowid)));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

// PUT /api/outreach/:id
router.put('/:id', async (req, res) => {
  const db = req.app.locals.db;
  try {
    await ensureRecordNotStale(db, 'OutreachEngagement', 'OutreachEngagementID', req.recordId, req.body.UpdatedAt, 'Record not found');
    const CompanyID = requirePositiveInt(req.body.CompanyID, 'CompanyID');
    const ContactID = requirePositiveInt(req.body.ContactID, 'ContactID');
    const InteractionType = requireEnum(req.body.InteractionType, 'InteractionType', VALID_TYPES);
    const InteractionDate = requireIsoDate(req.body.InteractionDate, 'InteractionDate');
    const DiscussionItems = requireTrimmedString(req.body.DiscussionItems, 'DiscussionItems', 2000);
    const ActionPlan = optionalTrimmedString(req.body.ActionPlan, 'ActionPlan', 2000);
    const FollowUpDate = optionalIsoDate(req.body.FollowUpDate, 'FollowUpDate');
    const InteractionStatus = req.body.InteractionStatus
      ? requireEnum(req.body.InteractionStatus, 'InteractionStatus', VALID_STATUSES)
      : 'In-progress';

    const info = await db.prepare(`
      UPDATE OutreachEngagement SET
        CompanyID = ?, ContactID = ?, InteractionType = ?, InteractionDate = ?,
        DiscussionItems = ?, ActionPlan = ?, FollowUpDate = ?, InteractionStatus = ?
      WHERE OutreachEngagementID = ?
    `).run(
      CompanyID, ContactID, InteractionType, InteractionDate,
      DiscussionItems, ActionPlan || null, FollowUpDate || null,
      InteractionStatus,
      req.recordId
    );
    if (info.changes === 0) return res.status(404).json({ error: 'Record not found' });
    res.json((await db.prepare('SELECT * FROM OutreachEngagement WHERE OutreachEngagementID = ?').get(req.recordId)));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

// DELETE /api/outreach/:id
router.delete('/:id', async (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = (await db.prepare('DELETE FROM OutreachEngagement WHERE OutreachEngagementID = ?').run(req.recordId));
    if (info.changes === 0) return res.status(404).json({ error: 'Record not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    req.app.locals.respondServerError(req, res, err);
  }
});

module.exports = router;
