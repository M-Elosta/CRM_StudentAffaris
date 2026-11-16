'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');

const { buildApp, createUser } = require('../helpers/app');
const { csrfFrom, webLogin, postForm, htmxPost, assertNoInlineCode } = require('../helpers/web');

describe('web: sign-in, shell and error pages', () => {
  let ctx;

  before(async () => {
    ctx = await buildApp();
    createUser(ctx.db, { username: 'alice', role: 'staff' });
  });
  after(() => ctx.close());

  describe('sign-in', () => {
    it('shows the sign-in page without inline code', async () => {
      const res = await supertest(ctx.app).get('/login');
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /html/);
      assert.match(res.text, /<h1>Sign in<\/h1>/);
      assertNoInlineCode(res.text, '/login');
    });

    it('redirects a signed-out page request to /login with next, and back after signing in', async () => {
      const agent = supertest.agent(ctx.app);
      const first = await agent.get('/employers?q=gulf');
      assert.equal(first.status, 302);
      assert.equal(first.headers.location, '/login?next=%2Femployers%3Fq%3Dgulf');
      const page = await agent.get(first.headers.location);
      assert.match(page.text, /name="next" value="\/employers\?q=gulf"/);
      const res = await agent
        .post('/login')
        .type('form')
        .send({
          username: 'alice',
          password: 'correct-horse-battery-staple',
          next: '/employers?q=gulf',
          _csrf: csrfFrom(page.text),
        });
      assert.equal(res.status, 303);
      assert.equal(res.headers.location, '/employers?q=gulf');
    });

    it('never redirects to another site after signing in', async () => {
      const agent = supertest.agent(ctx.app);
      const page = await agent.get('/login');
      const res = await agent
        .post('/login')
        .type('form')
        .send({
          username: 'alice',
          password: 'correct-horse-battery-staple',
          next: '//evil.example/x',
          _csrf: csrfFrom(page.text),
        });
      assert.equal(res.headers.location, '/dashboard');
    });

    it('gives one generic message for a wrong password or unknown user', async () => {
      for (const username of ['alice', 'nobody']) {
        const agent = supertest.agent(ctx.app);
        const page = await agent.get('/login');
        const res = await agent
          .post('/login')
          .type('form')
          .send({ username, password: 'wrong-password-123', _csrf: csrfFrom(page.text) });
        assert.equal(res.status, 401);
        assert.match(res.text, /Username or password is not correct/);
        assert.match(res.text, new RegExp(`value="${username}"`));
      }
    });

    it('asks for both fields when they are empty', async () => {
      const agent = supertest.agent(ctx.app);
      const page = await agent.get('/login');
      const res = await agent
        .post('/login')
        .type('form')
        .send({ username: '', password: '', _csrf: csrfFrom(page.text) });
      assert.equal(res.status, 422);
      assert.match(res.text, /Enter your username\./);
      assert.match(res.text, /Enter your password\./);
    });

    it('rejects a form without the CSRF token', async () => {
      const res = await supertest(ctx.app)
        .post('/login')
        .type('form')
        .send({ username: 'alice', password: 'correct-horse-battery-staple' });
      assert.equal(res.status, 403);
      assert.match(res.text, /This form has expired\. Reload the page and try again\./);
    });

    it('sends a user who must change their password to /account first', async () => {
      createUser(ctx.db, { username: 'rotate', password: 'old-password-123', mustChangePassword: true });
      const agent = await webLogin(ctx.app, 'rotate', 'old-password-123');
      const res = await agent.get('/employers');
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/account');
      const account = await agent.get('/account');
      assert.match(account.text, /Choose a new password to continue/);

      const changed = await postForm(agent, '/account/password', {
        currentPassword: 'old-password-123',
        newPassword: 'a-much-better-password-2026',
        confirmPassword: 'a-much-better-password-2026',
      });
      assert.equal(changed.status, 303);
      assert.equal((await agent.get('/dashboard')).status, 200);
    });

    it('signs out', async () => {
      const agent = await webLogin(ctx.app, 'alice');
      const res = await postForm(agent, '/auth/sign-out');
      assert.equal(res.status, 303);
      assert.equal(res.headers.location, '/login?signed-out=1');
      assert.equal((await agent.get('/dashboard')).status, 302);
    });
  });

  describe('account', () => {
    it('keeps the user on the form with a specific message when the passwords differ', async () => {
      const agent = await webLogin(ctx.app, 'alice');
      const res = await postForm(agent, '/account/password', {
        currentPassword: 'correct-horse-battery-staple',
        newPassword: 'another-good-password-1',
        confirmPassword: 'another-good-password-2',
      });
      assert.equal(res.status, 422);
      assert.match(res.text, /The two new passwords are not the same\./);
    });

    it('says when the current password is wrong', async () => {
      const agent = await webLogin(ctx.app, 'alice');
      const res = await postForm(agent, '/account/password', {
        currentPassword: 'not-my-password-99',
        newPassword: 'another-good-password-1',
        confirmPassword: 'another-good-password-1',
      });
      assert.equal(res.status, 422);
      assert.match(res.text, /This is not your current password\./);
    });
  });

  describe('shell and errors', () => {
    it('/ goes to the dashboard', async () => {
      const agent = await webLogin(ctx.app, 'alice');
      const res = await agent.get('/');
      assert.equal(res.headers.location, '/dashboard');
    });

    it('renders the shell with navigation, CSRF header and no inline code', async () => {
      const agent = await webLogin(ctx.app, 'alice');
      const res = await agent.get('/dashboard');
      assert.equal(res.status, 200);
      assert.match(res.text, /aria-current="page"/);
      assert.match(res.text, /X-CSRF-Token/);
      assertNoInlineCode(res.text, '/dashboard');
    });

    it('shows a friendly 404 page', async () => {
      const agent = await webLogin(ctx.app, 'alice');
      const res = await agent.get('/no-such-page');
      assert.equal(res.status, 404);
      assert.match(res.text, /This page does not exist/);
      assert.match(res.text, /href="\/dashboard"/);
      assertNoInlineCode(res.text, '404');
    });

    it('accepts the CSRF token in the X-CSRF-Token header', async () => {
      const agent = await webLogin(ctx.app, 'alice');
      const res = await htmxPost(agent, '/session/extend');
      assert.equal(res.status, 204);
      const rejected = await agent.post('/session/extend').set('X-CSRF-Token', 'wrong');
      assert.equal(rejected.status, 403);
    });
  });

  describe('static assets', () => {
    it('serves htmx, Chart.js and the fonts from node_modules with long cache headers', async () => {
      for (const url of [
        '/vendor/htmx.min.js',
        '/vendor/chart.umd.min.js',
        '/vendor/fonts/ibm-plex-sans-latin-400-normal.woff2',
        '/vendor/fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2',
        '/assets/css/app.css',
        '/assets/css/fonts.css',
        '/assets/js/app.js',
      ]) {
        const res = await supertest(ctx.app).get(url);
        assert.equal(res.status, 200, url);
        assert.match(res.headers['cache-control'], /max-age=31536000/, url);
      }
    });

    it('does not serve other files from node_modules', async () => {
      const res = await supertest(ctx.app).get('/vendor/fonts/ibm-plex-sans-latin-700-normal.woff2');
      assert.notEqual(res.status, 200);
    });
  });
});
