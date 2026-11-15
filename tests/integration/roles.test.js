'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, loginAs, createUser, post, put, patch, del } = require('../helpers/app');
const { RECORD_TYPES, an, createRefs, createRecord } = require('../helpers/records');

describe('Role enforcement on record types', () => {
  let ctx;
  let admin;
  let viewer;
  let refs;

  before(async () => {
    ctx = await buildApp();
    admin = await loginAs(ctx, 'admin');
    viewer = await loginAs(ctx, 'viewer');
    refs = await createRefs(admin);
  });

  after(() => ctx.close());

  for (const type of RECORD_TYPES) {
    const base = `/api/${type.path}`;

    describe(`${type.path}`, () => {
      it(`viewer can list ${type.path}`, async () => {
        const record = await createRecord(admin, type, refs);
        const res = await viewer.get(base);
        assert.equal(res.status, 200);
        assert.ok(res.body.some((row) => row[type.idField] === record[type.idField]));
      });

      it(`viewer can read ${an(type.name)} by id`, async () => {
        const record = await createRecord(admin, type, refs);
        const res = await viewer.get(`${base}/${record[type.idField]}`);
        assert.equal(res.status, 200);
        assert.equal(res.body[type.idField], record[type.idField]);
      });

      it(`viewer cannot create ${an(type.name)}`, async () => {
        const before = ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${type.table}`).get().n;
        const res = await post(viewer, base, type.payload(refs));
        assert.equal(res.status, 403);
        assert.equal(ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${type.table}`).get().n, before);
      });

      it(`viewer cannot update ${an(type.name)}`, async () => {
        const record = await createRecord(admin, type, refs);
        const res = await put(viewer, `${base}/${record[type.idField]}`, {
          ...type.payload(refs),
          [type.change.field]: type.change.value,
          UpdatedAt: record.UpdatedAt,
        });
        assert.equal(res.status, 403);
        const reread = await admin.get(`${base}/${record[type.idField]}`);
        assert.notEqual(reread.body[type.change.field], type.change.value);
      });

      it(`viewer cannot delete ${an(type.name)}`, async () => {
        const record = await createRecord(admin, type, refs);
        const res = await del(viewer, `${base}/${record[type.idField]}`);
        assert.equal(res.status, 403);
        assert.equal((await admin.get(`${base}/${record[type.idField]}`)).status, 200);
      });

      it(`admin can create, read, update and delete ${an(type.name)}`, async () => {
        const created = await post(admin, base, type.payload(refs));
        assert.equal(created.status, 201);
        const id = created.body[type.idField];

        assert.equal((await admin.get(base)).status, 200);
        assert.equal((await admin.get(`${base}/${id}`)).status, 200);

        const updated = await put(admin, `${base}/${id}`, {
          ...type.payload(refs),
          [type.change.field]: type.change.value,
          UpdatedAt: created.body.UpdatedAt,
        });
        assert.equal(updated.status, 200);

        assert.equal((await del(admin, `${base}/${id}`)).status, 200);
      });
    });
  }
});

describe('Role enforcement on import and user management', () => {
  let ctx;
  let admin;
  let viewer;

  before(async () => {
    ctx = await buildApp();
    admin = await loginAs(ctx, 'admin');
    viewer = await loginAs(ctx, 'viewer');
  });

  after(() => ctx.close());

  const companyRow = { CompanyName: 'Viewer Import Co', Industry: 'Tech', Sector: 'Private', Country: 'Qatar' };
  const identityMapping = { CompanyName: 'CompanyName', Industry: 'Industry', Sector: 'Sector', Country: 'Country' };

  it('viewer cannot validate an import', async () => {
    const res = await post(viewer, '/api/import/validate', {
      entity: 'Company',
      rows: [companyRow],
      mapping: identityMapping,
    });
    assert.equal(res.status, 403);
  });

  it('viewer cannot confirm an import', async () => {
    const res = await post(viewer, '/api/import/confirm', {
      entity: 'Company',
      rows: [{ row: companyRow, action: 'import' }],
    });
    assert.equal(res.status, 403);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM Company').get().n, 0);
  });

  it('viewer cannot upload a file for import parsing', async () => {
    const res = await viewer
      .post('/api/import/parse')
      .set('Origin', 'http://crm.test')
      .attach('file', Buffer.from('not really a workbook'), 'data.xlsx');
    assert.equal(res.status, 403);
  });

  it('viewer cannot list users', async () => {
    assert.equal((await viewer.get('/api/users')).status, 403);
  });

  it('viewer cannot create a user', async () => {
    const res = await post(viewer, '/api/users', {
      username: 'sneaky',
      password: 'a-long-enough-password',
      role: 'admin',
    });
    assert.equal(res.status, 403);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM Users WHERE Username = 'sneaky'").get().n, 0);
  });

  it('viewer cannot change a user role, including their own', async () => {
    const other = createUser(ctx.db, { username: 'other-viewer', role: 'viewer' });
    assert.equal((await patch(viewer, `/api/users/${other.id}/role`, { role: 'admin' })).status, 403);
    const self = ctx.db.prepare("SELECT UserID FROM Users WHERE Username = 'viewer-user'").get();
    assert.equal((await patch(viewer, `/api/users/${self.UserID}/role`, { role: 'admin' })).status, 403);
    assert.equal(ctx.db.prepare('SELECT Role FROM Users WHERE UserID = ?').get(self.UserID).Role, 'viewer');
  });

  it('viewer cannot delete a user', async () => {
    const target = createUser(ctx.db, { username: 'delete-target', role: 'viewer' });
    assert.equal((await del(viewer, `/api/users/${target.id}`)).status, 403);
    assert.ok(ctx.db.prepare('SELECT 1 FROM Users WHERE UserID = ?').get(target.id));
  });

  it('admin can list users', async () => {
    const res = await admin.get('/api/users');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });
});
