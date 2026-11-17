'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, binaryParser, XLSX_CONTENT_TYPE } = require('../helpers/app');
const { webLoginAs, assertNoInlineCode } = require('../helpers/web');
const { QUICK_REPORTS } = require('../../src/services/reports');
const { REPORT_BY_TYPE } = require('../../src/services/reports/catalog');

const ROLES = ['admin', 'staff', 'readonly', 'student_worker'];

describe('web: reports', () => {
  let ctx;
  const agents = {};

  before(async () => {
    ctx = await buildApp();
    ctx.db
      .prepare(
        "INSERT INTO Company (CompanyName, Industry, Sector, Country, DateAdded) VALUES ('Report Co', 'Tech', 'Private', 'Qatar', '2026-09-15')"
      )
      .run();
    for (const role of ROLES) agents[role] = await webLoginAs(ctx, role);
  });
  after(() => ctx.close());

  it('describes every report, and nothing else', () => {
    assert.deepEqual([...REPORT_BY_TYPE.keys()].sort(), [...QUICK_REPORTS.keys()].sort());
  });

  it('lists the reports each role may run', async () => {
    for (const role of ROLES) {
      const res = await agents[role].get('/reports');
      assert.equal(res.status, 200, role);
      assertNoInlineCode(res.text, `/reports as ${role}`);
    }
    assert.match((await agents.staff.get('/reports')).text, /Mailable contacts/);
    assert.doesNotMatch((await agents.student_worker.get('/reports')).text, /Mailable contacts/);
  });

  it('runs every report for a role that may read everything', async () => {
    for (const type of QUICK_REPORTS.keys()) {
      const res = await agents.readonly.get(`/reports/${type}?period=all`);
      assert.equal(res.status, 200, type);
      assertNoInlineCode(res.text, type);
    }
  });

  it('shows dates in the one format and the chosen period', async () => {
    const res = await agents.staff.get('/reports/all-companies?period=custom&from=2026-09-01&to=2026-09-30');
    assert.equal(res.status, 200);
    assert.match(res.text, /15 Sep 2026/);
    assert.match(res.text, /1 Sep 2026 – 30 Sep 2026/);
  });

  it('says what is wrong with a period instead of running it', async () => {
    const res = await agents.staff.get('/reports/all-companies?period=custom&from=2026-09-30&to=2026-09-01');
    assert.equal(res.status, 422);
    assert.match(res.text, /From date must be on or before the to date/);
  });

  it('keeps personal-data reports from roles without sensitive:read', async () => {
    const res = await agents.student_worker.get('/reports/mailable-contacts');
    assert.equal(res.status, 403);
    assert.match(res.text, /You do not have access to this page/);
    assert.equal((await agents.staff.get('/reports/not-a-report')).status, 404);
  });

  it('exports to Excel only with export:run', async () => {
    const res = await agents.readonly
      .get('/reports/all-companies?period=all&format=xlsx')
      .buffer(true)
      .parse(binaryParser);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], XLSX_CONTENT_TYPE);
    const page = await agents.student_worker.get('/reports/all-companies?period=all');
    assert.doesNotMatch(page.text, /Export to Excel/);
    assert.equal((await agents.student_worker.get('/reports/all-companies?period=all&format=xlsx')).status, 403);
  });
});
