'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, loginAs, post, put } = require('../helpers/app');
const { RECORD_TYPES, createRefs } = require('../helpers/records');
const { PERMISSIONS: P, can, canAccessRecord, sensitiveFieldsFor } = require('../../src/security/permissions');

/** Values for every sensitive field, recognisable in any response. */
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

const leaks = (body, path) => Object.values(SECRETS[path]).some((secret) => JSON.stringify(body).includes(secret));

describe('Sensitive fields through the API', () => {
  let ctx;
  let admin;
  let worker;
  let readonly;
  let refs;
  const records = {};

  before(async () => {
    ctx = await buildApp();
    admin = await loginAs(ctx, 'admin');
    worker = await loginAs(ctx, 'student_worker');
    readonly = await loginAs(ctx, 'readonly');
    refs = await createRefs(admin);
    for (const path of Object.keys(SECRETS)) {
      const type = RECORD_TYPES.find((entry) => entry.path === path);
      const res = await post(admin, `/api/${path}`, { ...type.payload(refs), ...SECRETS[path] });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      records[path] = { type, record: res.body };
    }
  });

  after(() => ctx.close());

  it('covers every record type that has sensitive fields', () => {
    const withFields = RECORD_TYPES.map((type) => type.path).filter((path) => sensitiveFieldsFor(path).length);
    assert.deepEqual(withFields.sort(), Object.keys(SECRETS).sort());
  });

  it('the student worker is the role without SENSITIVE_READ', () => {
    assert.equal(can('student_worker', P.SENSITIVE_READ), false);
    assert.equal(can('readonly', P.SENSITIVE_READ), true);
  });

  for (const path of Object.keys(SECRETS)) {
    describe(path, () => {
      const readable = canAccessRecord('student_worker', P.RECORD_READ, path);
      const base = `/api/${path}`;
      const idOf = () => records[path].record[records[path].type.idField];

      it(`a student worker ${readable ? 'gets the record with the values withheld' : 'cannot read the record at all'}`, async () => {
        const list = await worker.get(base);
        const one = await worker.get(`${base}/${idOf()}`);
        assert.ok(!leaks(list.body, path));
        assert.ok(!leaks(one.body, path));
        if (!readable) {
          assert.equal(list.status, 403);
          assert.equal(one.status, 403);
          return;
        }
        assert.equal(one.status, 200);
        for (const field of sensitiveFieldsFor(path)) assert.equal(one.body[field], null, field);
        assert.deepEqual(one.body._withheld, sensitiveFieldsFor(path));
        const row = list.body.find((entry) => entry[records[path].type.idField] === idOf());
        assert.deepEqual(row._withheld, sensitiveFieldsFor(path));
      });

      it('a student worker cannot create or change the record, so no response carries the values', async () => {
        const { type, record } = records[path];
        const created = await post(worker, base, { ...type.payload(refs), ...SECRETS[path] });
        assert.equal(created.status, 403);
        assert.ok(!leaks(created.body, path));
        const changed = Object.fromEntries(Object.keys(SECRETS[path]).map((field) => [field, 'overwritten']));
        const updated = await put(worker, `${base}/${idOf()}`, {
          ...type.payload(refs),
          ...changed,
          UpdatedAt: record.UpdatedAt,
        });
        assert.equal(updated.status, 403);
        assert.ok(!leaks(updated.body, path));
        const stored = await admin.get(`${base}/${idOf()}`);
        for (const [field, value] of Object.entries(SECRETS[path])) assert.equal(stored.body[field], value, field);
      });

      it('a read-only user sees the values', async () => {
        const res = await readonly.get(`${base}/${idOf()}`);
        assert.equal(res.status, 200);
        for (const [field, value] of Object.entries(SECRETS[path])) assert.equal(res.body[field], value, field);
      });
    });
  }

  describe('searching', () => {
    it('a student worker searching contacts by email address finds nothing', async () => {
      const res = await worker.get('/api/contacts').query({ search: 'secret.person@example.com' });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, []);
      const partial = await worker.get('/api/contacts').query({ search: 'secret.person' });
      assert.deepEqual(partial.body, []);
    });

    it('a student worker can still search contacts by name', async () => {
      const res = await worker.get('/api/contacts').query({ search: 'Haddad' });
      assert.equal(res.status, 200);
      assert.ok(res.body.length >= 1);
      assert.ok(res.body.every((row) => row.EmailAddress === null));
    });

    it('roles that may read sensitive data can search by email address', async () => {
      for (const agent of [admin, readonly]) {
        const res = await agent.get('/api/contacts').query({ search: 'secret.person@example.com' });
        assert.equal(res.body.length, 1);
      }
    });
  });
});
