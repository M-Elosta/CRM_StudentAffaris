'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, loginAs, post, put, del, setStoredUpdatedAt, STALE_TIMESTAMP } = require('../helpers/app');
const { RECORD_TYPES, an, createRefs, createRecord } = require('../helpers/records');

for (const type of RECORD_TYPES) {
  describe(`CRUD: ${type.name} (/api/${type.path})`, () => {
    let ctx;
    let admin;
    let refs;
    const base = `/api/${type.path}`;

    before(async () => {
      ctx = await buildApp();
      admin = await loginAs(ctx, 'admin');
      refs = await createRefs(admin);
    });

    after(() => ctx.close());

    function updateBody(record, overrides = {}) {
      return {
        ...type.payload(refs),
        [type.change.field]: type.change.value,
        UpdatedAt: record.UpdatedAt,
        ...overrides,
      };
    }

    it(`creates ${an(type.name)} and returns it with its id and UpdatedAt`, async () => {
      const payload = type.payload(refs);
      const res = await post(admin, base, payload);
      assert.equal(res.status, 201);
      assert.ok(Number.isInteger(res.body[type.idField]) && res.body[type.idField] > 0);
      assert.match(res.body.UpdatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      for (const [key, value] of Object.entries(payload)) {
        assert.deepEqual(res.body[key], value, `field ${key}`);
      }
    });

    it(`lists ${type.path} as an array that includes a new ${type.name}`, async () => {
      const record = await createRecord(admin, type, refs);
      const res = await admin.get(base);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.some((row) => row[type.idField] === record[type.idField]));
    });

    it(`reads ${an(type.name)} by id`, async () => {
      const record = await createRecord(admin, type, refs);
      const res = await admin.get(`${base}/${record[type.idField]}`);
      assert.equal(res.status, 200);
      assert.equal(res.body[type.idField], record[type.idField]);
      assert.equal(res.body.UpdatedAt, record.UpdatedAt);
    });

    it(`returns 404 when reading ${an(type.name)} that does not exist`, async () => {
      const res = await admin.get(`${base}/999999`);
      assert.equal(res.status, 404);
    });

    it(`updates ${an(type.name)} when UpdatedAt matches the stored value`, async () => {
      const record = await createRecord(admin, type, refs);
      const res = await put(admin, `${base}/${record[type.idField]}`, updateBody(record));
      assert.equal(res.status, 200);
      assert.equal(res.body[type.change.field], type.change.value);

      const reread = await admin.get(`${base}/${record[type.idField]}`);
      assert.equal(reread.body[type.change.field], type.change.value);
    });

    it(`rejects a stale update of ${an(type.name)} with 409 and asks the user to reload`, async () => {
      const record = await createRecord(admin, type, refs);
      const res = await put(
        admin,
        `${base}/${record[type.idField]}`,
        updateBody(record, { UpdatedAt: STALE_TIMESTAMP })
      );
      assert.equal(res.status, 409);
      assert.match(res.body.error, /reload/i);

      const reread = await admin.get(`${base}/${record[type.idField]}`);
      assert.notEqual(reread.body[type.change.field], type.change.value, 'stale update must not be applied');
    });

    it(`rejects an update of ${an(type.name)} that someone else saved after it was loaded`, async () => {
      const record = await createRecord(admin, type, refs);
      // UpdatedAt has one-second resolution: simulate the other save directly.
      setStoredUpdatedAt(ctx.db, type.table, type.idField, record[type.idField], '2099-01-01 00:00:00');
      const stored = ctx.db
        .prepare(`SELECT UpdatedAt FROM ${type.table} WHERE ${type.idField} = ?`)
        .get(record[type.idField]).UpdatedAt;
      assert.notEqual(stored, record.UpdatedAt);

      const res = await put(admin, `${base}/${record[type.idField]}`, updateBody(record));
      assert.equal(res.status, 409);
    });

    it(`rejects an update of ${an(type.name)} without UpdatedAt with 400`, async () => {
      const record = await createRecord(admin, type, refs);
      const body = updateBody(record);
      delete body.UpdatedAt;
      const res = await put(admin, `${base}/${record[type.idField]}`, body);
      assert.equal(res.status, 400);
    });

    it(`returns 404 when updating ${an(type.name)} that does not exist`, async () => {
      const record = await createRecord(admin, type, refs);
      const res = await put(admin, `${base}/999999`, updateBody(record));
      assert.equal(res.status, 404);
    });

    it(`deletes ${an(type.name)}, after which reading it returns 404`, async () => {
      const record = await createRecord(admin, type, refs);
      const res = await del(admin, `${base}/${record[type.idField]}`);
      assert.equal(res.status, 200);

      const reread = await admin.get(`${base}/${record[type.idField]}`);
      assert.equal(reread.status, 404);
      const list = await admin.get(base);
      assert.ok(!list.body.some((row) => row[type.idField] === record[type.idField]));
    });

    it(`returns 404 when deleting ${an(type.name)} that does not exist`, async () => {
      const res = await del(admin, `${base}/999999`);
      assert.equal(res.status, 404);
    });

    it(`rejects a non-numeric ${type.name} id with 400 on read, update and delete`, async () => {
      assert.equal((await admin.get(`${base}/abc`)).status, 400);
      assert.equal((await put(admin, `${base}/abc`, type.payload(refs))).status, 400);
      assert.equal((await del(admin, `${base}/abc`)).status, 400);
      assert.equal((await admin.get(`${base}/-1`)).status, 400);
      assert.equal((await admin.get(`${base}/1.5`)).status, 400);
    });

    it(`rejects creating ${an(type.name)} without ${type.requiredField} with 400`, async () => {
      const payload = type.payload(refs);
      delete payload[type.requiredField];
      const res = await post(admin, base, payload);
      assert.equal(res.status, 400);
      assert.equal(typeof res.body.error, 'string');
    });

    it(`rejects creating ${an(type.name)} whose ${type.requiredField} is blank with 400`, async () => {
      const res = await post(admin, base, { ...type.payload(refs), [type.requiredField]: '   ' });
      assert.equal(res.status, 400);
    });

    if (type.enumField) {
      const { field, invalid } = type.enumField;
      it(`rejects creating ${an(type.name)} with an invalid ${field} with 400`, async () => {
        const res = await post(admin, base, { ...type.payload(refs), [field]: invalid });
        assert.equal(res.status, 400);
        assert.equal(typeof res.body.error, 'string');
      });

      it(`rejects updating ${an(type.name)} to an invalid ${field} with 400`, async () => {
        const record = await createRecord(admin, type, refs);
        const res = await put(admin, `${base}/${record[type.idField]}`, updateBody(record, { [field]: invalid }));
        assert.equal(res.status, 400);
      });
    }

    if (type.path !== 'companies') {
      it(`rejects creating ${an(type.name)} for a company that does not exist with a 4xx error`, async () => {
        const res = await post(admin, base, { ...type.payload(refs), CompanyID: 999999 });
        assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
      });
    }
  });
}
