'use strict';

/**
 * Sensitive fields in the record services.
 *
 * Under the real permission matrix the only role without SENSITIVE_READ (the
 * student worker) cannot create or change any record type that has sensitive
 * fields, so the write protection is unreachable through the API today. These
 * tests build the services with a permission module that lets every role
 * reach every record type, keeping the real SENSITIVE_READ rule, to prove the
 * protection holds should the matrix ever change.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { openDatabase } = require('../../src/db/connection');
const { migrate } = require('../../src/db/migrate');
const permissions = require('../../src/security/permissions');
const { RECORD_TYPES } = require('../../src/domain/record-types');
const { createCrudRepository } = require('../../src/db/repositories/crud-repository');
const { createRecordService } = require('../../src/services/record-service');
const { ValidationError } = require('../../src/lib/errors');
const { createSilentLogger } = require('../helpers/app');
const { RECORD_TYPES: TEST_TYPES } = require('../helpers/records');

const ADMIN = { user: { id: 1, role: 'admin', isActive: true }, requestId: 'r1', ip: '127.0.0.1' };
const WORKER = { user: { id: 2, role: 'student_worker', isActive: true }, requestId: 'r2', ip: '127.0.0.1' };

/** The real module, except that every record type and action is open to every role. */
const OPEN_RECORDS = {
  ...permissions,
  canAccessRecord: (user) => permissions.can(user, permissions.PERMISSIONS.RECORD_READ),
};

/** A change to a non-sensitive field, per record type. */
const SAFE_CHANGES = {
  companies: { field: 'Industry', value: 'Consulting' },
  contacts: { field: 'FirstName', value: 'Leila' },
  'student-events': { field: 'OrganizationName', value: 'Women in Tech' },
  academic: { field: 'TopicTheme', value: 'Careers in analytics' },
  'hiring-feedback': { field: 'FeedbackProvider', value: 'Other' },
};

/** Values for every sensitive field, recognisable in any output. */
const SECRETS = {
  companies: { Comment: 'SECRET internal comment' },
  contacts: {
    EmailAddress: 'secret.person@example.com',
    WorkPhone: '+974 4000 0001',
    Mobile: '+974 5000 0001',
    Address: 'SECRET street 1',
    LinkedInURL: 'https://www.linkedin.com/in/secret-person',
    HandshakeURL: 'https://app.joinhandshake.com/secret-person',
  },
  'student-events': {
    StudentName: 'SECRET Student',
    StudentEmail: 'secret.student@example.edu',
    StudentPhoneNumber: '+974 6000 0001',
  },
  academic: { Email: 'secret.guest@example.com', PhoneNumber: '+974 7000 0001' },
  'hiring-feedback': { HiredStudentName: 'SECRET Hire', Comment: 'SECRET feedback' },
};

const containsSecret = (value, path) =>
  Object.values(SECRETS[path]).some((secret) => JSON.stringify(value).includes(secret));

describe('Sensitive fields in the record services', () => {
  let db;
  const services = new Map();
  let refs;

  before(async () => {
    db = openDatabase(':memory:');
    await migrate(db, { logger: createSilentLogger() });
    const repositories = new Map(
      RECORD_TYPES.map((definition) => [definition.path, createCrudRepository(db, definition)])
    );
    const lookups = {
      findCompany: (id) => repositories.get('companies').getStoredById(id),
      findContact: (id) => repositories.get('contacts').getStoredById(id),
    };
    for (const definition of RECORD_TYPES) {
      services.set(
        definition.path,
        createRecordService({
          db,
          repository: repositories.get(definition.path),
          definition,
          schema: require(`../../src/validation/${definition.path}`),
          lookups,
          timeZone: 'Asia/Qatar',
          permissions: OPEN_RECORDS,
        })
      );
    }
    const company = services.get('companies').create({ ...TEST_TYPES[0].payload(), CompanyName: 'Refs Co' }, ADMIN);
    const contact = services.get('contacts').create(TEST_TYPES[1].payload({ companyId: company.CompanyID }), ADMIN);
    refs = { companyId: company.CompanyID, contactId: contact.ContactID };
  });

  after(() => db.close());

  for (const path of Object.keys(SECRETS)) {
    const testType = TEST_TYPES.find((type) => type.path === path);
    const fields = permissions.sensitiveFieldsFor(path);

    describe(path, () => {
      const service = () => services.get(path);
      const idOf = (record) => record[testType.idField];
      const createWithSecrets = () => service().create({ ...testType.payload(refs), ...SECRETS[path] }, ADMIN);
      const stored = (id) => service().get(id, ADMIN);

      it('lists the fields being tested', () => {
        assert.deepEqual(Object.keys(SECRETS[path]).sort(), [...fields].sort());
      });

      it('an administrator sees the values', () => {
        const record = createWithSecrets();
        for (const [field, value] of Object.entries(SECRETS[path])) assert.equal(stored(idOf(record))[field], value);
      });

      it('a role without SENSITIVE_READ never receives them in a list or a single record', () => {
        const record = createWithSecrets();
        const rows = service().list({}, WORKER);
        assert.ok(rows.length > 0);
        assert.ok(!containsSecret(rows, path));
        const one = service().get(idOf(record), WORKER);
        assert.ok(!containsSecret(one, path));
        for (const field of fields) assert.equal(one[field], null, field);
        assert.deepEqual(one._withheld, fields);
      });

      it('cannot overwrite them on update, and the update response withholds them', () => {
        const record = createWithSecrets();
        const attempt = Object.fromEntries(fields.map((field) => [field, `${SECRETS[path][field]}-changed`]));
        const updated = service().update(
          idOf(record),
          {
            ...testType.payload(refs),
            ...attempt,
            [SAFE_CHANGES[path].field]: SAFE_CHANGES[path].value,
            UpdatedAt: record.UpdatedAt,
          },
          WORKER
        );
        assert.equal(updated[SAFE_CHANGES[path].field], SAFE_CHANGES[path].value, 'the other change was saved');
        assert.ok(!JSON.stringify(updated).includes('-changed'));
        assert.ok(!containsSecret(updated, path));
        for (const [field, value] of Object.entries(SECRETS[path])) assert.equal(stored(idOf(record))[field], value);
      });

      it('cannot clear them on update either', () => {
        const record = createWithSecrets();
        const cleared = Object.fromEntries(fields.map((field) => [field, null]));
        service().update(
          idOf(record),
          { ...testType.payload(refs), ...SECRETS[path], ...cleared, UpdatedAt: record.UpdatedAt },
          WORKER
        );
        for (const [field, value] of Object.entries(SECRETS[path])) assert.equal(stored(idOf(record))[field], value);
      });

      it('on create they are stored as null (or the record is refused when one is required)', () => {
        const before = service().list({}, ADMIN).length;
        let created;
        try {
          created = service().create({ ...testType.payload(refs), ...SECRETS[path] }, WORKER);
        } catch (err) {
          assert.ok(err instanceof ValidationError, err.message);
          assert.equal(service().list({}, ADMIN).length, before, 'nothing was stored');
          return;
        }
        assert.ok(!containsSecret(created, path));
        const row = stored(idOf(created));
        for (const field of fields) assert.equal(row[field], null, field);
      });
    });
  }

  it('contacts and student-led events require a sensitive field, so such a role cannot create them', () => {
    for (const path of ['contacts', 'student-events']) {
      const testType = TEST_TYPES.find((type) => type.path === path);
      assert.throws(() => services.get(path).create(testType.payload(refs), WORKER), ValidationError, path);
    }
  });
});

describe('Joined columns in the list queries', () => {
  it('expose no sensitive value under another name (anything joined is declared or known safe)', async () => {
    const db = openDatabase(':memory:');
    await migrate(db, { logger: createSilentLogger() });
    try {
      const SAFE_JOINED = new Set(['CompanyName', 'ContactName']);
      for (const definition of RECORD_TYPES) {
        const { list, table } = definition;
        const own = new Set(
          db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((column) => column.name)
        );
        const output = db
          .prepare(`SELECT ${list.select} FROM ${table} ${list.alias} ${list.joins.join(' ')} LIMIT 0`)
          .columns()
          .map((column) => column.name);
        const declared = new Set(list.withheldColumns ?? []);
        for (const column of output) {
          if (own.has(column)) continue;
          assert.ok(
            SAFE_JOINED.has(column) || declared.has(column),
            `${definition.path}: joined column ${column} must be declared in list.withheldColumns or known safe`
          );
        }
      }
    } finally {
      db.close();
    }
  });
});
