'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, setStoredUpdatedAt, STALE_TIMESTAMP, today } = require('../helpers/app');
const { webLoginAs, postForm, htmxPost, assertNoInlineCode } = require('../helpers/web');
const { canAccessRecord, PERMISSIONS } = require('../../src/security/permissions');
const { SCREENS } = require('../../src/web/screens');

const ROLES = ['admin', 'staff', 'readonly', 'student_worker'];

describe('web: generic record screens', () => {
  let ctx;
  const agents = {};
  let companyId;
  let otherCompanyId;
  let contactId;
  let otherContactId;

  before(async () => {
    ctx = await buildApp();
    const insertCompany = ctx.db.prepare(
      "INSERT INTO Company (CompanyName, Industry, Sector, Country, DateAdded) VALUES (?, 'Tech', 'Private', 'Qatar', '2026-01-01')"
    );
    const insertContact = ctx.db.prepare(
      "INSERT INTO Contact (CompanyID, FirstName, LastName, EmailAddress, DateAdded, Status) VALUES (?, ?, ?, ?, '2026-01-01', 'Mailable')"
    );
    companyId = Number(insertCompany.run('Gulf Robotics').lastInsertRowid);
    otherCompanyId = Number(insertCompany.run('Other Co').lastInsertRowid);
    contactId = Number(insertContact.run(companyId, 'Huda', 'Saleh', 'huda@private.example').lastInsertRowid);
    otherContactId = Number(
      insertContact.run(otherCompanyId, 'نورة', 'الكعبي', 'noora@private.example').lastInsertRowid
    );
    for (const role of ROLES) agents[role] = await webLoginAs(ctx, role);
  });
  after(() => ctx.close());

  describe('lists', () => {
    it('open for the roles that may read them and show the 403 page to the others', async () => {
      for (const screen of SCREENS.filter((candidate) => !candidate.listPath && candidate.recordType !== 'companies')) {
        for (const role of ROLES) {
          const res = await agents[role].get(screen.base);
          const allowed = canAccessRecord({ role }, PERMISSIONS.RECORD_READ, screen.recordType);
          assert.equal(res.status, allowed ? 200 : 403, `${screen.base} as ${role}`);
          if (allowed) assertNoInlineCode(res.text, `${screen.base} as ${role}`);
          else assert.match(res.text, /You do not have access to this page/);
        }
      }
    });

    it('/events shows only the tabs the role may read', async () => {
      const staff = await agents.staff.get('/events');
      assert.match(staff.text, /Career events/);
      assert.match(staff.text, /Student-led/);
      const student = await agents.student_worker.get('/events?tab=student-led');
      assert.equal(student.status, 200);
      assert.doesNotMatch(student.text, /Student-led/);
      assert.match(student.text, /aria-current="page">Career events/);
    });

    it('shows withheld values as Restricted, never as empty', async () => {
      const res = await agents.student_worker.get('/contacts');
      assert.match(res.text, /Restricted/);
      assert.doesNotMatch(res.text, /private\.example/);
      assert.match((await agents.staff.get('/contacts')).text, /huda@private\.example/);
    });

    it('searches Arabic names', async () => {
      const res = await agents.staff.get(`/contacts?q=${encodeURIComponent('نورة')}`);
      assert.match(res.text, /نورة الكعبي/);
      assert.doesNotMatch(res.text, /Huda Saleh/);
    });
  });

  describe('interaction form', () => {
    const fields = () => ({
      CompanyID: String(companyId),
      ContactID: String(contactId),
      InteractionType: 'Call',
      InteractionDate: today(),
      DiscussionItems: 'Internship pipeline for summer',
      InteractionStatus: 'In-progress',
    });

    it('starts with the employer chosen and only its contacts offered', async () => {
      const res = await agents.staff.get(`/interactions/new?CompanyID=${companyId}`);
      assert.equal(res.status, 200);
      assert.match(res.text, /id="form"/);
      assert.match(res.text, /Huda Saleh/);
      assert.doesNotMatch(res.text, /نورة/);
      assert.match(res.text, new RegExp(`value="${today()}"`));
      assertNoInlineCode(res.text, 'interaction form');
    });

    it('narrows the contact select when the employer changes', async () => {
      const res = await agents.staff.get(`/options/contacts?CompanyID=${otherCompanyId}`).set('HX-Request', 'true');
      assert.equal(res.status, 200);
      assert.match(res.text, /id="f-ContactID"/);
      assert.match(res.text, /نورة الكعبي/);
      assert.doesNotMatch(res.text, /Huda/);
    });

    it('creates, refuses invalid input with 422, updates, refuses a stale update with 409 and deletes', async () => {
      const created = await postForm(agents.student_worker, '/interactions', fields());
      assert.equal(created.status, 303);
      const id = Number(/\/interactions\/(\d+)$/.exec(created.headers.location)[1]);

      const invalid = await postForm(agents.staff, '/interactions', {
        ...fields(),
        ContactID: String(otherContactId),
        DiscussionItems: 'نص عربي محفوظ',
      });
      assert.equal(invalid.status, 422);
      assert.match(invalid.text, /The selected contact does not belong to this employer/);
      assert.match(invalid.text, /نص عربي محفوظ/);

      const edit = await agents.staff.get(`/interactions/${id}/edit`);
      const updatedAt = /name="UpdatedAt" value="([^"]+)"/.exec(edit.text)[1];
      const saved = await htmxPost(agents.staff, `/interactions/${id}`, {
        ...fields(),
        DiscussionItems: 'Changed',
        UpdatedAt: updatedAt,
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.headers['hx-redirect'], `/interactions/${id}`);

      setStoredUpdatedAt(ctx.db, 'OutreachEngagement', 'OutreachEngagementID', id, '2030-01-01 00:00:00');
      const stale = await postForm(agents.staff, `/interactions/${id}`, {
        ...fields(),
        DiscussionItems: 'My version',
        UpdatedAt: STALE_TIMESTAMP,
      });
      assert.equal(stale.status, 409);
      assert.match(stale.text, /Someone else changed this record while you were editing/);
      assert.match(stale.text, /My version/);

      const detail = await agents.staff.get(`/interactions/${id}`);
      assert.equal(detail.status, 200);
      assertNoInlineCode(detail.text, 'interaction detail');

      assert.equal((await postForm(agents.student_worker, `/interactions/${id}/delete`)).status, 403);
      const deleted = await postForm(agents.staff, `/interactions/${id}/delete`);
      assert.equal(deleted.status, 303);
      assert.equal(deleted.headers.location, '/interactions');
      assert.equal((await agents.staff.get(`/interactions/${id}`)).status, 404);
    });

    it('returns to the page the form was opened from', async () => {
      const res = await postForm(agents.staff, '/interactions', {
        ...fields(),
        returnTo: `/employers/${companyId}`,
      });
      assert.equal(res.headers.location, `/employers/${companyId}`);
      const outside = await postForm(agents.staff, '/interactions', { ...fields(), returnTo: 'https://evil.example/' });
      assert.match(outside.headers.location, /^\/interactions\/\d+$/);
    });
  });

  describe('contact page', () => {
    it('lists the contact’s interactions', async () => {
      const res = await agents.readonly.get(`/contacts/${contactId}`);
      assert.equal(res.status, 200);
      assert.match(res.text, /<h2 id="timeline-heading">Interactions<\/h2>/);
      assert.match(res.text, /Internship pipeline for summer/);
      assertNoInlineCode(res.text, 'contact page');
    });

    it('withholds personal details from a student worker', async () => {
      const res = await agents.student_worker.get(`/contacts/${contactId}`);
      assert.equal(res.status, 200);
      assert.doesNotMatch(res.text, /private\.example/);
      assert.match(res.text, /Restricted/);
    });
  });
});
