'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../helpers/app');
const { webLoginAs, postForm, assertNoInlineCode } = require('../helpers/web');
const { workbookBufferFromJson } = require('../../src/lib/excel');

describe('web: import', () => {
  let ctx;
  const agents = {};
  let workbook;

  before(async () => {
    ctx = await buildApp();
    ctx.db
      .prepare(
        "INSERT INTO Company (CompanyName, Industry, Sector, Country, DateAdded) VALUES ('Existing Co', 'Tech', 'Private', 'Qatar', '2026-01-01')"
      )
      .run();
    workbook = await workbookBufferFromJson('Employers', [
      { 'Company Name': 'شركة جديدة', Industry: 'Media', Sector: 'Private', Country: 'Qatar' },
      { 'Company Name': 'Broken Sector Co', Industry: 'Media', Sector: 'Martian', Country: 'Qatar' },
      { 'Company Name': 'Existing Co', Industry: 'Consulting', Sector: 'NGO', Country: 'Qatar' },
    ]);
    for (const role of ['staff', 'student_worker']) agents[role] = await webLoginAs(ctx, role);
  });
  after(() => ctx.close());

  const uploadAs = (agent, fields = {}) =>
    agent
      .post('/import/preview')
      .field('_csrf', agent.csrf)
      .field('entity', fields.entity ?? 'Company')
      .attach('file', workbook, { filename: 'employers.xlsx', contentType: 'application/octet-stream' });

  it('is open to roles with import:run only', async () => {
    const res = await agents.staff.get('/import');
    assert.equal(res.status, 200);
    assertNoInlineCode(res.text, '/import');
    assert.equal((await agents.student_worker.get('/import')).status, 403);
    assert.equal((await uploadAs(agents.student_worker)).status, 403);
  });

  it('refuses an upload without the CSRF token', async () => {
    const res = await agents.staff
      .post('/import/preview')
      .field('entity', 'Company')
      .attach('file', workbook, { filename: 'employers.xlsx', contentType: 'application/octet-stream' });
    assert.equal(res.status, 403);
    assert.match(res.text, /This form has expired/);
  });

  it('asks for the kind of records when it is missing', async () => {
    const res = await uploadAs(agents.staff, { entity: '' });
    assert.equal(res.status, 422);
    assert.match(res.text, /Choose what kind of records the file holds/);
  });

  it('previews every row with problems and duplicates, then imports on confirmation', async () => {
    const upload = await uploadAs(agents.staff);
    assert.equal(upload.status, 303);
    assert.equal(upload.headers.location, '/import/preview');

    const preview = await agents.staff.get('/import/preview');
    assert.equal(preview.status, 200);
    assert.match(preview.text, /شركة جديدة/);
    assert.match(preview.text, /Sector must be one of|Sector/);
    assert.match(preview.text, /Duplicate/);
    assertNoInlineCode(preview.text, '/import/preview');
    const before = ctx.db.prepare('SELECT COUNT(*) AS n FROM Company').get().n;

    const done = await postForm(agents.staff, '/import/confirm', { duplicates: 'overwrite' });
    assert.equal(done.status, 200);
    assert.match(done.text, /Import finished/);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM Company').get().n, before + 1);
    assert.equal(ctx.db.prepare("SELECT Sector FROM Company WHERE CompanyName = 'Existing Co'").get().Sector, 'NGO');

    const again = await postForm(agents.staff, '/import/confirm', {});
    assert.equal(again.status, 303);
    assert.equal(again.headers.location, '/import');
  });
});
