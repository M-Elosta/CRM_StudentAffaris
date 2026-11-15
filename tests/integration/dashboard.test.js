'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, loginAs, today } = require('../helpers/app');
const { seedEverything } = require('../helpers/records');

const DASHBOARD_ENDPOINTS = [
  'stats',
  'companies-by-month',
  'outreach-by-month',
  'companies-by-sector',
  'recruitment-by-major',
  'event-attendance',
  'top-engaged',
  'hiring-trends',
];

describe('Dashboard', () => {
  let ctx;
  let viewer;

  before(async () => {
    ctx = await buildApp();
    viewer = await loginAs(ctx, 'viewer');
  });

  after(() => ctx.close());

  for (const endpoint of DASHBOARD_ENDPOINTS) {
    it(`${endpoint} returns 200 on an empty database`, async () => {
      const res = await viewer.get(`/api/dashboard/${endpoint}`);
      assert.equal(res.status, 200);
      if (endpoint === 'stats') assert.equal(typeof res.body, 'object');
      else assert.ok(Array.isArray(res.body));
    });

    it(`${endpoint} accepts a from/to date range`, async () => {
      const res = await viewer.get(`/api/dashboard/${endpoint}`).query({ from: '2024-01-01', to: '2030-12-31' });
      assert.equal(res.status, 200);
    });

    it(`${endpoint} rejects a malformed date with 400`, async () => {
      assert.equal((await viewer.get(`/api/dashboard/${endpoint}`).query({ from: 'yesterday' })).status, 400);
      assert.equal((await viewer.get(`/api/dashboard/${endpoint}`).query({ to: '2024/01/01' })).status, 400);
    });
  }

  it(
    'rejects an impossible calendar date with 400',
    { todo: 'optionalIsoDate only checks the YYYY-MM-DD shape, so 2024-13-45 is accepted' },
    async () => {
      const res = await viewer.get('/api/dashboard/stats').query({ from: '2024-13-45' });
      assert.equal(res.status, 400);
    }
  );

  describe('with data', () => {
    let admin;

    before(async () => {
      admin = await loginAs(ctx, 'admin');
      await seedEverything(admin);
    });

    it('stats counts companies, blacklisted companies and contacts', async () => {
      const res = await viewer.get('/api/dashboard/stats');
      assert.equal(res.status, 200);
      assert.equal(res.body.totalCompanies, 2);
      assert.equal(res.body.totalBlacklisted, 1);
      assert.equal(res.body.totalContacts, 2);
      assert.equal(res.body.mailableContacts, 2);
      assert.equal(res.body.upcomingFollowUps, 1);
      for (const key of ['outreachThisMonth']) assert.equal(typeof res.body[key], 'number');
    });

    it('stats respects the date range', async () => {
      const res = await viewer.get('/api/dashboard/stats').query({ from: '2024-10-01', to: '2024-10-31' });
      assert.equal(res.status, 200);
      assert.equal(res.body.outreachThisMonth, 1);
      assert.equal(res.body.totalCompanies, 0);
    });

    it('companies-by-sector excludes blacklisted companies', async () => {
      const res = await viewer.get('/api/dashboard/companies-by-sector');
      const labels = res.body.map((row) => row.label).sort();
      assert.deepEqual(labels, ['Government', 'Semi-government']);
    });

    it('recruitment-by-major counts target majors', async () => {
      const res = await viewer.get('/api/dashboard/recruitment-by-major');
      assert.deepEqual(res.body, [{ label: 'CS', count: 1 }]);
    });

    it('event-attendance groups by event and status', async () => {
      const res = await viewer.get('/api/dashboard/event-attendance');
      assert.deepEqual(res.body, [{ EventName: 'Fall Career Fair', status: 'Attended', count: 1 }]);
    });

    it('hiring-trends counts hires per month', async () => {
      const res = await viewer.get('/api/dashboard/hiring-trends');
      assert.deepEqual(res.body, [{ month: today().slice(0, 7), count: 1 }]);
    });

    it('top-engaged ranks the most active company first', async () => {
      const res = await viewer.get('/api/dashboard/top-engaged');
      assert.equal(res.body[0].company, 'Reference Company Seed');
      assert.ok(res.body[0].total >= 4);
    });
  });
});
