'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, today } = require('../helpers/app');
const { webLoginAs, postForm, htmxPost, assertNoInlineCode } = require('../helpers/web');
const { addDaysToIsoDate } = require('../../src/lib/dates');

describe('web: follow-ups', () => {
  let ctx;
  const agents = {};
  const ids = {};

  before(async () => {
    ctx = await buildApp();
    const companyId = Number(
      ctx.db
        .prepare(
          "INSERT INTO Company (CompanyName, Industry, Sector, Country, DateAdded) VALUES ('Follow Co', 'Tech', 'Private', 'Qatar', '2026-01-01')"
        )
        .run().lastInsertRowid
    );
    const contactId = Number(
      ctx.db
        .prepare(
          "INSERT INTO Contact (CompanyID, FirstName, LastName, EmailAddress, DateAdded) VALUES (?, 'Mona', 'Saad', 'mona@example.qa', '2026-01-01')"
        )
        .run(companyId).lastInsertRowid
    );
    const insert = ctx.db.prepare(
      `INSERT INTO OutreachEngagement (CompanyID, ContactID, InteractionType, InteractionDate, DiscussionItems, ActionPlan, FollowUpDate, InteractionStatus)
       VALUES (?, ?, 'Call', ?, 'Talk', ?, ?, ?)`
    );
    const add = (plan, offset, status = 'In-progress') =>
      Number(
        insert.run(companyId, contactId, today(), plan, addDaysToIsoDate(today(), offset), status).lastInsertRowid
      );
    ids.overdue = add('Plan overdue', -3);
    ids.week = add('Plan this week', 2);
    ids.later = add('Plan later', 30);
    add('Plan done', -1, 'Complete');
    for (const role of ['staff', 'readonly', 'student_worker']) agents[role] = await webLoginAs(ctx, role);
  });
  after(() => ctx.close());

  it('groups open follow-ups as overdue, this week and later', async () => {
    const res = await agents.readonly.get('/follow-ups');
    assert.equal(res.status, 200);
    const order = ['Overdue', 'Plan overdue', 'This week', 'Plan this week', 'Later', 'Plan later'].map((text) =>
      res.text.indexOf(text)
    );
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b)
    );
    assert.doesNotMatch(res.text, /Plan done/);
    assert.doesNotMatch(res.text, /Mark complete/, 'read-only users cannot complete');
    assertNoInlineCode(res.text, '/follow-ups');
  });

  it('marks one complete in place with a message and a new sidebar count', async () => {
    const res = await htmxPost(agents.student_worker, `/follow-ups/${ids.overdue}/complete`);
    assert.equal(res.status, 200);
    assert.match(res.headers['hx-trigger'], /marked complete/);
    assert.match(res.text, new RegExp(`id="follow-up-${ids.overdue}"`));
    assert.match(res.text, /Complete/);
    assert.match(res.text, /<nav class="nav" id="nav">/);
    assert.doesNotMatch(res.text, /nav__count/);
    const status = ctx.db
      .prepare('SELECT InteractionStatus FROM OutreachEngagement WHERE OutreachEngagementID = ?')
      .get(ids.overdue).InteractionStatus;
    assert.equal(status, 'Complete');
  });

  it('redirects back with a message without htmx, and refuses roles that may not change interactions', async () => {
    const res = await postForm(agents.staff, `/follow-ups/${ids.week}/complete`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.location, '/follow-ups');
    const denied = await postForm(agents.readonly, `/follow-ups/${ids.later}/complete`);
    assert.equal(denied.status, 403);
  });
});
