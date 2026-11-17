'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, loginAs, post, put } = require('../helpers/app');
const { RECORD_TYPES, createRefs } = require('../helpers/records');

const recruitmentType = RECORD_TYPES.find((type) => type.path === 'recruitment');

describe('Record rules through the API', () => {
  let ctx;
  let admin;
  let refs;

  before(async () => {
    ctx = await buildApp();
    admin = await loginAs(ctx, 'admin');
    refs = await createRefs(admin);
  });

  after(() => ctx.close());

  const count = (table) => ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

  describe('validation messages', () => {
    it('names the failing field in plain words and lists every failing field', async () => {
      const res = await post(admin, '/api/contacts', {
        CompanyID: refs.companyId,
        FirstName: 'A',
        LastName: '',
        EmailAddress: 'not-an-email',
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Last name is required');
      assert.deepEqual(res.body.fields, {
        LastName: 'Last name is required',
        EmailAddress: 'Email address is not valid',
      });
    });

    it('lists the allowed values of an enumerated field', async () => {
      const res = await post(admin, '/api/companies', {
        CompanyName: 'X',
        Industry: 'Y',
        Sector: 'Corporate',
        Country: 'Qatar',
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Sector must be one of: Government, NGO, Private, Semi-government, Startup');
    });

    for (const [field, value] of [
      ['Mode', 'Underwater'],
      ['Status', 'Volunteer'],
      ['TargetGroup', 'Everyone'],
      ['HiredStudentAlumni', 'Maybe'],
    ]) {
      it(`rejects an invalid recruitment ${field} with 400`, async () => {
        const res = await post(admin, '/api/recruitment', { ...recruitmentType.payload(refs), [field]: value });
        assert.equal(res.status, 400);
        assert.ok(res.body.fields[field]);
      });
    }

    it('rejects an invalid hiring-feedback HiredStudentAlumni with 400', async () => {
      const res = await post(admin, '/api/hiring-feedback', {
        CompanyID: refs.companyId,
        ContactID: refs.contactId,
        FeedbackProvider: 'Company',
        HiredStudentAlumni: 'Not Reported',
        DateReported: '2025-01-01',
      });
      assert.equal(res.status, 400);
    });

    for (const date of ['2024-13-45', '2025-02-30']) {
      it(`rejects the impossible date ${date} in a body and in a list query`, async () => {
        const res = await post(admin, '/api/outreach', {
          CompanyID: refs.companyId,
          ContactID: refs.contactId,
          InteractionType: 'Call',
          InteractionDate: date,
          DiscussionItems: 'x',
        });
        assert.equal(res.status, 400);
        assert.equal(res.body.error, 'Interaction date must be a real date in YYYY-MM-DD format');
        assert.equal((await admin.get('/api/outreach').query({ from: date })).status, 400);
      });
    }
  });

  describe('references', () => {
    it('rejects an employer that does not exist with a clear message', async () => {
      const res = await post(admin, '/api/contacts', {
        CompanyID: 999999,
        FirstName: 'A',
        LastName: 'B',
        EmailAddress: 'a@example.com',
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'The selected employer does not exist');
    });

    it('rejects a contact that does not exist', async () => {
      const res = await post(admin, '/api/recruitment', { ...recruitmentType.payload(refs), ContactID: 999999 });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'The selected contact does not exist');
    });

    it('rejects a contact of another employer', async () => {
      const other = await createRefs(admin, ' Other');
      const res = await post(admin, '/api/recruitment', {
        ...recruitmentType.payload(refs),
        ContactID: other.contactId,
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'The selected contact does not belong to this employer');
    });
  });

  describe('transactions', () => {
    it('a failure while writing child rows leaves no recruitment posting behind', async () => {
      ctx.db.exec(`
        CREATE TEMP TRIGGER fail_on_major BEFORE INSERT ON Recruitment_TargetMajors
        WHEN NEW.Major = 'Explosives'
        BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
      `);
      const before = count('Recruitment');
      const res = await post(admin, '/api/recruitment', {
        ...recruitmentType.payload(refs),
        OpportunityTypes: ['Internship'],
        TargetMajors: ['CS', 'Explosives'],
      });
      assert.equal(res.status, 500);
      assert.doesNotMatch(JSON.stringify(res.body), /simulated|SQLITE/);
      assert.equal(count('Recruitment'), before);
      ctx.db.exec('DROP TRIGGER temp.fail_on_major');
    });
  });

  describe('blacklisted employers', () => {
    it('forces Non-mailable on contacts created or edited for a blacklisted employer', async () => {
      const company = await post(admin, '/api/companies', {
        CompanyName: 'Blacklisted Rules Co',
        Industry: 'Mining',
        Sector: 'Private',
        Country: 'Oman',
        Blacklisted: true,
      });
      const created = await post(admin, '/api/contacts', {
        CompanyID: company.body.CompanyID,
        FirstName: 'Still',
        LastName: 'Here',
        EmailAddress: 'still@example.com',
        Status: 'Mailable',
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.Status, 'Non-mailable');

      const edited = await put(admin, `/api/contacts/${created.body.ContactID}`, {
        CompanyID: company.body.CompanyID,
        FirstName: 'Still',
        LastName: 'Here',
        EmailAddress: 'still@example.com',
        Status: 'Mailable',
        UpdatedAt: created.body.UpdatedAt,
      });
      assert.equal(edited.status, 200);
      assert.equal(edited.body.Status, 'Non-mailable');
    });
  });
});
