'use strict';

/**
 * Helpers for the tests of the server-rendered pages: signing in through the
 * sign-in form, and posting forms with the session's CSRF token.
 */

const assert = require('node:assert/strict');
const supertest = require('supertest');
const { DEFAULT_PASSWORD, createUser } = require('./app');

/** The CSRF token in a page's <meta name="csrf-token">. */
function csrfFrom(html) {
  const match = /<meta name="csrf-token" content="([^"]*)"/.exec(html);
  return match ? match[1] : '';
}

/**
 * Sign in through POST /login and return an agent with the session cookie.
 * agent.csrf holds the session's CSRF token.
 */
async function webLogin(app, username, password = DEFAULT_PASSWORD) {
  const agent = supertest.agent(app);
  const page = await agent.get('/login');
  const res = await agent
    .post('/login')
    .type('form')
    .send({ username, password, _csrf: csrfFrom(page.text) });
  assert.equal(res.status, 303, `sign-in as ${username} failed with ${res.status}`);
  const dashboard = await agent.get('/account');
  agent.csrf = csrfFrom(dashboard.text);
  return agent;
}

/** Create a user with the role (once per app) and sign in through the form. */
async function webLoginAs(ctx, role, username = `web-${role}`) {
  const existing = ctx.db.prepare('SELECT UserID FROM Users WHERE Username = ?').get(username);
  if (!existing) createUser(ctx.db, { username, role });
  return webLogin(ctx.app, username);
}

/** POST a form with the agent's CSRF token. */
const postForm = (agent, url, fields = {}) =>
  agent
    .post(url)
    .type('form')
    .send({ _csrf: agent.csrf, ...fields });

/** POST a form the way htmx does: CSRF token in a header, HX-Request set. */
const htmxPost = (agent, url, fields = {}) =>
  agent.post(url).type('form').set('HX-Request', 'true').set('X-CSRF-Token', agent.csrf).send(fields);

/** Fail when a page has an inline script or an inline style attribute. */
function assertNoInlineCode(html, label = '') {
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  for (const tag of scripts) {
    assert.ok(/\bsrc=/.test(tag) || /type="application\/json"/.test(tag), `${label}: inline script ${tag}`);
  }
  assert.ok(!/ style="/.test(html), `${label}: inline style attribute`);
}

module.exports = { csrfFrom, webLogin, webLoginAs, postForm, htmxPost, assertNoInlineCode };
