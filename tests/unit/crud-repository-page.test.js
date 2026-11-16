'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { migrate } = require('../../src/db/migrate');
const { createCrudRepository } = require('../../src/db/repositories/crud-repository');
const { recordTypeByPath } = require('../../src/domain/record-types');
const { createSilentLogger } = require('../helpers/app');

const COMPANY = { Industry: 'Logistics', Sector: 'Private', SignedMoU: 0, FavoriteEmployer: 0, Blacklisted: 0 };

describe('crud-repository: paged lists', () => {
  const admin = { role: 'admin', isActive: true };
  const studentWorker = { role: 'student_worker', isActive: true };
  const TODAY = '2026-06-30';
  let db;
  let companies;
  let contacts;

  before(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    await migrate(db, { logger: createSilentLogger() });
    companies = createCrudRepository(db, recordTypeByPath('companies'));
    contacts = createCrudRepository(db, recordTypeByPath('contacts'));
    const outreach = createCrudRepository(db, recordTypeByPath('outreach'));
    ['beta', 'Alpha', 'gamma', 'Delta', 'epsilon'].forEach((name, index) => {
      const id = companies.insert({
        ...COMPANY,
        CompanyName: name,
        Country: index === 0 ? 'Kuwait' : 'Qatar',
        DateAdded: '2025-01-01',
        FavoriteEmployer: index === 1 ? 1 : 0,
        Blacklisted: index === 4 ? 1 : 0,
      });
      const contactId = contacts.insert({
        CompanyID: id,
        FirstName: `First${index}`,
        LastName: `Last${index}`,
        DateAdded: '2025-01-02',
        EmailAddress: `person${index}@secret.example`,
        Status: 'Mailable',
      });
      if (index < 2) {
        outreach.insert({
          CompanyID: id,
          ContactID: contactId,
          InteractionType: 'Call',
          InteractionDate: index === 0 ? '2026-06-01' : '2027-01-01',
          DiscussionItems: 'Talk',
          InteractionStatus: 'Complete',
        });
      }
    });
  });

  after(() => db.close());

  const names = (result) => result.rows.map((row) => row.CompanyName);
  const options = { user: admin, today: TODAY };

  it('pages with limit and offset, and counts every match', () => {
    assert.deepEqual(names(companies.page({}, { ...options, limit: 2, offset: 0 })), ['Alpha', 'beta']);
    assert.deepEqual(names(companies.page({}, { ...options, limit: 2, offset: 2 })), ['Delta', 'epsilon']);
    assert.equal(companies.count({}, options), 5);
  });

  it('sorts text without regard to case, in either direction', () => {
    const result = companies.page({}, { ...options, sort: 'name', dir: 'desc' });
    assert.deepEqual(names(result), ['gamma', 'epsilon', 'Delta', 'beta', 'Alpha']);
    assert.equal(result.sort, 'name');
    assert.equal(result.dir, 'desc');
  });

  it('uses only whitelisted sort keys and falls back to the default sort', () => {
    for (const sort of ['CompanyName', 'c.CompanyName; DROP TABLE Company', 'constructor', '__proto__', undefined]) {
      const result = companies.page({}, { ...options, sort, dir: 'desc' });
      assert.equal(result.sort, 'name', String(sort));
      assert.equal(result.dir, 'asc', String(sort));
      assert.equal(names(result)[0], 'Alpha');
    }
    assert.equal(companies.count({}, options), 5);
  });

  it('computes the last contact up to today and sorts by it', () => {
    const result = companies.page({}, { ...options, sort: 'lastContact', dir: 'desc' });
    assert.equal(result.rows[0].CompanyName, 'beta');
    assert.equal(result.rows[0].lastContactAt, '2026-06-01');
    const alpha = result.rows.find((row) => row.CompanyName === 'Alpha');
    assert.equal(alpha.lastContactAt, null, 'a future interaction is not a contact yet');
    assert.equal(alpha.contactCount, 1);
  });

  it('filters with search, equality and declared choices only', () => {
    assert.deepEqual(names(companies.page({ q: 'ALP' }, options)), ['Alpha']);
    assert.deepEqual(names(companies.page({ sector: 'Private', region: 'gcc' }, options)), ['beta']);
    assert.deepEqual(names(companies.page({ status: 'key-partner' }, options)), ['Alpha']);
    assert.deepEqual(names(companies.page({ status: 'do-not-engage' }, options)), ['epsilon']);
    assert.deepEqual(names(companies.page({ status: 'dormant' }, options)), ['Alpha', 'Delta', 'gamma']);
    assert.equal(companies.count({ status: 'no-such-choice' }, options), 5);
    assert.equal(companies.count({ status: 'toString' }, options), 5);
  });

  it('never matches withheld columns for a user without sensitive:read', () => {
    assert.equal(contacts.count({ q: 'secret.example' }, { user: admin }), 5);
    assert.equal(contacts.count({ q: 'secret.example' }, { user: studentWorker }), 0);
    assert.equal(contacts.count({ q: 'First1' }, { user: studentWorker }), 1);
  });

  it('keeps the JSON API list unchanged', () => {
    assert.equal(companies.list({ search: 'qatar' }).length, 4);
    assert.equal(companies.list({}).length, 5);
  });
});
