'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { openDatabase } = require('../../src/db/connection');
const { migrate } = require('../../src/db/migrate');
const { createServices } = require('../../src/services');
const { createRecordService, STALE_RECORD_MESSAGE } = require('../../src/services/record-service');
const { createCrudRepository } = require('../../src/db/repositories/crud-repository');
const { recordTypeByPath } = require('../../src/domain/record-types');
const { ConflictError, NotFoundError, ValidationError } = require('../../src/lib/errors');
const { loadConfig } = require('../../src/config');
const { createSilentLogger, setStoredUpdatedAt } = require('../helpers/app');

const COMPANY = { CompanyName: 'Doha Ports', Industry: 'Logistics', Sector: 'Government', Country: 'Qatar' };

function assertRejectsWith(fn, ErrorClass, pattern) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof ErrorClass, `expected ${ErrorClass.name}, got ${err?.name}: ${err?.message}`);
    if (pattern) assert.match(err.message, pattern);
    return true;
  });
}

describe('record-service', () => {
  let db;
  let records;
  let companies;
  let contacts;
  let recruitment;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    await migrate(db, { logger: createSilentLogger() });
    const config = loadConfig({ NODE_ENV: 'test' });
    records = createServices({ db, config, logger: createSilentLogger() }).records;
    companies = records.get('companies').service;
    contacts = records.get('contacts').service;
    recruitment = records.get('recruitment').service;
  });

  afterEach(() => db.close());

  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

  function createCompanyAndContact(overrides = {}) {
    const company = companies.create({ ...COMPANY, ...overrides });
    const contact = contacts.create({
      CompanyID: company.CompanyID,
      FirstName: 'Mona',
      LastName: 'Rashid',
      EmailAddress: 'mona@example.qa',
    });
    return { company, contact };
  }

  function postingFor({ company, contact }, extra = {}) {
    return {
      CompanyID: company.CompanyID,
      ContactID: contact.ContactID,
      OpportunityTitle: 'Analyst',
      Mode: 'Hybrid',
      Status: 'Paid',
      TargetGroup: 'Qatari only',
      ...extra,
    };
  }

  describe('create', () => {
    it('validates the body and fills date defaults with today in the office time zone', () => {
      const definition = recordTypeByPath('companies');
      // 22:00 UTC on 31 March is already 1 April in Qatar.
      const service = createRecordService({
        db,
        repository: createCrudRepository(db, definition),
        definition,
        schema: records.get('companies').schema,
        lookups: {},
        timeZone: 'Asia/Qatar',
        now: () => new Date(Date.UTC(2025, 2, 31, 22, 0)),
      });
      const created = service.create(COMPANY);
      assert.equal(created.DateAdded, '2025-04-01');
      assert.equal(created.Sector, 'Government');
    });

    it('rejects an invalid body with every failing field listed', () => {
      assert.throws(
        () => companies.create({ ...COMPANY, Sector: 'Corporate', Website: 'ftp://x' }),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.equal(err.message, 'Sector must be one of: Government, NGO, Private, Semi-government, Startup');
          assert.deepEqual(Object.keys(err.fields).sort(), ['Sector', 'Website']);
          return true;
        }
      );
      assert.equal(count('Company'), 0);
    });
  });

  describe('foreign-key checks', () => {
    it('rejects an employer that does not exist', () => {
      assertRejectsWith(
        () => contacts.create({ CompanyID: 4242, FirstName: 'A', LastName: 'B', EmailAddress: 'a@b.qa' }),
        ValidationError,
        /^The selected employer does not exist$/
      );
    });

    it('rejects a contact that does not exist', () => {
      const { company } = createCompanyAndContact();
      assertRejectsWith(
        () => recruitment.create(postingFor({ company, contact: { ContactID: 4242 } })),
        ValidationError,
        /^The selected contact does not exist$/
      );
    });

    it('rejects a contact that belongs to another employer', () => {
      const first = createCompanyAndContact();
      const other = companies.create({ ...COMPANY, CompanyName: 'Other Employer' });
      assert.throws(
        () => recruitment.create(postingFor({ company: other, contact: first.contact })),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.equal(err.message, 'The selected contact does not belong to this employer');
          assert.deepEqual(err.fields, { ContactID: 'The selected contact does not belong to this employer' });
          return true;
        }
      );
      assert.equal(count('Recruitment'), 0);
    });
  });

  describe('update with the stale check', () => {
    it('saves when UpdatedAt matches, in SQL or ISO form', () => {
      const { company } = createCompanyAndContact();
      const isoForm = company.UpdatedAt.replace(' ', 'T') + '.000Z';
      const updated = companies.update(company.CompanyID, { ...COMPANY, Industry: 'Shipping', UpdatedAt: isoForm });
      assert.equal(updated.Industry, 'Shipping');
    });

    it('rejects with 409 when the stored UpdatedAt differs', () => {
      const { company } = createCompanyAndContact();
      setStoredUpdatedAt(db, 'Company', 'CompanyID', company.CompanyID, '2099-01-01 00:00:00');
      assertRejectsWith(
        () => companies.update(company.CompanyID, { ...COMPANY, Industry: 'Shipping', UpdatedAt: company.UpdatedAt }),
        ConflictError,
        /reload/i
      );
      assert.match(STALE_RECORD_MESSAGE, /reload/i);
      assert.equal(companies.get(company.CompanyID).Industry, 'Logistics');
    });

    it('rejects a missing or malformed UpdatedAt with 400', () => {
      const { company } = createCompanyAndContact();
      assertRejectsWith(() => companies.update(company.CompanyID, COMPANY), ValidationError, /UpdatedAt is required/);
      assertRejectsWith(
        () => companies.update(company.CompanyID, { ...COMPANY, UpdatedAt: 'yesterday' }),
        ValidationError,
        /valid record timestamp/
      );
    });

    it('reports an unknown id as not found before looking at the body', () => {
      assertRejectsWith(() => companies.update(999, {}), NotFoundError, /^Company not found$/);
      assertRejectsWith(() => companies.remove(999), NotFoundError);
      assertRejectsWith(() => companies.get(999), NotFoundError);
    });

    it('keeps the stored date when an edit leaves a "defaults to today" date empty', () => {
      const company = companies.create({ ...COMPANY, DateAdded: '2020-05-05' });
      const updated = companies.update(company.CompanyID, { ...COMPANY, UpdatedAt: company.UpdatedAt });
      assert.equal(updated.DateAdded, '2020-05-05');
    });

    it('overwrite replaces a record in place without the version check', () => {
      const company = companies.create(COMPANY);
      const overwritten = companies.overwrite(company.CompanyID, { ...COMPANY, Industry: 'Ports' });
      assert.equal(overwritten.CompanyID, company.CompanyID);
      assert.equal(overwritten.Industry, 'Ports');
      assert.equal(count('Company'), 1);
    });
  });

  describe('transactions', () => {
    function failOnClassLevel(value) {
      db.exec(`
        CREATE TEMP TRIGGER fail_on_class_level BEFORE INSERT ON Recruitment_ClassLevel
        WHEN NEW.ClassLevel = '${value}'
        BEGIN SELECT RAISE(ABORT, 'simulated failure while writing children'); END;
      `);
    }

    it('leaves no parent row behind when writing a child row fails on create', () => {
      const refs = createCompanyAndContact();
      failOnClassLevel('explode');
      assert.throws(
        () =>
          recruitment.create(
            postingFor(refs, { OpportunityTypes: ['Internship'], ClassLevels: ['Junior', 'explode'] })
          ),
        /simulated failure/
      );
      assert.equal(count('Recruitment'), 0);
      assert.equal(count('Recruitment_OpportunityType'), 0);
      assert.equal(count('Recruitment_ClassLevel'), 0);
    });

    it('rolls back the parent and every child table when an update fails part-way', () => {
      const refs = createCompanyAndContact();
      const created = recruitment.create(postingFor(refs, { OpportunityTypes: ['Internship'], ClassLevels: ['Junior'] }));
      failOnClassLevel('explode');
      assert.throws(() =>
        recruitment.update(created.RecruitmentID, {
          ...postingFor(refs, { OpportunityTitle: 'Changed', OpportunityTypes: ['Full-time'], ClassLevels: ['explode'] }),
          UpdatedAt: created.UpdatedAt,
        })
      );
      const reread = recruitment.get(created.RecruitmentID);
      assert.equal(reread.OpportunityTitle, 'Analyst');
      assert.deepEqual(reread.OpportunityTypes, ['Internship']);
      assert.deepEqual(reread.ClassLevels, ['Junior']);
    });

    it('collaboration opportunities are written in the same transaction', () => {
      const { company } = createCompanyAndContact();
      const collaboration = records.get('collaboration').service;
      db.exec(`
        CREATE TEMP TRIGGER fail_on_opportunity BEFORE INSERT ON PotentialCollaboration_Opportunities
        BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
      `);
      assert.throws(() => collaboration.create({ CompanyID: company.CompanyID, Opportunities: ['Mentorship Programs'] }));
      assert.equal(count('PotentialCollaboration'), 0);
    });
  });

  describe('blacklist rule', () => {
    it('blacklisting an employer makes all its contacts Non-mailable', () => {
      const { company, contact } = createCompanyAndContact();
      companies.update(company.CompanyID, { ...COMPANY, Blacklisted: true, UpdatedAt: company.UpdatedAt });
      assert.equal(contacts.get(contact.ContactID).Status, 'Non-mailable');
    });

    it('a contact created for a blacklisted employer is Non-mailable whatever the request says', () => {
      const company = companies.create({ ...COMPANY, Blacklisted: true });
      const contact = contacts.create({
        CompanyID: company.CompanyID,
        FirstName: 'New',
        LastName: 'Person',
        EmailAddress: 'new@example.qa',
        Status: 'Mailable',
      });
      assert.equal(contact.Status, 'Non-mailable');
    });

    it('editing a contact of a blacklisted employer cannot make it Mailable again', () => {
      const { company, contact } = createCompanyAndContact();
      companies.update(company.CompanyID, { ...COMPANY, Blacklisted: 1, UpdatedAt: company.UpdatedAt });
      const stored = contacts.get(contact.ContactID);
      const edited = contacts.update(contact.ContactID, {
        CompanyID: company.CompanyID,
        FirstName: 'Mona',
        LastName: 'Rashid',
        EmailAddress: 'mona@example.qa',
        Status: 'Mailable',
        UpdatedAt: stored.UpdatedAt,
      });
      assert.equal(edited.Status, 'Non-mailable');
    });

    it('moving a contact to a blacklisted employer makes it Non-mailable', () => {
      const { contact } = createCompanyAndContact();
      const blacklisted = companies.create({ ...COMPANY, CompanyName: 'Banned Co', Blacklisted: true });
      const moved = contacts.update(contact.ContactID, {
        CompanyID: blacklisted.CompanyID,
        FirstName: 'Mona',
        LastName: 'Rashid',
        EmailAddress: 'mona@example.qa',
        Status: 'Mailable',
        UpdatedAt: contact.UpdatedAt,
      });
      assert.equal(moved.Status, 'Non-mailable');
    });

    it('a contact of an employer in good standing keeps the requested status', () => {
      const company = companies.create(COMPANY);
      const contact = contacts.create({
        CompanyID: company.CompanyID,
        FirstName: 'Fine',
        LastName: 'Person',
        EmailAddress: 'fine@example.qa',
        Status: 'Non-mailable',
      });
      assert.equal(contact.Status, 'Non-mailable');
      const mailable = contacts.update(contact.ContactID, {
        CompanyID: company.CompanyID,
        FirstName: 'Fine',
        LastName: 'Person',
        EmailAddress: 'fine@example.qa',
        Status: 'Mailable',
        UpdatedAt: contact.UpdatedAt,
      });
      assert.equal(mailable.Status, 'Mailable');
    });
  });

  describe('remove', () => {
    it('describes what was deleted for companies and contacts', () => {
      const { company, contact } = createCompanyAndContact();
      assert.deepEqual(contacts.remove(contact.ContactID), { message: 'Contact deleted', name: 'Mona Rashid' });
      assert.deepEqual(companies.remove(company.CompanyID), {
        message: 'Company deleted',
        deleted: { contacts: 0, outreach: 0, recruitment: 0, events: 0 },
      });
      const collaboration = records.get('collaboration').service;
      const other = companies.create(COMPANY);
      const created = collaboration.create({ CompanyID: other.CompanyID });
      assert.deepEqual(collaboration.remove(created.PotentialCollaborationID), { message: 'Deleted' });
    });
  });
});
