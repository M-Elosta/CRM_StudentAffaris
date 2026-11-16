'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, loginAs, setStoredUpdatedAt } = require('../helpers/app');
const { seedEverything } = require('../helpers/records');

describe('Meta: last updated', () => {
  let ctx;
  let admin;
  const KEYS = [
    'companies',
    'contacts',
    'outreach',
    'recruitment',
    'careerEvents',
    'studentEvents',
    'academic',
    'hiringFeedback',
    'collaboration',
  ];

  before(async () => {
    ctx = await buildApp();
    admin = await loginAs(ctx, 'admin');
  });

  after(() => ctx.close());

  it('returns null for every entity on an empty database', async () => {
    const res = await admin.get('/api/meta/last-updated');
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), [...KEYS].sort());
    for (const key of KEYS) assert.equal(res.body[key], null, key);
  });

  it('returns a timestamp for every entity once records exist', async () => {
    await seedEverything(admin);
    const res = await admin.get('/api/meta/last-updated');
    for (const key of KEYS) assert.match(String(res.body[key]), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, key);
  });

  it('is readable by a viewer', async () => {
    const viewer = await loginAs(ctx, 'readonly');
    assert.equal((await viewer.get('/api/meta/last-updated')).status, 200);
  });

  it('reflects the latest company update', async () => {
    const company = (await admin.get('/api/companies')).body[0];
    setStoredUpdatedAt(ctx.db, 'Company', 'CompanyID', company.CompanyID, '2098-05-05 05:05:05');
    const res = await admin.get('/api/meta/last-updated');
    assert.equal(res.body.companies, '2098-05-05 05:05:05');
  });

  for (const [key, table, idField] of [
    ['careerEvents', 'CareerEvent', 'CareerEventID'],
    ['studentEvents', 'StudentLedEvent', 'StudentLedEventID'],
    ['academic', 'AcademicClassroomEngagement', 'EngagementID'],
    ['hiringFeedback', 'HiringFeedback', 'HiringFeedbackID'],
    ['collaboration', 'PotentialCollaboration', 'PotentialCollaborationID'],
  ]) {
    it(`reflects the latest ${key} update, not only the latest creation`, async () => {
      const row = ctx.db.prepare(`SELECT ${idField} AS id FROM ${table} LIMIT 1`).get();
      setStoredUpdatedAt(ctx.db, table, idField, row.id, '2098-06-06 06:06:06');
      const res = await admin.get('/api/meta/last-updated');
      assert.equal(res.body[key], '2098-06-06 06:06:06');
    });
  }
});
