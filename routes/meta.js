const express = require('express');
const router  = express.Router();

// GET /api/meta/last-updated — latest timestamp per entity (cached per process restart)
// Returns { companies, contacts, outreach, recruitment, careerEvents,
//           studentEvents, academic, hiringFeedback, collaboration }
router.get('/last-updated', async (req, res) => {
  const db = req.app.locals.db;
  const Q = {
    companies:     'SELECT MAX(COALESCE(UpdatedAt, CreatedAt)) AS ts FROM Company',
    contacts:      'SELECT MAX(COALESCE(UpdatedAt, CreatedAt)) AS ts FROM Contact',
    outreach:      'SELECT MAX(COALESCE(UpdatedAt, CreatedAt)) AS ts FROM OutreachEngagement',
    recruitment:   'SELECT MAX(COALESCE(UpdatedAt, CreatedAt)) AS ts FROM Recruitment',
    careerEvents:  'SELECT MAX(CreatedAt) AS ts FROM CareerEvent',
    studentEvents: 'SELECT MAX(CreatedAt) AS ts FROM StudentLedEvent',
    academic:      'SELECT MAX(CreatedAt) AS ts FROM AcademicClassroomEngagement',
    hiringFeedback:'SELECT MAX(CreatedAt) AS ts FROM HiringFeedback',
    collaboration: 'SELECT MAX(CreatedAt) AS ts FROM PotentialCollaboration',
  };
  const result = {};
  for (const [key, sql] of Object.entries(Q)) {
    try { result[key] = (await db.prepare(sql).get())?.ts || null; }
    catch (_) { result[key] = null; }
  }
  res.json(result);
});

module.exports = router;
