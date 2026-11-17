'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, loginAs, createUser, post, put, patch, del } = require('../helpers/app');
const { RECORD_TYPES, createRefs, createRecord } = require('../helpers/records');
const {
  ROLES,
  PERMISSIONS: P,
  SENSITIVE_FIELDS,
  canAccessRecord,
  sensitiveFieldsFor,
} = require('../../src/security/permissions');

const ALL_ROLES = Object.values(ROLES);

/**
 * The full matrix: every role against every record type and action. The
 * expected status comes from canAccessRecord(), so this suite cannot drift
 * from the permission module.
 */
describe('Role enforcement on record types (driven by the permission module)', () => {
  let ctx;
  let admin;
  let refs;
  const agents = {};

  before(async () => {
    ctx = await buildApp();
    admin = await loginAs(ctx, 'admin');
    for (const role of ALL_ROLES) agents[role] = await loginAs(ctx, role);
    refs = await createRefs(admin);
  });

  after(() => ctx.close());

  const count = (table) => ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

  for (const role of ALL_ROLES) {
    for (const type of RECORD_TYPES) {
      const base = `/api/${type.path}`;
      const may = (permission) => canAccessRecord({ role, isActive: true }, permission, type.path);

      describe(`${role} on ${type.path}`, () => {
        it(`list: ${may(P.RECORD_READ) ? 200 : 403}`, async () => {
          const record = await createRecord(admin, type, refs);
          const res = await agents[role].get(base);
          assert.equal(res.status, may(P.RECORD_READ) ? 200 : 403);
          if (may(P.RECORD_READ)) assert.ok(res.body.some((row) => row[type.idField] === record[type.idField]));
          else assert.equal(typeof res.body.error, 'string');
        });

        it(`read: ${may(P.RECORD_READ) ? 200 : 403}`, async () => {
          const record = await createRecord(admin, type, refs);
          const res = await agents[role].get(`${base}/${record[type.idField]}`);
          assert.equal(res.status, may(P.RECORD_READ) ? 200 : 403);
          if (may(P.RECORD_READ)) assert.equal(res.body[type.idField], record[type.idField]);
        });

        it(`create: ${may(P.RECORD_CREATE) ? 201 : 403}`, async () => {
          const before = count(type.table);
          const res = await post(agents[role], base, type.payload(refs));
          assert.equal(res.status, may(P.RECORD_CREATE) ? 201 : 403, JSON.stringify(res.body));
          assert.equal(count(type.table), before + (may(P.RECORD_CREATE) ? 1 : 0));
        });

        it(`update: ${may(P.RECORD_UPDATE) ? 200 : 403}`, async () => {
          const record = await createRecord(admin, type, refs);
          const res = await put(agents[role], `${base}/${record[type.idField]}`, {
            ...type.payload(refs),
            [type.change.field]: type.change.value,
            UpdatedAt: record.UpdatedAt,
          });
          assert.equal(res.status, may(P.RECORD_UPDATE) ? 200 : 403, JSON.stringify(res.body));
          const reread = await admin.get(`${base}/${record[type.idField]}`);
          if (may(P.RECORD_UPDATE)) assert.equal(reread.body[type.change.field], type.change.value);
          else assert.notEqual(reread.body[type.change.field], type.change.value);
        });

        it(`delete: ${may(P.RECORD_DELETE) ? 200 : 403}`, async () => {
          const record = await createRecord(admin, type, refs);
          const res = await del(agents[role], `${base}/${record[type.idField]}`);
          assert.equal(res.status, may(P.RECORD_DELETE) ? 200 : 403);
          const reread = await admin.get(`${base}/${record[type.idField]}`);
          assert.equal(reread.status, may(P.RECORD_DELETE) ? 404 : 200);
        });
      });
    }
  }
});

/** Hand-written expectations for the cases that matter most, independent of the module. */
describe('Role enforcement: key cases', () => {
  let ctx;
  let admin;
  let refs;

  before(async () => {
    ctx = await buildApp();
    admin = await loginAs(ctx, 'admin');
    refs = await createRefs(admin);
  });

  after(() => ctx.close());

  const type = (path) => RECORD_TYPES.find((entry) => entry.path === path);

  it('a student worker cannot read hiring feedback, as a list or by id', async () => {
    const worker = await loginAs(ctx, 'student_worker');
    const record = await createRecord(admin, type('hiring-feedback'), refs);
    const list = await worker.get('/api/hiring-feedback');
    assert.equal(list.status, 403);
    assert.equal(
      list.body.error,
      'Your role (Student Worker) cannot view hiring feedback. Ask an administrator if you need this.'
    );
    assert.equal((await worker.get(`/api/hiring-feedback/${record.HiringFeedbackID}`)).status, 403);
  });

  it('a student worker cannot read student-led events', async () => {
    const worker = await loginAs(ctx, 'student_worker');
    assert.equal((await worker.get('/api/student-events')).status, 403);
  });

  it('a student worker gets contacts with EmailAddress null and the withheld fields named', async () => {
    const worker = await loginAs(ctx, 'student_worker');
    const contact = await createRecord(admin, type('contacts'), refs);
    const res = await worker.get(`/api/contacts/${contact.ContactID}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.EmailAddress, null);
    assert.equal(res.body.FirstName, 'Layla');
    assert.deepEqual(res.body._withheld, [
      'EmailAddress',
      'WorkPhone',
      'Mobile',
      'Address',
      'LinkedInURL',
      'HandshakeURL',
    ]);
    const list = await worker.get('/api/contacts');
    for (const row of list.body) {
      assert.equal(row.EmailAddress, null);
      assert.deepEqual(row._withheld, SENSITIVE_FIELDS.contacts);
    }
  });

  it('read-only and staff see contact details in full', async () => {
    const contact = await createRecord(admin, type('contacts'), refs);
    for (const role of ['readonly', 'staff']) {
      const agent = await loginAs(ctx, role);
      const res = await agent.get(`/api/contacts/${contact.ContactID}`);
      assert.equal(res.body.EmailAddress, 'layla.haddad@example.com', role);
      assert.equal(res.body._withheld, undefined, role);
    }
  });

  it('a read-only user cannot create a record, and is told why', async () => {
    const readonly = await loginAs(ctx, 'readonly');
    const res = await post(readonly, '/api/companies', type('companies').payload(refs));
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'Your role (Read-only) cannot add employers. Ask an administrator if you need this.');
  });

  it('a student worker can add an outreach record but cannot delete it', async () => {
    const worker = await loginAs(ctx, 'student_worker');
    const created = await post(worker, '/api/outreach', type('outreach').payload(refs));
    assert.equal(created.status, 201);
    const removed = await del(worker, `/api/outreach/${created.body.OutreachEngagementID}`);
    assert.equal(removed.status, 403);
  });

  it('a student worker cannot add an employer or a contact', async () => {
    const worker = await loginAs(ctx, 'student_worker');
    assert.equal((await post(worker, '/api/companies', type('companies').payload(refs))).status, 403);
    assert.equal((await post(worker, '/api/contacts', type('contacts').payload(refs))).status, 403);
  });

  it('staff can delete records', async () => {
    const staff = await loginAs(ctx, 'staff');
    for (const path of ['companies', 'contacts', 'hiring-feedback']) {
      const record = await createRecord(admin, type(path), { ...(await createRefs(admin, ` ${path}`)) });
      const res = await del(staff, `/api/${path}/${record[type(path).idField]}`);
      assert.equal(res.status, 200, path);
    }
  });

  it('student workers may read related counts of an employer but not counts of student events', async () => {
    const worker = await loginAs(ctx, 'student_worker');
    await createRecord(admin, type('student-events'), refs);
    const res = await worker.get(`/api/companies/${refs.companyId}/related-counts`);
    assert.equal(res.status, 200);
    assert.equal(res.body.studentEvents, 0);
    assert.ok(res.body.contacts >= 1);
    const staffView = await (await loginAs(ctx, 'staff')).get(`/api/companies/${refs.companyId}/related-counts`);
    assert.ok(staffView.body.studentEvents >= 1);
  });

  it('every record type with sensitive fields is covered by the permission module', () => {
    for (const { path } of RECORD_TYPES) assert.ok(Array.isArray(sensitiveFieldsFor(path)), path);
  });
});

describe('Role enforcement on import and user management', () => {
  let ctx;
  let admin;
  const agents = {};

  before(async () => {
    ctx = await buildApp();
    admin = await loginAs(ctx, 'admin');
    for (const role of ['staff', 'readonly', 'student_worker']) agents[role] = await loginAs(ctx, role);
  });

  after(() => ctx.close());

  const companyRow = { CompanyName: 'Viewer Import Co', Industry: 'Tech', Sector: 'Private', Country: 'Qatar' };
  const identityMapping = { CompanyName: 'CompanyName', Industry: 'Industry', Sector: 'Sector', Country: 'Country' };

  for (const role of ['readonly', 'student_worker']) {
    it(`${role} cannot validate an import`, async () => {
      const res = await post(agents[role], '/api/import/validate', {
        entity: 'Company',
        rows: [companyRow],
        mapping: identityMapping,
      });
      assert.equal(res.status, 403);
    });

    it(`${role} cannot confirm an import`, async () => {
      const res = await post(agents[role], '/api/import/confirm', {
        entity: 'Company',
        rows: [{ row: companyRow, action: 'import' }],
      });
      assert.equal(res.status, 403);
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM Company').get().n, 0);
    });

    it(`${role} cannot upload a file for import parsing`, async () => {
      const res = await agents[role]
        .post('/api/import/parse')
        .set('Origin', 'http://crm.test')
        .attach('file', Buffer.from('not really a workbook'), 'data.xlsx');
      assert.equal(res.status, 403);
    });
  }

  it('staff can validate an import', async () => {
    const res = await post(agents.staff, '/api/import/validate', {
      entity: 'Company',
      rows: [companyRow],
      mapping: identityMapping,
    });
    assert.equal(res.status, 200);
  });

  for (const role of ['staff', 'readonly', 'student_worker']) {
    it(`${role} cannot reach any user management endpoint`, async () => {
      const agent = agents[role];
      const target = createUser(ctx.db, { username: `target-of-${role}`, role: 'readonly' });
      const self = ctx.db.prepare('SELECT UserID FROM Users WHERE Username = ?').get(`${role}-user`).UserID;
      assert.equal((await agent.get('/api/users')).status, 403);
      const created = await post(agent, '/api/users', {
        username: `sneaky-${role}`,
        password: 'a-long-enough-password',
        role: 'admin',
      });
      assert.equal(created.status, 403);
      assert.equal((await patch(agent, `/api/users/${target.id}/role`, { role: 'admin' })).status, 403);
      assert.equal((await patch(agent, `/api/users/${self}/role`, { role: 'admin' })).status, 403);
      assert.equal((await del(agent, `/api/users/${target.id}`)).status, 403);
      const roles = ctx.db.prepare('SELECT Role FROM Users WHERE UserID IN (?, ?)').all(target.id, self);
      assert.deepEqual(roles.map((row) => row.Role).sort(), ['readonly', role].sort());
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM Users WHERE Username = ?').get(`sneaky-${role}`).n, 0);
    });
  }

  it('admin can list users', async () => {
    const res = await admin.get('/api/users');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });
});
