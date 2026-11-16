'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, today } = require('../helpers/app');
const { webLoginAs, assertNoInlineCode } = require('../helpers/web');
const { addDaysToIsoDate } = require('../../src/lib/dates');

const ROLES = ['admin', 'staff', 'readonly', 'student_worker'];

describe('web: dashboard', () => {
  let ctx;
  const agents = {};

  before(async () => {
    ctx = await buildApp();
    const companyId = Number(
      ctx.db
        .prepare(
          "INSERT INTO Company (CompanyName, Industry, Sector, Country, DateAdded) VALUES ('Dash Co', 'Tech', 'Private', 'Qatar', ?)"
        )
        .run(today()).lastInsertRowid
    );
    const contactId = Number(
      ctx.db
        .prepare(
          "INSERT INTO Contact (CompanyID, FirstName, LastName, EmailAddress, DateAdded) VALUES (?, 'Ali', 'Kaabi', 'ali@example.qa', ?)"
        )
        .run(companyId, today()).lastInsertRowid
    );
    ctx.db
      .prepare(
        `INSERT INTO OutreachEngagement (CompanyID, ContactID, InteractionType, InteractionDate, DiscussionItems, ActionPlan, FollowUpDate, InteractionStatus)
         VALUES (?, ?, 'Call', ?, 'Spring hiring', 'Send the resume book', ?, 'In-progress')`
      )
      .run(companyId, contactId, today(), addDaysToIsoDate(today(), -2));
    for (const role of ROLES) agents[role] = await webLoginAs(ctx, role);
  });
  after(() => ctx.close());

  it('renders figures, follow-ups, activity and chart data in the first response for every role', async () => {
    for (const role of ROLES) {
      const res = await agents[role].get('/dashboard');
      assert.equal(res.status, 200, role);
      assert.match(res.text, /Active employers/);
      assert.match(res.text, /Send the resume book/);
      assert.match(res.text, /Overdue/);
      assert.match(res.text, /Spring hiring/);
      assert.match(res.text, /<script type="application\/json" data-chart>/);
      assertNoInlineCode(res.text, `dashboard as ${role}`);
    }
  });

  it('shows the overdue count in the sidebar', async () => {
    const res = await agents.staff.get('/dashboard');
    assert.match(res.text, /<span class="nav__count" aria-label="1 overdue">1<\/span>/);
  });
});
