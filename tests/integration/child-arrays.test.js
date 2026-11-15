'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, loginAs, post, put, del } = require('../helpers/app');
const { RECORD_TYPES, createRefs } = require('../helpers/records');

const recruitmentType = RECORD_TYPES.find((type) => type.path === 'recruitment');
const collaborationType = RECORD_TYPES.find((type) => type.path === 'collaboration');

const RECRUITMENT_CHILD_TABLES = [
  { table: 'Recruitment_OpportunityType', field: 'OpportunityTypes' },
  { table: 'Recruitment_TargetMajors', field: 'TargetMajors' },
  { table: 'Recruitment_ClassLevel', field: 'ClassLevels' },
  { table: 'Recruitment_CollectApplications', field: 'CollectApplications' },
];

const sorted = (values) => [...values].sort();

describe('Recruitment child arrays', () => {
  let ctx;
  let admin;
  let refs;

  before(async () => {
    ctx = await buildApp();
    admin = await loginAs(ctx, 'admin');
    refs = await createRefs(admin);
  });

  after(() => ctx.close());

  const childCount = (table, id) =>
    ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE RecruitmentID = ?`).get(id).n;

  const arrays = {
    OpportunityTypes: ['Internship', 'Full-time'],
    TargetMajors: ['CS', 'Information Systems', 'Business Administration'],
    ClassLevels: ['Junior', 'Senior'],
    CollectApplications: ['Handshake', 'Email'],
  };

  async function create() {
    const res = await post(admin, '/api/recruitment', { ...recruitmentType.payload(refs), ...arrays });
    assert.equal(res.status, 201);
    return res.body;
  }

  it('returns all four arrays from create', async () => {
    const created = await create();
    for (const [field, values] of Object.entries(arrays)) {
      assert.deepEqual(sorted(created[field]), sorted(values), field);
    }
  });

  it('returns all four arrays from read by id and from the list', async () => {
    const created = await create();
    const one = await admin.get(`/api/recruitment/${created.RecruitmentID}`);
    const listed = (await admin.get('/api/recruitment')).body.find(
      (row) => row.RecruitmentID === created.RecruitmentID
    );
    for (const [field, values] of Object.entries(arrays)) {
      assert.deepEqual(sorted(one.body[field]), sorted(values), `read ${field}`);
      assert.deepEqual(sorted(listed[field]), sorted(values), `list ${field}`);
    }
  });

  it('stores each array value as one child row', async () => {
    const created = await create();
    for (const { table, field } of RECRUITMENT_CHILD_TABLES) {
      assert.equal(childCount(table, created.RecruitmentID), arrays[field].length, table);
    }
  });

  it('replaces the arrays on update instead of appending', async () => {
    const created = await create();
    const replacement = {
      OpportunityTypes: ['Part-time'],
      TargetMajors: ['Biological Sciences'],
      ClassLevels: [],
      CollectApplications: ['Company website', 'Handshake', 'Career fair'],
    };
    const res = await put(admin, `/api/recruitment/${created.RecruitmentID}`, {
      ...recruitmentType.payload(refs),
      ...replacement,
      UpdatedAt: created.UpdatedAt,
    });
    assert.equal(res.status, 200);
    for (const [field, values] of Object.entries(replacement)) {
      assert.deepEqual(sorted(res.body[field]), sorted(values), field);
    }
    const reread = await admin.get(`/api/recruitment/${created.RecruitmentID}`);
    for (const [field, values] of Object.entries(replacement)) {
      assert.deepEqual(sorted(reread.body[field]), sorted(values), `reread ${field}`);
    }
    for (const { table, field } of RECRUITMENT_CHILD_TABLES) {
      assert.equal(childCount(table, created.RecruitmentID), replacement[field].length, table);
    }
  });

  it('clears an array when it is omitted from the update', async () => {
    const created = await create();
    const body = { ...recruitmentType.payload(refs), UpdatedAt: created.UpdatedAt };
    delete body.TargetMajors;
    const res = await put(admin, `/api/recruitment/${created.RecruitmentID}`, body);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.TargetMajors, []);
  });

  it('removes the child rows when the posting is deleted', async () => {
    const created = await create();
    assert.equal((await del(admin, `/api/recruitment/${created.RecruitmentID}`)).status, 200);
    assert.equal((await admin.get(`/api/recruitment/${created.RecruitmentID}`)).status, 404);
    for (const { table } of RECRUITMENT_CHILD_TABLES) {
      assert.equal(childCount(table, created.RecruitmentID), 0, table);
    }
  });

  it('rejects an array field that is not an array with 400', async () => {
    const res = await post(admin, '/api/recruitment', { ...recruitmentType.payload(refs), TargetMajors: 'CS' });
    assert.equal(res.status, 400);
  });

  it('rejects an array containing a blank value with 400', async () => {
    const res = await post(admin, '/api/recruitment', {
      ...recruitmentType.payload(refs),
      ClassLevels: ['Junior', ' '],
    });
    assert.equal(res.status, 400);
  });

  it('does not leave a half-saved posting behind when an array is invalid', async () => {
    const before = ctx.db.prepare('SELECT COUNT(*) AS n FROM Recruitment').get().n;
    await post(admin, '/api/recruitment', { ...recruitmentType.payload(refs), TargetMajors: [42] });
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM Recruitment').get().n, before);
  });
});

describe('Potential collaboration opportunities', () => {
  let ctx;
  let admin;
  let refs;

  before(async () => {
    ctx = await buildApp();
    admin = await loginAs(ctx, 'admin');
    refs = await createRefs(admin);
  });

  after(() => ctx.close());

  const opportunityCount = (id) =>
    ctx.db
      .prepare('SELECT COUNT(*) AS n FROM PotentialCollaboration_Opportunities WHERE PotentialCollaborationID = ?')
      .get(id).n;

  async function create(opportunities = ['Guest Lecture', 'Mentorship Programs']) {
    const res = await post(admin, '/api/collaboration', {
      ...collaborationType.payload(refs),
      Opportunities: opportunities,
    });
    assert.equal(res.status, 201);
    return res.body;
  }

  it('returns the opportunities from create, read and list', async () => {
    const created = await create();
    assert.deepEqual(sorted(created.Opportunities), ['Guest Lecture', 'Mentorship Programs']);
    const one = await admin.get(`/api/collaboration/${created.PotentialCollaborationID}`);
    assert.deepEqual(sorted(one.body.Opportunities), ['Guest Lecture', 'Mentorship Programs']);
    const listed = (await admin.get('/api/collaboration')).body.find(
      (row) => row.PotentialCollaborationID === created.PotentialCollaborationID
    );
    assert.deepEqual(sorted(listed.Opportunities), ['Guest Lecture', 'Mentorship Programs']);
    assert.equal(opportunityCount(created.PotentialCollaborationID), 2);
  });

  it('replaces the opportunities on update', async () => {
    const created = await create();
    const res = await put(admin, `/api/collaboration/${created.PotentialCollaborationID}`, {
      ...collaborationType.payload(refs),
      Opportunities: ['MoU Signing'],
      UpdatedAt: created.UpdatedAt,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.Opportunities, ['MoU Signing']);
    const reread = await admin.get(`/api/collaboration/${created.PotentialCollaborationID}`);
    assert.deepEqual(reread.body.Opportunities, ['MoU Signing']);
    assert.equal(opportunityCount(created.PotentialCollaborationID), 1);
  });

  it('removes the opportunities when the record is deleted', async () => {
    const created = await create();
    assert.equal((await del(admin, `/api/collaboration/${created.PotentialCollaborationID}`)).status, 200);
    assert.equal((await admin.get(`/api/collaboration/${created.PotentialCollaborationID}`)).status, 404);
    assert.equal(opportunityCount(created.PotentialCollaborationID), 0);
  });

  it('accepts a record with no opportunities', async () => {
    const created = await create([]);
    assert.deepEqual(created.Opportunities, []);
  });
});
