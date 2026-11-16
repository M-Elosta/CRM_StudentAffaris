'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, setStoredUpdatedAt, STALE_TIMESTAMP, binaryParser, XLSX_CONTENT_TYPE } = require('../helpers/app');
const { webLoginAs, postForm, htmxPost, assertNoInlineCode } = require('../helpers/web');

const ROLES = ['admin', 'staff', 'readonly', 'student_worker'];

/** Insert an employer straight into the database and return its id. */
function insertCompany(db, values) {
  const row = { Industry: 'Technology', Sector: 'Private', Country: 'Qatar', DateAdded: '2026-01-01', ...values };
  return Number(
    db
      .prepare('INSERT INTO Company (CompanyName, Industry, Sector, Country, DateAdded) VALUES (?, ?, ?, ?, ?)')
      .run(row.CompanyName, row.Industry, row.Sector, row.Country, row.DateAdded).lastInsertRowid
  );
}

const rowNames = (html) => [...html.matchAll(/<a href="\/employers\/\d+">([^<]*)<\/a>/g)].map((match) => match[1]);

describe('web: employers', () => {
  let ctx;
  const agents = {};

  before(async () => {
    ctx = await buildApp();
    for (let index = 1; index <= 28; index++) {
      insertCompany(ctx.db, { CompanyName: `Employer ${String(index).padStart(2, '0')}` });
    }
    insertCompany(ctx.db, { CompanyName: 'شركة الدوحة للتقنية', Sector: 'Government' });
    insertCompany(ctx.db, { CompanyName: 'Gulf Analytics', Sector: 'Startup', Country: 'Kuwait' });
    for (const role of ROLES) agents[role] = await webLoginAs(ctx, role);
  });
  after(() => ctx.close());

  describe('list', () => {
    it('opens for every role, with the first page of rows in the HTML and no inline code', async () => {
      for (const role of ROLES) {
        const res = await agents[role].get('/employers');
        assert.equal(res.status, 200, role);
        assert.equal(rowNames(res.text).length, 25, role);
        assert.match(res.text, /1–25 of 30 employers/);
        assertNoInlineCode(res.text, `/employers as ${role}`);
      }
    });

    it('pages by 25', async () => {
      const res = await agents.staff.get('/employers?page=2');
      assert.match(res.text, /26–30 of 30 employers/);
      assert.equal(rowNames(res.text).length, 5);
      assert.match(res.text, /Page 2 of 2/);
    });

    it('sorts by a whitelisted column and marks the header with aria-sort', async () => {
      const res = await agents.staff.get('/employers?sort=name&dir=desc');
      assert.equal(rowNames(res.text)[0], 'شركة الدوحة للتقنية');
      assert.match(res.text, /aria-sort="descending"/);
    });

    it('falls back to the default sort for an unknown sort key', async () => {
      const res = await agents.staff.get('/employers?sort=CompanyName;DROP&dir=sideways');
      assert.equal(res.status, 200);
      assert.equal(rowNames(res.text)[0], 'Employer 01');
      assert.match(res.text, /aria-sort="ascending"/);
    });

    it('filters by sector and location', async () => {
      const sector = await agents.staff.get('/employers?sector=Startup');
      assert.deepEqual(rowNames(sector.text), ['Gulf Analytics']);
      const gcc = await agents.staff.get('/employers?region=gcc');
      assert.deepEqual(rowNames(gcc.text), ['Gulf Analytics']);
      const ignored = await agents.staff.get('/employers?sector=Nonsense');
      assert.equal(rowNames(ignored.text).length, 25);
    });

    it('finds Arabic names', async () => {
      const res = await agents.staff.get(`/employers?q=${encodeURIComponent('الدوحة')}`);
      assert.deepEqual(rowNames(res.text), ['شركة الدوحة للتقنية']);
    });

    it('shows the empty state with a way out when nothing matches', async () => {
      const res = await agents.staff.get('/employers?q=zzzz');
      assert.match(res.text, /No employers match these filters/);
      assert.match(res.text, /Clear filters/);
    });

    it('exports the current filter to xlsx for roles with export:run only', async () => {
      const res = await agents.readonly.get('/employers?sector=Startup&format=xlsx').buffer(true).parse(binaryParser);
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], XLSX_CONTENT_TYPE);
      assert.ok(res.body.length > 100);
      const denied = await agents.student_worker.get('/employers?format=xlsx');
      assert.equal(denied.status, 403);
      assert.match(denied.text, /cannot export data/);
      assert.doesNotMatch((await agents.student_worker.get('/employers')).text, /format=xlsx/);
    });
  });

  describe('profile', () => {
    it('shows the employer with tabs for every role that may read it', async () => {
      const id = insertCompany(ctx.db, { CompanyName: 'Profile Co' });
      for (const role of ROLES) {
        const res = await agents[role].get(`/employers/${id}`);
        assert.equal(res.status, 200, role);
        assert.match(res.text, /<h1 dir="auto">Profile Co<\/h1>/);
        assertNoInlineCode(res.text, `profile as ${role}`);
      }
      const contacts = await agents.staff.get(`/employers/${id}?tab=contacts`);
      assert.match(contacts.text, /No contacts yet/);
    });

    it('offers edit and delete only to roles that may do them', async () => {
      const id = insertCompany(ctx.db, { CompanyName: 'Buttons Co' });
      assert.match((await agents.staff.get(`/employers/${id}`)).text, /\/delete"/);
      const readonly = await agents.readonly.get(`/employers/${id}`);
      assert.doesNotMatch(readonly.text, /\/delete"/);
      assert.doesNotMatch(readonly.text, /\/edit"/);
    });

    it('is a 404 page for an unknown employer', async () => {
      const res = await agents.staff.get('/employers/999999');
      assert.equal(res.status, 404);
      assert.match(res.text, /This page does not exist/);
    });
  });

  describe('form', () => {
    it('creates an employer and confirms with a message', async () => {
      const res = await postForm(agents.staff, '/employers', {
        CompanyName: 'Lusail Robotics',
        Industry: 'Robotics',
        Sector: 'Private',
        Country: 'Qatar',
        SignedMoU: ['0', '1'],
      });
      assert.equal(res.status, 303);
      assert.match(res.headers.location, /^\/employers\/\d+$/);
      const page = await agents.staff.get(res.headers.location);
      assert.match(page.text, /Employer saved/);
      assert.match(page.text, /<span class="tag">MoU<\/span>/);
    });

    it('re-renders the form with 422, the field message and what was typed', async () => {
      const res = await postForm(agents.staff, '/employers', {
        CompanyName: 'مؤسسة بلا قطاع',
        Industry: '',
        Sector: '',
        Country: 'Qatar',
      });
      assert.equal(res.status, 422);
      assert.match(res.text, /Industry is required/);
      assert.match(res.text, /value="مؤسسة بلا قطاع"/);
      assert.match(res.text, /aria-invalid="true"/);
    });

    it('answers htmx with HX-Redirect after saving', async () => {
      const res = await htmxPost(agents.staff, '/employers', {
        CompanyName: 'Dialog Co',
        Industry: 'Media',
        Sector: 'NGO',
        Country: 'Qatar',
      });
      assert.equal(res.status, 200);
      assert.match(res.headers['hx-redirect'], /^\/employers\/\d+$/);
    });

    it('updates with the UpdatedAt it was loaded with, and refuses a stale copy with 409', async () => {
      const id = insertCompany(ctx.db, { CompanyName: 'Edit Me' });
      const form = await agents.staff.get(`/employers/${id}/edit`);
      assert.equal(form.status, 200);
      const updatedAt = /name="UpdatedAt" value="([^"]+)"/.exec(form.text)[1];
      const fields = { CompanyName: 'Edited', Industry: 'Tech', Sector: 'Private', Country: 'Qatar' };

      const saved = await postForm(agents.staff, `/employers/${id}`, { ...fields, UpdatedAt: updatedAt });
      assert.equal(saved.status, 303);

      setStoredUpdatedAt(ctx.db, 'Company', 'CompanyID', id, '2030-01-01 00:00:00');
      const stale = await postForm(agents.staff, `/employers/${id}`, {
        ...fields,
        CompanyName: 'My late edit',
        UpdatedAt: STALE_TIMESTAMP,
      });
      assert.equal(stale.status, 409);
      assert.match(
        stale.text,
        /Someone else changed this record while you were editing\. Reload to see their changes\./
      );
      assert.match(stale.text, /value="My late edit"/);
    });

    it('deletes after the confirmation and says so', async () => {
      const id = insertCompany(ctx.db, { CompanyName: 'Delete Me' });
      const profile = await agents.staff.get(`/employers/${id}`);
      assert.match(profile.text, /data-confirm-title="Delete Delete Me\?"/);
      const res = await postForm(agents.staff, `/employers/${id}/delete`);
      assert.equal(res.status, 303);
      assert.equal(res.headers.location, '/employers');
      assert.match((await agents.staff.get('/employers')).text, /Delete Me deleted/);
      assert.equal((await agents.staff.get(`/employers/${id}`)).status, 404);
    });

    it('shows the 403 page to a role that may not add or change employers', async () => {
      const id = insertCompany(ctx.db, { CompanyName: 'Protected Co' });
      for (const url of ['/employers/new', `/employers/${id}/edit`]) {
        const res = await agents.student_worker.get(url);
        assert.equal(res.status, 403, url);
        assert.match(res.text, /You do not have access to this page/);
      }
      const post = await postForm(agents.readonly, '/employers', { CompanyName: 'X' });
      assert.equal(post.status, 403);
      const del = await postForm(agents.student_worker, `/employers/${id}/delete`);
      assert.equal(del.status, 403);
    });

    it('rejects a form without the CSRF token', async () => {
      const res = await agents.staff.post('/employers').type('form').send({ CompanyName: 'No token' });
      assert.equal(res.status, 403);
      assert.match(res.text, /This form has expired/);
    });
  });
});
