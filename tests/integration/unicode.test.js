'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, loginAs, post, put } = require('../helpers/app');

const COMPANY_NAME = 'شركة الخليج للتقنية';
const MIXED_COMPANY_NAME = 'Gulf Tech | الخليج للتقنية – Doha Branch';
const FIRST_NAME = 'محمد';
const LAST_NAME = 'آل ثاني';
const MIXED_COMMENT = 'Met with محمد at the Doha office 🇶🇦; follow up بعد العيد (after Eid).';

describe('Arabic and Unicode text', () => {
  let ctx;
  let admin;
  let company;
  let mixedCompany;
  let contact;

  before(async () => {
    ctx = await buildApp();
    admin = await loginAs(ctx, 'admin');

    company = (
      await post(admin, '/api/companies', {
        CompanyName: COMPANY_NAME,
        Industry: 'تقنية المعلومات',
        Sector: 'Private',
        Country: 'قطر',
        Comment: MIXED_COMMENT,
      })
    ).body;
    mixedCompany = (
      await post(admin, '/api/companies', {
        CompanyName: MIXED_COMPANY_NAME,
        Industry: 'Technology',
        Sector: 'Startup',
        Country: 'Qatar',
      })
    ).body;
    contact = (
      await post(admin, '/api/contacts', {
        CompanyID: company.CompanyID,
        FirstName: FIRST_NAME,
        LastName: LAST_NAME,
        JobTitle: 'مدير الموارد البشرية',
        EmailAddress: 'm.althani@example.qa',
        Status: 'Mailable',
      })
    ).body;
  });

  after(() => ctx.close());

  it('stores and returns an Arabic company name byte-for-byte', async () => {
    assert.equal(company.CompanyName, COMPANY_NAME);
    const res = await admin.get(`/api/companies/${company.CompanyID}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.CompanyName, COMPANY_NAME);
    assert.equal(res.body.Industry, 'تقنية المعلومات');
    assert.equal(res.body.Country, 'قطر');
    assert.ok(Buffer.from(res.body.CompanyName, 'utf8').equals(Buffer.from(COMPANY_NAME, 'utf8')));
  });

  it('stores mixed Arabic, English and emoji text unchanged', async () => {
    const res = await admin.get(`/api/companies/${company.CompanyID}`);
    assert.equal(res.body.Comment, MIXED_COMMENT);
    const mixed = await admin.get(`/api/companies/${mixedCompany.CompanyID}`);
    assert.equal(mixed.body.CompanyName, MIXED_COMPANY_NAME);
  });

  it('stores and returns an Arabic contact name unchanged', async () => {
    const res = await admin.get(`/api/contacts/${contact.ContactID}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.FirstName, FIRST_NAME);
    assert.equal(res.body.LastName, LAST_NAME);
    assert.equal(res.body.JobTitle, 'مدير الموارد البشرية');
    assert.equal(res.body.CompanyName, COMPANY_NAME);
  });

  it('serves Arabic text as UTF-8 JSON', async () => {
    const res = await admin.get(`/api/companies/${company.CompanyID}`);
    assert.match(res.headers['content-type'], /application\/json; charset=utf-8/i);
  });

  it('finds a company by an Arabic substring', async () => {
    const res = await admin.get('/api/companies').query({ search: 'الخليج' });
    assert.equal(res.status, 200);
    const ids = res.body.map((row) => row.CompanyID).sort();
    assert.deepEqual(ids, [company.CompanyID, mixedCompany.CompanyID].sort());
  });

  it('finds a company by its Arabic country name', async () => {
    const res = await admin.get('/api/companies').query({ search: 'قطر' });
    assert.deepEqual(
      res.body.map((row) => row.CompanyID),
      [company.CompanyID]
    );
  });

  it('finds a contact by an Arabic first-name or last-name substring', async () => {
    const byFirst = await admin.get('/api/contacts').query({ search: 'محم' });
    assert.deepEqual(
      byFirst.body.map((row) => row.ContactID),
      [contact.ContactID]
    );
    const byLast = await admin.get('/api/contacts').query({ search: 'ثاني' });
    assert.deepEqual(
      byLast.body.map((row) => row.ContactID),
      [contact.ContactID]
    );
  });

  it('returns nothing for an Arabic search with no match', async () => {
    const res = await admin.get('/api/companies').query({ search: 'لا يوجد' });
    assert.deepEqual(res.body, []);
  });

  it('keeps Arabic text unchanged through an update', async () => {
    const current = (await admin.get(`/api/contacts/${contact.ContactID}`)).body;
    const res = await put(admin, `/api/contacts/${contact.ContactID}`, {
      CompanyID: company.CompanyID,
      FirstName: 'عبد الله',
      LastName: LAST_NAME,
      EmailAddress: current.EmailAddress,
      Status: 'Mailable',
      UpdatedAt: current.UpdatedAt,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.FirstName, 'عبد الله');
    const reread = await admin.get(`/api/contacts/${contact.ContactID}`);
    assert.equal(reread.body.FirstName, 'عبد الله');
    assert.equal(reread.body.LastName, LAST_NAME);
  });
});
