'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, loginAs, post, put, del } = require('../helpers/app');
const { webLoginAs, postForm, csrfFrom, assertNoInlineCode } = require('../helpers/web');
const { RECORD_TYPES, createRefs, createRecord } = require('../helpers/records');

const ROLES = ['admin', 'staff', 'readonly', 'student_worker'];
const RECORD_TABLES = RECORD_TYPES.map((type) => type.table);
const CHILD_TABLES = [
  'Recruitment_OpportunityType',
  'Recruitment_CollectApplications',
  'Recruitment_TargetMajors',
  'Recruitment_ClassLevel',
  'PotentialCollaboration_Opportunities',
];
const typeOf = (path) => RECORD_TYPES.find((type) => type.path === path);

describe('the Trash', () => {
  let ctx;
  const api = {};
  const web = {};

  before(async () => {
    ctx = await buildApp();
    for (const role of ROLES) {
      api[role] = await loginAs(ctx, role);
      web[role] = await webLoginAs(ctx, role);
    }
  });

  after(() => ctx.close());

  const rowCount = (table) => ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const counts = () => Object.fromEntries([...RECORD_TABLES, ...CHILD_TABLES].map((table) => [table, rowCount(table)]));
  const stored = (type, id) => ctx.db.prepare(`SELECT * FROM ${type.table} WHERE ${type.idField} = ?`).get(id);
  const userId = (username) => ctx.db.prepare('SELECT UserID FROM Users WHERE Username = ?').get(username).UserID;

  /** An employer with a contact and one record of every other type. */
  async function employerWithEverything(suffix) {
    const refs = await createRefs(api.admin, ` ${suffix}`);
    const records = {};
    for (const type of RECORD_TYPES) {
      if (type.path === 'companies' || type.path === 'contacts') continue;
      records[type.path] = (await createRecord(api.admin, type, refs))[type.idField];
    }
    return { ...refs, records };
  }

  /** How many records of each type the API lists for an employer, and what its profile counts. */
  async function visibleFor(companyId) {
    const result = {};
    for (const type of RECORD_TYPES) {
      if (type.path === 'companies') continue;
      const rows = (await api.admin.get(`/api/${type.path}`)).body;
      result[type.path] = rows.filter((row) => row.CompanyID === companyId).length;
    }
    result.related = (await api.admin.get(`/api/companies/${companyId}/related-counts`)).body;
    result.stats = (await api.admin.get('/api/dashboard/stats')).body;
    return result;
  }

  describe('deleting', () => {
    it('sets DeletedAt and DeletedBy on every record type and removes nothing', async () => {
      const refs = await createRefs(api.staff, ' Columns');
      for (const type of RECORD_TYPES) {
        const created = await createRecord(api.staff, type, refs);
        const id = created[type.idField];
        const before = counts();
        const res = await del(api.staff, `/api/${type.path}/${id}`);
        assert.equal(res.status, 200, type.path);
        assert.deepEqual(counts(), before, `${type.path}: no row removed`);
        const row = stored(type, id);
        assert.match(row.DeletedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, type.path);
        assert.ok(Math.abs(Date.parse(`${row.DeletedAt}Z`) - Date.now()) < 60000, `${type.path}: DeletedAt is UTC now`);
        assert.equal(row.DeletedBy, userId('staff-user'), type.path);
        assert.equal((await api.staff.get(`/api/${type.path}/${id}`)).status, 404, type.path);
      }
    });

    it('keeps the API response of a delete as it was', async () => {
      const refs = await createRefs(api.admin, ' Shape');
      const company = await del(api.admin, `/api/companies/${refs.companyId}`);
      assert.deepEqual(company.body, {
        message: 'Company deleted',
        deleted: { contacts: 1, outreach: 0, recruitment: 0, events: 0 },
      });
      const other = await createRefs(api.admin, ' Shape2');
      const contact = await del(api.admin, `/api/contacts/${other.contactId}`);
      assert.deepEqual(contact.body, { message: 'Contact deleted', name: 'Reference Contact Shape2' });
    });

    it('hides an employer’s contacts and activity with it, and restore brings back exactly the same', async () => {
      const { companyId, contactId, records } = await employerWithEverything('Hidden');
      const before = await visibleFor(companyId);
      const flagsBefore = counts();
      assert.equal((await del(api.admin, `/api/companies/${companyId}`)).status, 200);

      for (const [path, id] of Object.entries({ contacts: contactId, ...records })) {
        assert.equal((await api.admin.get(`/api/${path}/${id}`)).status, 404, path);
        assert.equal(stored(typeOf(path), id).DeletedAt, null, `${path} is not flagged`);
      }
      const during = await visibleFor(companyId);
      for (const type of RECORD_TYPES.filter((candidate) => candidate.path !== 'companies')) {
        assert.equal(during[type.path], 0, type.path);
      }
      assert.equal(during.stats.totalContacts, before.stats.totalContacts - 1);
      assert.equal((await api.admin.get(`/api/companies/${companyId}/related-counts`)).status, 404);
      assert.deepEqual(counts(), flagsBefore);

      const restored = await post(api.admin, `/api/companies/${companyId}/restore`);
      assert.equal(restored.status, 200);
      assert.equal(restored.body.CompanyID, companyId);
      assert.deepEqual(await visibleFor(companyId), before);
    });

    it('keeps the activity of a deleted contact, naming the contact "(deleted)"', async () => {
      const { contactId, records } = await employerWithEverything('Gone Contact');
      assert.equal((await del(api.admin, `/api/contacts/${contactId}`)).status, 200);
      const outreach = await api.admin.get(`/api/outreach/${records.outreach}`);
      assert.equal(outreach.status, 200);
      assert.equal(outreach.body.ContactName, 'Reference Contact Gone Contact (deleted)');
      const page = await web.admin.get(`/interactions/${records.outreach}`);
      assert.match(page.text, /Reference Contact Gone Contact \(deleted\)/);
      const contacts = (await api.admin.get('/api/contacts')).body;
      assert.ok(!contacts.some((row) => row.ContactID === contactId));
      const search = await web.admin.get('/search?q=Gone%20Contact');
      assert.doesNotMatch(search.text, new RegExp(`/contacts/${contactId}"`));
    });

    it('refuses a new record for an employer or a contact in the Trash', async () => {
      const refs = await createRefs(api.admin, ' Refused');
      assert.equal((await del(api.admin, `/api/contacts/${refs.contactId}`)).status, 200);
      const outreach = typeOf('outreach');
      const contactRefused = await post(api.admin, '/api/outreach', outreach.payload(refs));
      assert.equal(contactRefused.status, 400);
      assert.equal(contactRefused.body.error, 'That contact is in the Trash. Restore it first.');

      assert.equal((await del(api.admin, `/api/companies/${refs.companyId}`)).status, 200);
      for (const path of ['contacts', 'outreach', 'collaboration']) {
        const res = await post(api.admin, `/api/${path}`, typeOf(path).payload(refs));
        assert.equal(res.status, 400, path);
        assert.equal(res.body.error, 'That employer is in the Trash. Restore it first.', path);
      }
    });

    it('confirms with what moves to the Trash and what is hidden with an employer', async () => {
      const { companyId, records } = await employerWithEverything('Confirm');
      const profile = await web.staff.get(`/employers/${companyId}`);
      assert.match(
        profile.text,
        /data-confirm-text="Reference Company Confirm moves to the Trash\. You can restore it from there\. Its 1 contact and 7 activities are hidden with it until then\."/
      );
      const posting = await web.staff.get(`/postings/${records.recruitment}`);
      assert.match(
        posting.text,
        /data-confirm-text="Data Analyst Intern moves to the Trash\. You can restore it from there\."/
      );
    });
  });

  describe('Undo', () => {
    it('restores the record and returns to its page', async () => {
      const refs = await createRefs(api.staff, ' Undo');
      const res = await postForm(web.staff, `/contacts/${refs.contactId}/delete`);
      assert.equal(res.status, 303);
      assert.equal(res.headers.location, '/contacts');
      const list = await web.staff.get('/contacts');
      assert.match(list.text, /Reference Contact Undo moved to the Trash\./);
      const undoUrl = `/trash/contacts/${refs.contactId}/restore`;
      assert.match(list.text, new RegExp(`<form action="${undoUrl}" method="post">`));
      assert.match(list.text, />Undo</);
      assertNoInlineCode(list.text, '/contacts');

      const undo = await web.staff
        .post(undoUrl)
        .type('form')
        .send({ _csrf: csrfFrom(list.text) });
      assert.equal(undo.status, 303);
      assert.equal(undo.headers.location, `/contacts/${refs.contactId}`);
      const page = await web.staff.get(undo.headers.location);
      assert.equal(page.status, 200);
      assert.match(page.text, /Reference Contact Undo restored\./);
      assert.equal(stored(typeOf('contacts'), refs.contactId).DeletedAt, null);
    });

    it('returns an employer to its profile', async () => {
      const refs = await createRefs(api.staff, ' Undo Employer');
      await postForm(web.staff, `/employers/${refs.companyId}/delete`);
      const undo = await postForm(web.staff, `/trash/companies/${refs.companyId}/restore`);
      assert.equal(undo.headers.location, `/employers/${refs.companyId}`);
      assert.equal((await web.staff.get(`/contacts/${refs.contactId}`)).status, 200);
    });

    it('rejects Undo without the CSRF token', async () => {
      const refs = await createRefs(api.staff, ' Undo Csrf');
      await del(api.staff, `/api/contacts/${refs.contactId}`);
      const res = await web.staff.post(`/trash/contacts/${refs.contactId}/restore`).type('form').send({});
      assert.equal(res.status, 403);
      assert.ok(stored(typeOf('contacts'), refs.contactId).DeletedAt);
    });
  });

  describe('restoring', () => {
    it('is allowed to administrators and staff, and refused to read-only and student workers', async () => {
      const refs = await createRefs(api.admin, ' Restore Roles');
      for (const role of ROLES) {
        const created = await createRecord(api.admin, typeOf('outreach'), refs);
        const id = created.OutreachEngagementID;
        await del(api.admin, `/api/outreach/${id}`);
        const apiRes = await post(api[role], `/api/outreach/${id}/restore`);
        const allowed = role === 'admin' || role === 'staff';
        assert.equal(apiRes.status, allowed ? 200 : 403, `API ${role}`);
        if (allowed) continue;
        const webRes = await postForm(web[role], `/trash/outreach/${id}/restore`);
        assert.equal(webRes.status, 403, `web ${role}`);
        assert.ok(stored(typeOf('outreach'), id).DeletedAt, `${role} did not restore`);
      }
    });

    it('refuses a contact or an activity whose employer is in the Trash', async () => {
      const { companyId, contactId, records } = await employerWithEverything('Parent First');
      await del(api.admin, `/api/contacts/${contactId}`);
      await del(api.admin, `/api/outreach/${records.outreach}`);
      await del(api.admin, `/api/companies/${companyId}`);
      for (const [path, id] of [
        ['contacts', contactId],
        ['outreach', records.outreach],
        ['recruitment', records.recruitment],
      ]) {
        const res = await post(api.admin, `/api/${path}/${id}/restore`);
        assert.equal(res.status, 400, path);
        assert.equal(res.body.error, 'Restore the employer first.', path);
      }
      const webRes = await postForm(web.admin, `/trash/contacts/${contactId}/restore`, { returnTo: '/trash' });
      assert.equal(webRes.headers.location, '/trash');
      assert.match((await web.admin.get('/trash')).text, /Restore the employer first\./);

      // The employer comes back alone: what was deleted on its own stays in the Trash.
      assert.equal((await post(api.admin, `/api/companies/${companyId}/restore`)).status, 200);
      assert.equal((await api.admin.get(`/api/contacts/${contactId}`)).status, 404);
      assert.equal((await api.admin.get(`/api/outreach/${records.outreach}`)).status, 404);
      assert.equal((await api.admin.get(`/api/recruitment/${records.recruitment}`)).status, 200);
      assert.equal((await post(api.admin, `/api/contacts/${contactId}/restore`)).status, 200);
    });

    it('refuses a record that is not in the Trash, and 404s one that does not exist', async () => {
      const refs = await createRefs(api.admin, ' Live Restore');
      assert.equal((await post(api.admin, `/api/contacts/${refs.contactId}/restore`)).status, 400);
      assert.equal((await post(api.admin, '/api/contacts/999999/restore')).status, 404);
    });
  });

  describe('purging', () => {
    it('is for administrators only, and only for a record in the Trash', async () => {
      const refs = await createRefs(api.admin, ' Purge');
      const posting = await createRecord(api.admin, typeOf('recruitment'), refs);
      const id = posting.RecruitmentID;
      const children = () => rowCount(`Recruitment_TargetMajors WHERE RecruitmentID = ${id}`);
      assert.ok(children() > 0);

      const live = await postForm(web.admin, `/trash/recruitment/${id}/purge`);
      assert.equal(live.status, 303);
      assert.ok(stored(typeOf('recruitment'), id), 'a live record is not purged');
      assert.match((await web.admin.get('/trash')).text, /Only a record in the Trash can be deleted permanently/);

      await del(api.admin, `/api/recruitment/${id}`);
      for (const role of ['staff', 'readonly', 'student_worker']) {
        assert.equal((await postForm(web[role], `/trash/recruitment/${id}/purge`)).status, 403, role);
      }
      assert.ok(stored(typeOf('recruitment'), id));

      const res = await postForm(web.admin, `/trash/recruitment/${id}/purge`, { returnTo: '/trash' });
      assert.equal(res.status, 303);
      assert.equal(res.headers.location, '/trash');
      assert.match((await web.admin.get('/trash')).text, /Data Analyst Intern deleted permanently\./);
      assert.equal(stored(typeOf('recruitment'), id), undefined);
      assert.equal(children(), 0, 'child rows cascade');
    });

    it('purging an employer removes everything under it', async () => {
      const { companyId, contactId, records } = await employerWithEverything('Purge All');
      await del(api.admin, `/api/companies/${companyId}`);
      await postForm(web.admin, `/trash/companies/${companyId}/purge`);
      assert.equal(stored(typeOf('companies'), companyId), undefined);
      assert.equal(stored(typeOf('contacts'), contactId), undefined);
      for (const [path, id] of Object.entries(records)) assert.equal(stored(typeOf(path), id), undefined, path);
    });
  });

  describe('/trash', () => {
    it('is refused to read-only and student workers, and not in their sidebar', async () => {
      for (const role of ['readonly', 'student_worker']) {
        assert.equal((await web[role].get('/trash')).status, 403, role);
        assert.doesNotMatch((await web[role].get('/dashboard')).text, /href="\/trash"/, role);
      }
      for (const role of ['admin', 'staff']) {
        assert.match((await web[role].get('/dashboard')).text, /<a class="nav__link" href="\/trash"/, role);
      }
    });

    it('lists deleted records newest first with who and when, and the employer with what it hides', async () => {
      const { companyId } = await employerWithEverything('Listed');
      const other = await createRefs(api.staff, ' Listed Other');
      await del(api.staff, `/api/contacts/${other.contactId}`);
      ctx.db.prepare("UPDATE Contact SET DeletedAt = '2000-01-01 00:00:00' WHERE ContactID = ?").run(other.contactId);
      await del(api.admin, `/api/companies/${companyId}`);

      const page = await web.staff.get('/trash');
      assert.equal(page.status, 200);
      assertNoInlineCode(page.text, '/trash');
      const employerRow = page.text.indexOf('Reference Company Listed</span>');
      const contactRow = page.text.indexOf('Reference Contact Listed Other</span>');
      assert.ok(employerRow > -1 && contactRow > -1);
      assert.match(page.text, /with 1 contact and 7 activities/);
      assert.match(page.text, /<span dir="auto">admin-user<\/span>/);
      assert.match(page.text, new RegExp(`action="/trash/companies/${companyId}/restore"`));
      assert.doesNotMatch(page.text, />Reference Contact Listed</, 'hidden by its employer, not listed');
      assert.doesNotMatch(page.text, /\/purge"/, 'staff cannot purge');
      assert.match(page.text, /<a class="nav__link" href="\/trash" aria-current="page">/);

      const admin = await web.admin.get('/trash');
      assert.match(admin.text, new RegExp(`action="/trash/companies/${companyId}/purge"`));
      assert.match(admin.text, /data-confirm-title="Delete Reference Company Listed permanently\?"/);
      assert.match(admin.text, /This cannot be undone\./);

      const filtered = await web.staff.get('/trash?type=contacts');
      assert.match(filtered.text, /Reference Contact Listed Other/);
      assert.doesNotMatch(filtered.text, /Reference Company Listed</);
    });

    it('pages 25 at a time and says when it is empty', async () => {
      const empty = await buildApp();
      try {
        const admin = await loginAs(empty, 'admin');
        const browser = await webLoginAs(empty, 'admin');
        assert.match((await browser.get('/trash')).text, /The Trash is empty\./);
        const refs = await createRefs(admin, ' Paged');
        for (let index = 0; index < 27; index++) {
          const created = await createRecord(admin, typeOf('career-events'), refs);
          await del(admin, `/api/career-events/${created.CareerEventID}`);
        }
        const first = await browser.get('/trash');
        assert.match(first.text, /1–25 of 27 deleted records/);
        assert.match(first.text, /href="\/trash\?page=2"/);
        const second = await browser.get('/trash?page=2');
        assert.match(second.text, /26–27 of 27 deleted records/);
        assert.match((await browser.get('/dashboard')).text, /aria-label="27 in the Trash">27</);
        assert.match((await browser.get('/trash?type=contacts')).text, /Nothing of this type is in the Trash/);
      } finally {
        empty.close();
      }
    });

    it('404s an unknown type or id', async () => {
      assert.equal((await postForm(web.admin, '/trash/widgets/1/restore')).status, 404);
      assert.equal((await postForm(web.admin, '/trash/contacts/abc/purge')).status, 404);
    });
  });

  describe('who changed a record', () => {
    it('records CreatedBy on create and UpdatedBy on every update, and shows the editor', async () => {
      const created = await post(api.staff, '/api/companies', typeOf('companies').payload());
      const id = created.body.CompanyID;
      let row = stored(typeOf('companies'), id);
      assert.equal(row.CreatedBy, userId('staff-user'));
      assert.equal(row.UpdatedBy, null);
      assert.match((await web.admin.get(`/employers/${id}`)).text, /· Last edited \d/);

      const updated = await put(api.admin, `/api/companies/${id}`, { ...created.body, Industry: 'Consulting' });
      assert.equal(updated.status, 200);
      row = stored(typeOf('companies'), id);
      assert.equal(row.CreatedBy, userId('staff-user'));
      assert.equal(row.UpdatedBy, userId('admin-user'));
      assert.match(
        (await web.staff.get(`/employers/${id}`)).text,
        /Last edited by <span dir="auto">admin-user<\/span> on/
      );

      const refs = await createRefs(api.staff, ' Edited');
      const outreach = await createRecord(api.staff, typeOf('outreach'), refs);
      await put(api.staff, `/api/outreach/${outreach.OutreachEngagementID}`, {
        ...outreach,
        DiscussionItems: 'Changed',
      });
      assert.equal(stored(typeOf('outreach'), outreach.OutreachEngagementID).UpdatedBy, userId('staff-user'));
      assert.match(
        (await web.admin.get(`/interactions/${outreach.OutreachEngagementID}`)).text,
        /Last edited by <span dir="auto">staff-user<\/span> on/
      );
    });
  });

  describe('import', () => {
    it('does not treat a record in the Trash as a duplicate, nor match its name', async () => {
      const refs = await createRefs(api.admin, ' Import');
      const validate = (entity, rows, mapping) => post(api.admin, '/api/import/validate', { entity, rows, mapping });
      const companyRow = [
        { Name: 'Reference Company Import', Industry: 'Energy', Sector: 'Private', Country: 'Qatar' },
      ];
      const companyMapping = { Name: 'CompanyName', Industry: 'Industry', Sector: 'Sector', Country: 'Country' };
      const before = await validate('Company', companyRow, companyMapping);
      assert.equal(before.status, 200, JSON.stringify(before.body));
      assert.equal(before.body[0].status, 'duplicate', JSON.stringify(before.body[0]));

      await del(api.admin, `/api/companies/${refs.companyId}`);
      const after = await validate('Company', companyRow, companyMapping);
      assert.equal(after.body[0].status, 'valid');

      const contactRow = [{ Employer: 'Reference Company Import', First: 'A', Last: 'B', Email: 'a.b@example.com' }];
      const contactMapping = { Employer: 'CompanyID', First: 'FirstName', Last: 'LastName', Email: 'EmailAddress' };
      const contact = await validate('Contact', contactRow, contactMapping);
      const result = contact.body[0];
      assert.equal(result.status, 'error');
      assert.match(result.errors.join(' '), /Company "Reference Company Import" not found/);
    });
  });
});
