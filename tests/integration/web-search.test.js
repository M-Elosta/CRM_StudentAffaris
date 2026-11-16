'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('../helpers/app');
const { webLoginAs, assertNoInlineCode } = require('../helpers/web');

describe('web: global search', () => {
  let ctx;
  const agents = {};

  before(async () => {
    ctx = await buildApp();
    const companyId = Number(
      ctx.db
        .prepare(
          "INSERT INTO Company (CompanyName, Industry, Sector, Country, DateAdded) VALUES ('مجموعة الريان Rayyan Group', 'Tech', 'Private', 'Qatar', '2026-01-01')"
        )
        .run().lastInsertRowid
    );
    const contactId = Number(
      ctx.db
        .prepare(
          "INSERT INTO Contact (CompanyID, FirstName, LastName, EmailAddress, DateAdded) VALUES (?, 'Rayyan', 'Haddad', 'secret.rayyan@example.qa', '2026-01-01')"
        )
        .run(companyId).lastInsertRowid
    );
    ctx.db
      .prepare(
        "INSERT INTO CareerEvent (CompanyID, ContactID, EventName, EventDate, RegisteredStatus) VALUES (?, ?, 'Rayyan Careers Day', '2026-10-01', 'Attended')"
      )
      .run(companyId, contactId);
    ctx.db
      .prepare(
        `INSERT INTO StudentLedEvent (CompanyID, ContactID, ProposalDate, OrganizationName, StudentName, StudentEmail, StudentPhoneNumber)
         VALUES (?, ?, '2026-10-02', 'Rayyan Society', 'A Student', 's@example.qa', '1')`
      )
      .run(companyId, contactId);
    for (const role of ['staff', 'student_worker']) agents[role] = await webLoginAs(ctx, role);
  });
  after(() => ctx.close());

  it('groups employers, contacts and events on the results page', async () => {
    const res = await agents.staff.get('/search?q=rayyan');
    assert.equal(res.status, 200);
    assert.match(res.text, /id="hits-employers"/);
    assert.match(res.text, /id="hits-contacts"/);
    assert.match(res.text, /Rayyan Careers Day/);
    assert.match(res.text, /Rayyan Society/);
    assertNoInlineCode(res.text, '/search');
  });

  it('finds Arabic text', async () => {
    const res = await agents.staff.get(`/search?q=${encodeURIComponent('الريان')}`);
    assert.match(res.text, /مجموعة الريان Rayyan Group/);
  });

  it('respects roles: no student-led events and no matching on withheld email for a student worker', async () => {
    const res = await agents.student_worker.get('/search?q=rayyan');
    assert.match(res.text, /Rayyan Careers Day/);
    assert.doesNotMatch(res.text, /Rayyan Society/);
    const email = await agents.student_worker.get('/search?q=secret.rayyan');
    assert.doesNotMatch(email.text, /id="hits-contacts"/);
    assert.match((await agents.staff.get('/search?q=secret.rayyan')).text, /id="hits-contacts"/);
  });

  it('suggests the top hits as a fragment, and nothing for an empty query', async () => {
    const res = await agents.staff.get('/search/suggest?q=rayyan').set('HX-Request', 'true');
    assert.equal(res.status, 200);
    assert.match(res.text, /role="option" href="\/employers\/\d+"/);
    assert.match(res.text, /All results for/);
    assert.doesNotMatch(res.text, /<html/);
    assert.equal((await agents.staff.get('/search/suggest?q=')).text, '');
    assert.equal((await agents.staff.get('/search/suggest?q=zzzzzz')).text.trim(), '');
  });
});
