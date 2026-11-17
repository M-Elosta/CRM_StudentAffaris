'use strict';

/**
 * Nothing in the Trash leaks. One employer is deleted with a contact and one
 * record of every activity type under it (hidden by their employer, not
 * flagged), and one record of every other type is deleted under a live
 * employer. Every distinctive name is first shown to appear somewhere while
 * the records are live; after the deletions none of them, and no link to
 * any of them, may appear in any list, detail page, report (every type, on
 * screen, as JSON and exported), dashboard, search, export or JSON list.
 * A new screen or query that forgets the Trash makes this test fail.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, loginAs, post, put, del, today, binaryParser } = require('../helpers/app');
const { webLoginAs } = require('../helpers/web');
const { readFirstWorksheet } = require('../../src/lib/excel');
const { QUICK_REPORTS } = require('../../src/services/reports');
const { RECORD_TYPES } = require('../../src/domain/record-types');
const { screenFor } = require('../../src/web/screens');

const DASHBOARD_ENDPOINTS = [
  'stats',
  'companies-by-month',
  'outreach-by-month',
  'companies-by-sector',
  'recruitment-by-major',
  'event-attendance',
  'top-engaged',
  'hiring-trends',
];

/** Distinctive text of a record of each type, from a marker word. */
function bodies(marker, companyId, contactId) {
  return {
    outreach: {
      CompanyID: companyId,
      ContactID: contactId,
      InteractionType: 'Meeting',
      InteractionDate: today(),
      DiscussionItems: `${marker} outreach talk`,
      ActionPlan: `${marker} action plan`,
      FollowUpDate: '2099-01-01',
      InteractionStatus: 'In-progress',
    },
    recruitment: {
      CompanyID: companyId,
      ContactID: contactId,
      DatePosted: today(),
      OpportunityTitle: `${marker} posting`,
      Mode: 'Onsite',
      Status: 'Paid',
      TargetGroup: 'Open to all',
      OpportunityTypes: ['Internship'],
      TargetMajors: ['CS'],
    },
    'career-events': {
      CompanyID: companyId,
      ContactID: contactId,
      EventName: `${marker} fair`,
      EventDate: today(),
      RegisteredStatus: 'Attended',
    },
    collaboration: { CompanyID: companyId, Comment: `${marker} collaboration`, Opportunities: ['Guest Lecture'] },
    academic: {
      CompanyID: companyId,
      ContactID: contactId,
      EngagementType: 'Guest Lecture',
      GuestSpeakerName: `${marker} Speaker`,
      GuestTitle: 'Director',
      FacultyName: `${marker} Faculty`,
      CourseNumber: '15-112',
      CourseTitle: `${marker} course`,
      TopicTheme: `${marker} topic`,
      SessionDate: today(),
      SessionTime: '10:00',
    },
    'student-events': {
      CompanyID: companyId,
      ContactID: contactId,
      ProposalDate: today(),
      OrganizationName: `${marker} club`,
      EventTitle: `${marker} student event`,
      EventDate: today(),
      StudentName: `${marker} Student`,
      StudentEmail: 'student@example.edu',
      StudentPhoneNumber: '+974 5555 0000',
      CollaborationOutcome: 'Pending',
    },
    'hiring-feedback': {
      CompanyID: companyId,
      ContactID: contactId,
      FeedbackProvider: 'Company',
      HiredStudentAlumni: 'Yes',
      DateReported: today(),
      HiredStudentName: `${marker} Hire`,
      Comment: `${marker} hiring comment`,
    },
  };
}

describe('the Trash: nothing leaks', () => {
  let ctx;
  let api;
  let web;
  const deleted = []; // { type, id }
  let liveCompanyId;
  let liveContactId;

  async function create(path, body) {
    const res = await post(api, `/api/${path}`, body);
    assert.equal(res.status, 201, `${path}: ${JSON.stringify(res.body)}`);
    return res.body[RECORD_TYPES.find((definition) => definition.path === path).idColumn];
  }

  async function seed() {
    liveCompanyId = await create('companies', {
      CompanyName: 'Livewell Holdings',
      Industry: 'Energy',
      Sector: 'Private',
      Country: 'Qatar',
    });
    liveContactId = await create('contacts', {
      CompanyID: liveCompanyId,
      FirstName: 'Livia',
      LastName: 'Present',
      EmailAddress: 'livia@example.com',
      Status: 'Mailable',
      PrimaryContact: true,
      CMUQGraduate: true,
      ResumeBook: true,
      EventInvitation: true,
    });

    // The employer that goes to the Trash, with everything under it.
    const doomedId = await create('companies', {
      CompanyName: 'Zqleak Employer',
      Industry: 'Zqleak industry',
      Sector: 'Private',
      Country: 'Zqleakland',
      FavoriteEmployer: true,
      SignedMoU: true,
    });
    const doomedContactId = await create('contacts', {
      CompanyID: doomedId,
      FirstName: 'Zqleak',
      LastName: 'Contactone',
      EmailAddress: 'zqleak.contact@example.com',
      Status: 'Mailable',
      PrimaryContact: true,
      CMUQGraduate: true,
      ResumeBook: true,
      EventInvitation: true,
    });
    for (const [path, body] of Object.entries(bodies('Zqleak', doomedId, doomedContactId))) await create(path, body);
    deleted.push({ type: 'companies', id: doomedId });
    // Hidden with their employer: their links must not appear either.
    const hidden = [{ type: 'contacts', id: doomedContactId }];

    // One deleted record of every other type, under the live employer.
    const goneContactId = await create('contacts', {
      CompanyID: liveCompanyId,
      FirstName: 'Zqgone',
      LastName: 'Contacttwo',
      EmailAddress: 'zqgone.contact@example.com',
      Status: 'Mailable',
      PrimaryContact: true,
      CMUQGraduate: true,
      ResumeBook: true,
      EventInvitation: true,
    });
    deleted.push({ type: 'contacts', id: goneContactId });
    for (const [path, body] of Object.entries(bodies('Zqgone', liveCompanyId, liveContactId))) {
      deleted.push({ type: path, id: await create(path, body) });
    }
    return hidden;
  }

  /** Every page, JSON document and export an administrator can reach, as text. */
  async function everything() {
    const documents = [];
    const html = async (url) => {
      const res = await web.get(url);
      assert.equal(res.status, 200, url);
      documents.push({ url, text: res.text });
    };
    const json = async (url) => {
      const res = await api.get(url);
      assert.equal(res.status, 200, url);
      documents.push({ url, text: JSON.stringify(res.body) });
    };
    const xlsx = async (agent, url) => {
      const res = await agent.get(url).buffer(true).parse(binaryParser);
      assert.equal(res.status, 200, url);
      const { headers, rows } = await readFirstWorksheet(res.body);
      documents.push({ url, text: JSON.stringify({ headers, rows }) });
    };

    for (const url of [
      '/dashboard',
      '/follow-ups',
      '/employers',
      '/employers?q=Zq',
      '/employers?status=dormant',
      '/employers?view=key-partner',
      '/contacts',
      '/contacts?q=Zq',
      '/interactions',
      '/interactions?q=Zq',
      '/postings',
      '/postings?q=Zq',
      '/events',
      '/events?q=Zq',
      '/events?tab=student-led',
      '/events?tab=student-led&q=Zq',
      '/events?tab=academic',
      '/events?tab=academic&q=Zq',
      '/hiring-outcomes',
      '/hiring-outcomes?q=Zq',
      '/collaboration-ideas',
      '/collaboration-ideas?q=Zq',
      '/search?q=Zq',
      '/search/suggest?q=Zq',
      `/employers/${liveCompanyId}`,
      `/employers/${liveCompanyId}?tab=contacts`,
      `/employers/${liveCompanyId}?tab=postings`,
      `/employers/${liveCompanyId}?tab=events`,
      `/employers/${liveCompanyId}?tab=notes`,
      `/contacts/${liveContactId}`,
      `/interactions/new?CompanyID=${liveCompanyId}`,
      `/options/contacts?CompanyID=${liveCompanyId}`,
      '/reports',
    ]) {
      await html(url);
    }
    for (const type of QUICK_REPORTS.keys()) {
      await html(`/reports/${type}?period=all`);
      await xlsx(web, `/reports/${type}?period=all&format=xlsx`);
      await json(`/api/reports/quick/${type}`);
      await xlsx(api, `/api/reports/quick/${type}?export=1`);
    }
    await xlsx(web, '/employers?format=xlsx');
    for (const definition of RECORD_TYPES) await json(`/api/${definition.path}`);
    for (const endpoint of DASHBOARD_ENDPOINTS) await json(`/api/dashboard/${endpoint}`);
    await json(`/api/companies/${liveCompanyId}/related-counts`);
    await json('/api/meta/last-updated');
    return documents;
  }

  const MARKERS = [
    'Zqleak Employer',
    'Zqleak Contactone',
    'Zqgone Contacttwo',
    ...['Zqleak', 'Zqgone'].flatMap((marker) => [
      `${marker} outreach talk`,
      `${marker} posting`,
      `${marker} fair`,
      `${marker} collaboration`,
      `${marker} Speaker`,
      `${marker} club`,
      `${marker} Hire`,
    ]),
  ];

  /** The detail link of a record, as it appears in a page. */
  const linkOf = ({ type, id }) => `href="${screenFor(type).base}/${id}"`;

  let hidden;

  before(async () => {
    ctx = await buildApp();
    api = await loginAs(ctx, 'admin');
    web = await webLoginAs(ctx, 'admin');
    hidden = await seed();
  });

  after(() => ctx.close());

  it('shows every seeded record while it is live (the check below can see them)', async () => {
    const all = (await everything()).map((document) => document.text).join('\n');
    for (const marker of MARKERS) assert.ok(all.includes(marker), `${marker} appears somewhere while live`);
    for (const record of [...deleted, ...hidden]) assert.ok(all.includes(linkOf(record)), linkOf(record));
  });

  it('shows none of them, anywhere, once they are in the Trash', async () => {
    for (const { type, id } of deleted) {
      assert.equal((await del(api, `/api/${type}/${id}`)).status, 200, `${type} ${id}`);
    }
    const documents = await everything();
    for (const { url, text } of documents) {
      assert.doesNotMatch(text, /Zqleak|Zqgone/i, `${url} shows a record that is in the Trash`);
      for (const record of [...deleted, ...hidden]) {
        assert.ok(!text.includes(linkOf(record)), `${url} links to ${record.type} ${record.id}`);
      }
    }
    for (const definition of RECORD_TYPES) {
      const res = await api.get(`/api/${definition.path}`);
      const ids = new Set(res.body.map((row) => row[definition.idColumn]));
      for (const record of [...deleted, ...hidden].filter((candidate) => candidate.type === definition.path)) {
        assert.ok(!ids.has(record.id), `/api/${definition.path} lists ${record.id}`);
      }
    }
  });

  it('answers 404 for every deleted or hidden record, on its page and in the API', async () => {
    for (const record of [...deleted, ...hidden]) {
      const { type, id } = record;
      const base = screenFor(type).base;
      assert.equal((await web.get(`${base}/${id}`)).status, 404, `${base}/${id}`);
      assert.equal((await web.get(`${base}/${id}/edit`)).status, 404, `${base}/${id}/edit`);
      assert.equal((await api.get(`/api/${type}/${id}`)).status, 404, `GET /api/${type}/${id}`);
      assert.equal((await put(api, `/api/${type}/${id}`, {})).status, 404, `PUT /api/${type}/${id}`);
      assert.equal((await del(api, `/api/${type}/${id}`)).status, 404, `DELETE /api/${type}/${id}`);
    }
  });
});
