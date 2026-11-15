'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { migrate } = require('../../src/db/migrate');
const { createCrudRepository } = require('../../src/db/repositories/crud-repository');
const { createCompaniesRepository } = require('../../src/db/repositories/companies-repository');
const { recordTypeByPath } = require('../../src/domain/record-types');
const { createSilentLogger } = require('../helpers/app');

/** A migrated in-memory database that records every SQL statement it runs. */
async function openRecordingDatabase() {
  const executed = [];
  const db = new Database(':memory:', { verbose: (sql) => executed.push(sql) });
  db.pragma('foreign_keys = ON');
  await migrate(db, { logger: createSilentLogger() });
  executed.length = 0;
  return { db, executed };
}

const COMPANY = {
  CompanyName: 'Gulf Logistics',
  DateAdded: '2025-03-01',
  Industry: 'Logistics',
  Sector: 'Private',
  Country: 'Qatar',
  SignedMoU: 0,
  FavoriteEmployer: 1,
  Blacklisted: 0,
};

describe('crud-repository', () => {
  let db;
  let executed;
  let companies;
  let contacts;
  let recruitment;
  let companyId;
  let contactId;

  before(async () => {
    ({ db, executed } = await openRecordingDatabase());
    companies = createCrudRepository(db, recordTypeByPath('companies'));
    contacts = createCrudRepository(db, recordTypeByPath('contacts'));
    recruitment = createCrudRepository(db, recordTypeByPath('recruitment'));
    companyId = companies.insert(COMPANY);
    contactId = contacts.insert({
      CompanyID: companyId,
      FirstName: 'Huda',
      LastName: 'Saleh',
      DateAdded: '2025-03-02',
      EmailAddress: 'huda@example.qa',
      Status: 'Mailable',
    });
  });

  after(() => db.close());

  function posting(title, datePosted) {
    return {
      CompanyID: companyId,
      ContactID: contactId,
      DatePosted: datePosted,
      OpportunityTitle: title,
      Mode: 'Remote',
      Status: 'Unpaid',
      TargetGroup: 'Open to all',
      HiredStudentAlumni: 'Not Reported',
    };
  }

  it('inserts a record and reads it back as stored and in the list shape', () => {
    const stored = companies.getStoredById(companyId);
    assert.equal(stored.CompanyName, 'Gulf Logistics');
    assert.equal(stored.Address, null, 'missing columns are stored as NULL');
    assert.match(stored.UpdatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const contact = contacts.getById(contactId);
    assert.equal(contact.CompanyName, 'Gulf Logistics', 'list shape includes the joined employer name');
    assert.equal(contacts.getStoredById(contactId).CompanyName, undefined, 'stored shape has table columns only');
  });

  it('returns undefined for a record that does not exist', () => {
    assert.equal(companies.getById(999), undefined);
    assert.equal(companies.getStoredById(999), undefined);
    assert.equal(companies.getUpdatedAt(999), undefined);
  });

  it('updates every writable column and reports the number of changed rows', () => {
    const id = companies.insert({ ...COMPANY, CompanyName: 'Before' });
    assert.equal(companies.update(id, { ...COMPANY, CompanyName: 'After', Comment: 'note' }), 1);
    const row = companies.getStoredById(id);
    assert.equal(row.CompanyName, 'After');
    assert.equal(row.Comment, 'note');
    assert.equal(companies.update(999, COMPANY), 0);
  });

  it('applies list filters with bound parameters and the default order', () => {
    companies.insert({ ...COMPANY, CompanyName: 'Alpha Search', Country: 'Oman' });
    const names = companies.list({ search: 'Search' }).map((row) => row.CompanyName);
    assert.deepEqual(names, ['Alpha Search']);
    assert.deepEqual(companies.list({ search: "'; DROP TABLE Company; --" }), [], 'search text is a value, never SQL');
    const all = companies.list().map((row) => row.CompanyName);
    assert.deepEqual(all, [...all].sort());
    assert.equal(contacts.list({ companyId, status: 'Non-mailable' }).length, 0);
    assert.equal(contacts.list({ companyId, status: 'Mailable' }).length, 1);
  });

  it('applies from/to date filters', () => {
    recruitment.insert(posting('Old posting', '2023-01-15'));
    recruitment.insert(posting('New posting', '2025-06-15'));
    const titles = recruitment.list({ from: '2025-01-01', to: '2025-12-31' }).map((row) => row.OpportunityTitle);
    assert.deepEqual(titles, ['New posting']);
  });

  it('replaces child arrays and returns them on every read', () => {
    const id = recruitment.insert(posting('With children', '2025-02-01'));
    recruitment.replaceChildren(id, { OpportunityTypes: ['Internship', 'Co-op'], TargetMajors: ['CS'] });
    let row = recruitment.getById(id);
    assert.deepEqual(row.OpportunityTypes, ['Internship', 'Co-op']);
    assert.deepEqual(row.TargetMajors, ['CS']);
    assert.deepEqual(row.ClassLevels, []);
    assert.deepEqual(row.CollectApplications, []);

    recruitment.replaceChildren(id, { OpportunityTypes: ['Full-time'], TargetMajors: [] });
    row = recruitment.getStoredById(id);
    assert.deepEqual(row.OpportunityTypes, ['Full-time']);
    assert.deepEqual(row.TargetMajors, []);
  });

  it('loads the children of a whole list with one query per child table', () => {
    for (let index = 0; index < 5; index++) {
      const id = recruitment.insert(posting(`Bulk ${index}`, '2025-04-01'));
      recruitment.replaceChildren(id, {
        OpportunityTypes: [`Type ${index}`],
        CollectApplications: ['Handshake'],
        TargetMajors: ['CS', 'IS'],
        ClassLevels: ['Senior'],
      });
    }
    executed.length = 0;
    const rows = recruitment.list();
    assert.ok(rows.length >= 5);

    const childTables = recordTypeByPath('recruitment').children.map((child) => child.table);
    for (const table of childTables) {
      const queries = executed.filter((sql) => new RegExp(`FROM ${table}\\b`).test(sql));
      assert.equal(queries.length, 1, `${table} was queried ${queries.length} times`);
    }
    assert.equal(executed.length, 1 + childTables.length, 'one list query plus one per child table');

    const bulk = rows.find((row) => row.OpportunityTitle === 'Bulk 3');
    assert.deepEqual(bulk.OpportunityTypes, ['Type 3']);
    assert.deepEqual(bulk.TargetMajors, ['CS', 'IS']);
  });

  it('deletes a record together with its child rows', () => {
    const id = recruitment.insert(posting('To delete', '2025-02-01'));
    recruitment.replaceChildren(id, { ClassLevels: ['Junior'] });
    assert.equal(recruitment.remove(id), 1);
    assert.equal(recruitment.getById(id), undefined);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Recruitment_ClassLevel WHERE RecruitmentID = ?').get(id).n, 0);
    assert.equal(recruitment.remove(id), 0);
  });
});

describe('companies-repository', () => {
  let db;

  before(async () => {
    ({ db } = await openRecordingDatabase());
  });

  after(() => db.close());

  it('counts related records and marks contacts non-mailable', () => {
    const companies = createCrudRepository(db, recordTypeByPath('companies'));
    const contacts = createCrudRepository(db, recordTypeByPath('contacts'));
    const repository = createCompaniesRepository(db);
    const companyId = companies.insert(COMPANY);
    contacts.insert({
      CompanyID: companyId,
      FirstName: 'A',
      LastName: 'B',
      DateAdded: '2025-01-01',
      EmailAddress: 'a@b.qa',
      Status: 'Mailable',
    });

    assert.deepEqual(repository.countRelatedRecords(companyId), {
      contacts: 1,
      outreach: 0,
      recruitment: 0,
      events: 0,
      academic: 0,
      studentEvents: 0,
    });
    assert.equal(repository.markContactsNonMailable(companyId), 1);
    assert.equal(contacts.list({ companyId })[0].Status, 'Non-mailable');
  });
});
