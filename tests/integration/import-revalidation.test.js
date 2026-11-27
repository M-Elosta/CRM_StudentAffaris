'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, loginAs, post } = require('../helpers/app');
const { createRefs } = require('../helpers/records');

describe('Import re-validation', () => {
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

  const outreachRow = (overrides = {}) => ({
    CompanyID: refs.companyId,
    ContactID: refs.contactId,
    InteractionType: 'Meeting',
    InteractionDate: '2025-02-10',
    DiscussionItems: 'Imported discussion',
    ...overrides,
  });

  describe('validate', () => {
    it('applies the API rules: real dates, existing employers and matching contacts', async () => {
      const other = await createRefs(admin, ' Elsewhere');
      const mapping = Object.fromEntries(Object.keys(outreachRow()).map((key) => [key, key]));
      const res = await post(admin, '/api/import/validate', {
        entity: 'Outreach',
        mapping,
        rows: [
          outreachRow(),
          outreachRow({ InteractionDate: '2025-02-30' }),
          outreachRow({ CompanyID: 999999 }),
          outreachRow({ ContactID: other.contactId }),
        ],
      });
      assert.equal(res.status, 200);
      assert.deepEqual(
        res.body.map((result) => result.status),
        ['valid', 'error', 'error', 'error']
      );
      assert.match(res.body[1].errors.join(' '), /Interaction date must be a real date/);
      assert.match(res.body[2].errors.join(' '), /employer does not exist/);
      assert.match(res.body[3].errors.join(' '), /does not belong to this employer/);
    });

    it('reports an invalid email address in plain words', async () => {
      const res = await post(admin, '/api/import/validate', {
        entity: 'Contact',
        mapping: { Employer: 'CompanyID', First: 'FirstName', Last: 'LastName', Email: 'EmailAddress' },
        rows: [{ Employer: String(refs.companyId), First: 'A', Last: 'B', Email: 'not-an-email' }],
      });
      assert.equal(res.body[0].status, 'error');
      assert.deepEqual(res.body[0].errors, ['Email address is not valid']);
    });
  });

  describe('confirm', () => {
    it('saves the valid rows and reports the invalid ones, in the same request', async () => {
      const before = count('OutreachEngagement');
      const res = await post(admin, '/api/import/confirm', {
        entity: 'Outreach',
        rows: [
          { row: outreachRow({ DiscussionItems: 'Good row' }), action: 'import' },
          { row: outreachRow({ InteractionType: 'Telegram' }), action: 'import' },
          { row: outreachRow({ InteractionDate: '2024-13-45' }), action: 'import' },
        ],
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.imported, 1);
      assert.equal(res.body.failed, 2);
      assert.equal(count('OutreachEngagement'), before + 1);
      assert.match(res.body.failedDetails[0].error, /Interaction type must be one of/);
      assert.match(res.body.failedDetails[1].error, /real date/);
      assert.equal(typeof res.body.errorFileBase64, 'string');
    });

    it('does not save SQL error text into the result', async () => {
      const res = await post(admin, '/api/import/confirm', {
        entity: 'Contact',
        rows: [
          {
            row: { CompanyID: 999999, FirstName: 'No', LastName: 'Employer', EmailAddress: 'x@y.qa' },
            action: 'import',
          },
        ],
      });
      assert.equal(res.body.failed, 1);
      assert.equal(res.body.failedDetails[0].error, 'The selected employer does not exist');
      assert.doesNotMatch(JSON.stringify(res.body.failedDetails), /SQLITE|constraint/i);
    });

    it('overwrites an existing record in place and keeps the fields the file does not have', async () => {
      const created = await post(admin, '/api/outreach', outreachRow({ ActionPlan: 'Keep this plan' }));
      const id = created.body.OutreachEngagementID;
      const before = count('OutreachEngagement');
      const res = await post(admin, '/api/import/confirm', {
        entity: 'Outreach',
        rows: [
          {
            row: {
              CompanyID: refs.companyId,
              ContactID: refs.contactId,
              InteractionType: 'Meeting',
              InteractionDate: '2025-02-10',
              DiscussionItems: 'Overwritten by import',
              __existingId: id,
            },
            action: 'overwrite',
          },
        ],
      });
      assert.equal(res.body.updated, 1);
      assert.equal(count('OutreachEngagement'), before, 'no record was added or removed');
      const stored = (await admin.get(`/api/outreach/${id}`)).body;
      assert.equal(stored.OutreachEngagementID, id);
      assert.equal(stored.DiscussionItems, 'Overwritten by import');
      assert.equal(stored.ActionPlan, 'Keep this plan');
    });

    it('overwrites a recruitment posting without losing its child arrays', async () => {
      const created = await post(admin, '/api/recruitment', {
        CompanyID: refs.companyId,
        ContactID: refs.contactId,
        OpportunityTitle: 'Import overwrite',
        Mode: 'Onsite',
        Status: 'Paid',
        TargetGroup: 'Open to all',
        TargetMajors: ['CS'],
      });
      const res = await post(admin, '/api/import/confirm', {
        entity: 'Recruitment',
        rows: [
          {
            row: {
              CompanyID: refs.companyId,
              ContactID: refs.contactId,
              OpportunityTitle: 'Import overwrite',
              Mode: 'Remote',
              Status: 'Paid',
              TargetGroup: 'Open to all',
              __existingId: created.body.RecruitmentID,
            },
            action: 'overwrite',
          },
        ],
      });
      assert.equal(res.body.updated, 1);
      const stored = (await admin.get(`/api/recruitment/${created.body.RecruitmentID}`)).body;
      assert.equal(stored.Mode, 'Remote');
      assert.deepEqual(stored.TargetMajors, ['CS']);
    });

    it('refuses to overwrite a record that does not exist in the right table', async () => {
      const before = count('Contact');
      const res = await post(admin, '/api/import/confirm', {
        entity: 'Contact',
        rows: [
          {
            row: {
              CompanyID: refs.companyId,
              FirstName: 'Ghost',
              LastName: 'Row',
              EmailAddress: 'ghost@example.qa',
              __existingId: 987654,
            },
            action: 'overwrite',
          },
          {
            row: {
              CompanyID: refs.companyId,
              FirstName: 'Bad',
              LastName: 'Id',
              EmailAddress: 'bad-id@example.qa',
              __existingId: 'abc',
            },
            action: 'overwrite',
          },
        ],
      });
      assert.equal(res.body.updated, 0);
      assert.equal(res.body.imported, 0);
      assert.equal(res.body.failed, 2);
      assert.equal(count('Contact'), before);
    });

    it('applies the blacklist rule to imported contacts', async () => {
      const company = await post(admin, '/api/companies', {
        CompanyName: 'Import Blacklisted',
        Industry: 'X',
        Sector: 'Private',
        Country: 'Qatar',
        Blacklisted: true,
      });
      const res = await post(admin, '/api/import/confirm', {
        entity: 'Contact',
        rows: [
          {
            row: {
              CompanyID: company.body.CompanyID,
              FirstName: 'Imported',
              LastName: 'Contact',
              EmailAddress: 'imported@example.qa',
              Status: 'Mailable',
            },
            action: 'import',
          },
        ],
      });
      assert.equal(res.body.imported, 1);
      const [contact] = (await admin.get('/api/contacts').query({ companyId: company.body.CompanyID })).body;
      assert.equal(contact.Status, 'Non-mailable');
    });

    it('imports collaboration opportunities from their yes/no columns', async () => {
      const mapping = { Employer: 'CompanyID', Mentoring: 'Mentorship Programs', Visits: 'Company/Site Visits' };
      const validation = await post(admin, '/api/import/validate', {
        entity: 'Potential Collaboration',
        mapping,
        rows: [{ Employer: String(refs.companyId), Mentoring: 'Yes', Visits: 'no' }],
      });
      assert.equal(validation.body[0].status, 'valid', JSON.stringify(validation.body[0].errors));
      const res = await post(admin, '/api/import/confirm', {
        entity: 'Potential Collaboration',
        rows: [{ row: validation.body[0].row, action: 'import' }],
      });
      assert.equal(res.body.imported, 1);
      const listed = (await admin.get('/api/collaboration')).body.find((row) => row.CompanyID === refs.companyId);
      assert.deepEqual(listed.Opportunities, ['Mentorship Programs']);
    });

    it('rejects an entity name inherited from Object.prototype with 400', async () => {
      assert.equal((await post(admin, '/api/import/confirm', { entity: 'constructor', rows: [{}] })).status, 400);
      assert.equal((await post(admin, '/api/import/confirm', { entity: 'toString', rows: [{}] })).status, 400);
    });
  });
});
