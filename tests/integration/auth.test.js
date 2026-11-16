'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const bcrypt = require('bcrypt');

const { buildApp, createUser, login, post, ORIGIN, DEFAULT_PASSWORD } = require('../helpers/app');
const { ALL_PERMISSIONS, can } = require('../../src/security/permissions');

describe('Authentication', () => {
  let ctx;

  before(async () => {
    ctx = await buildApp();
    createUser(ctx.db, { username: 'alice', role: 'admin' });
    createUser(ctx.db, { username: 'victor', role: 'readonly' });
  });

  after(() => ctx.close());

  describe('login', () => {
    it('signs in with the right password and reports the role', async () => {
      const agent = supertest.agent(ctx.app);
      const res = await post(agent, '/api/auth/login', { username: 'alice', password: DEFAULT_PASSWORD });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, {
        success: true,
        username: 'alice',
        role: 'admin',
        roleLabel: 'Admin',
        permissions: [...ALL_PERMISSIONS],
        mustChangePassword: false,
      });
      const cookie = res.headers['set-cookie']?.join(';') || '';
      assert.match(cookie, /ero\.sid=/);
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Strict/i);
    });

    it('reports the read-only role, its label and its permissions for a read-only user', async () => {
      const res = await post(supertest.agent(ctx.app), '/api/auth/login', {
        username: 'victor',
        password: DEFAULT_PASSWORD,
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.role, 'readonly');
      assert.equal(res.body.roleLabel, 'Read-only');
      assert.deepEqual(
        res.body.permissions,
        ALL_PERMISSIONS.filter((permission) => can('readonly', permission))
      );
    });

    it('maps a legacy "viewer" role stored in the database to read-only', async () => {
      createUser(ctx.db, { username: 'legacy-viewer', role: 'viewer' });
      const agent = await login(ctx.app, 'legacy-viewer');
      const res = await agent.get('/api/auth/check');
      assert.equal(res.body.role, 'readonly');
    });

    it('rejects a wrong password with 401 and no session', async () => {
      const agent = supertest.agent(ctx.app);
      const res = await post(agent, '/api/auth/login', { username: 'alice', password: 'wrong-password-123' });
      assert.equal(res.status, 401);
      assert.equal(typeof res.body.error, 'string');
      assert.equal((await agent.get('/api/auth/check')).status, 401);
    });

    it('rejects an unknown username with the same 401 message as a wrong password', async () => {
      const unknown = await post(supertest.agent(ctx.app), '/api/auth/login', {
        username: 'nobody',
        password: DEFAULT_PASSWORD,
      });
      const wrong = await post(supertest.agent(ctx.app), '/api/auth/login', {
        username: 'alice',
        password: 'wrong-password-123',
      });
      assert.equal(unknown.status, 401);
      assert.equal(unknown.body.error, wrong.body.error);
    });

    it('rejects a login without a username or password with 400', async () => {
      assert.equal((await post(supertest.agent(ctx.app), '/api/auth/login', { password: 'x' })).status, 400);
      assert.equal((await post(supertest.agent(ctx.app), '/api/auth/login', { username: 'alice' })).status, 400);
    });
  });

  describe('check and logout', () => {
    it('check reports the signed-in user', async () => {
      const agent = await login(ctx.app, 'alice');
      const res = await agent.get('/api/auth/check');
      assert.equal(res.status, 200);
      assert.equal(res.body.authenticated, true);
      assert.equal(res.body.username, 'alice');
      assert.equal(res.body.role, 'admin');
      assert.equal(res.body.roleLabel, 'Admin');
      assert.deepEqual(res.body.permissions, [...ALL_PERMISSIONS]);
      assert.equal(res.body.mustChangePassword, false);
    });

    it('sends a fresh X-Request-Id on every response', async () => {
      const agent = await login(ctx.app, 'alice');
      const first = await agent.get('/api/auth/check');
      const second = await agent.get('/api/auth/check');
      assert.match(first.headers['x-request-id'], /^[0-9a-f-]{36}$/);
      assert.notEqual(first.headers['x-request-id'], second.headers['x-request-id']);
    });

    it('check returns 401 when not signed in', async () => {
      const res = await supertest(ctx.app).get('/api/auth/check');
      assert.equal(res.status, 401);
      assert.notEqual(res.body.authenticated, true);
    });

    it('logout ends the session', async () => {
      const agent = await login(ctx.app, 'alice');
      assert.equal((await agent.get('/api/companies')).status, 200);
      const res = await post(agent, '/api/auth/logout');
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal((await agent.get('/api/companies')).status, 401);
      assert.equal((await agent.get('/api/auth/check')).status, 401);
    });
  });

  describe('change password', () => {
    it('changes the password, after which only the new one works', async () => {
      createUser(ctx.db, { username: 'rotator', password: 'original-password-1' });
      const agent = await login(ctx.app, 'rotator', 'original-password-1');
      const res = await post(agent, '/api/auth/change-password', {
        currentPassword: 'original-password-1',
        newPassword: 'brand-new-password-2',
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);

      const oldLogin = await post(supertest.agent(ctx.app), '/api/auth/login', {
        username: 'rotator',
        password: 'original-password-1',
      });
      assert.equal(oldLogin.status, 401);
      await login(ctx.app, 'rotator', 'brand-new-password-2');
    });

    it('rejects a new password shorter than 12 characters', async () => {
      const agent = await login(ctx.app, 'alice');
      const res = await post(agent, '/api/auth/change-password', {
        currentPassword: DEFAULT_PASSWORD,
        newPassword: 'short-pw-11',
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /12/);
    });

    it('rejects a new password equal to the current one', async () => {
      const agent = await login(ctx.app, 'alice');
      const res = await post(agent, '/api/auth/change-password', {
        currentPassword: DEFAULT_PASSWORD,
        newPassword: DEFAULT_PASSWORD,
      });
      assert.equal(res.status, 400);
    });

    it('rejects admin123 as the new password', async () => {
      // admin123 is too short anyway; whichever rule fires, it must be refused.
      const agent = await login(ctx.app, 'alice');
      const res = await post(agent, '/api/auth/change-password', {
        currentPassword: DEFAULT_PASSWORD,
        newPassword: 'admin123',
      });
      assert.equal(res.status, 400);
      const user = ctx.db.prepare("SELECT PasswordHash FROM Users WHERE Username = 'alice'").get();
      assert.ok(bcrypt.compareSync(DEFAULT_PASSWORD, user.PasswordHash));
    });

    it('rejects a wrong current password with 401 and keeps the old password', async () => {
      const agent = await login(ctx.app, 'alice');
      const res = await post(agent, '/api/auth/change-password', {
        currentPassword: 'not-the-password',
        newPassword: 'another-new-password',
      });
      assert.equal(res.status, 401);
      const user = ctx.db.prepare("SELECT PasswordHash FROM Users WHERE Username = 'alice'").get();
      assert.ok(bcrypt.compareSync(DEFAULT_PASSWORD, user.PasswordHash));
    });

    it('requires a session', async () => {
      const res = await post(supertest(ctx.app), '/api/auth/change-password', {
        currentPassword: DEFAULT_PASSWORD,
        newPassword: 'another-new-password',
      });
      assert.equal(res.status, 401);
    });
  });

  describe('forced password rotation', () => {
    it('blocks every other API route until the password is changed', async () => {
      createUser(ctx.db, { username: 'flagged', password: 'flagged-password-1', mustChangePassword: true });
      const agent = supertest.agent(ctx.app);
      const loginRes = await post(agent, '/api/auth/login', { username: 'flagged', password: 'flagged-password-1' });
      assert.equal(loginRes.status, 200);
      assert.equal(loginRes.body.mustChangePassword, true);

      for (const url of ['/api/companies', '/api/dashboard/stats', '/api/users', '/api/meta/last-updated']) {
        const res = await agent.get(url);
        assert.equal(res.status, 403, url);
        assert.equal(res.body.code, 'PASSWORD_CHANGE_REQUIRED', url);
      }
      const write = await post(agent, '/api/companies', {
        CompanyName: 'Blocked',
        Industry: 'X',
        Sector: 'Private',
        Country: 'Qatar',
      });
      assert.equal(write.status, 403);
      assert.equal(write.body.code, 'PASSWORD_CHANGE_REQUIRED');

      const check = await agent.get('/api/auth/check');
      assert.equal(check.status, 200);
      assert.equal(check.body.mustChangePassword, true);

      const change = await post(agent, '/api/auth/change-password', {
        currentPassword: 'flagged-password-1',
        newPassword: 'rotated-password-2',
      });
      assert.equal(change.status, 200);
      assert.equal((await agent.get('/api/companies')).status, 200);
      assert.equal(
        ctx.db.prepare("SELECT MustChangePassword FROM Users WHERE Username = 'flagged'").get().MustChangePassword,
        0
      );
    });

    it('lets a user who must rotate still log out', async () => {
      createUser(ctx.db, { username: 'flagged-2', password: 'flagged-password-1', mustChangePassword: true });
      const agent = await login(ctx.app, 'flagged-2', 'flagged-password-1');
      assert.equal((await post(agent, '/api/auth/logout')).status, 200);
    });

    it('signing in with admin123 sets the rotation flag', async () => {
      createUser(ctx.db, { username: 'legacy', password: 'admin123' });
      const agent = supertest.agent(ctx.app);
      const res = await post(agent, '/api/auth/login', { username: 'legacy', password: 'admin123' });
      assert.equal(res.status, 200);
      assert.equal(res.body.mustChangePassword, true);
      assert.equal(
        ctx.db.prepare("SELECT MustChangePassword FROM Users WHERE Username = 'legacy'").get().MustChangePassword,
        1
      );
      const blocked = await agent.get('/api/companies');
      assert.equal(blocked.status, 403);
      assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
    });

    it('sends page requests of a user who must rotate to the account page', async () => {
      createUser(ctx.db, { username: 'flagged-3', password: 'flagged-password-1', mustChangePassword: true });
      const agent = await login(ctx.app, 'flagged-3', 'flagged-password-1');
      const page = await agent.get('/employers');
      assert.equal(page.status, 302);
      assert.equal(page.headers.location, '/account');
      assert.equal((await agent.get('/account')).status, 200);
    });
  });

  describe('unauthenticated access', () => {
    it('API requests without a session return 401 JSON', async () => {
      for (const url of [
        '/api/companies',
        '/api/contacts/1',
        '/api/dashboard/stats',
        '/api/users',
        '/api/meta/last-updated',
      ]) {
        const res = await supertest(ctx.app).get(url);
        assert.equal(res.status, 401, url);
        assert.match(res.headers['content-type'], /json/);
      }
    });

    it('API writes without a session return 401', async () => {
      const res = await supertest(ctx.app)
        .post('/api/companies')
        .set('Origin', ORIGIN)
        .send({ CompanyName: 'X', Industry: 'X', Sector: 'Private', Country: 'X' });
      assert.equal(res.status, 401);
    });

    it('page requests without a session redirect to the sign-in page and back', async () => {
      for (const url of ['/employers', '/dashboard?x=1']) {
        const res = await supertest(ctx.app).get(url);
        assert.equal(res.status, 302, url);
        assert.equal(res.headers.location, `/login?next=${encodeURIComponent(url)}`, url);
      }
      const root = await supertest(ctx.app).get('/');
      assert.equal(root.status, 302);
      assert.equal(root.headers.location, '/login');
    });

    it('the login page and its assets are public', async () => {
      const page = await supertest(ctx.app).get('/login');
      assert.equal(page.status, 200);
      assert.match(page.headers['content-type'], /html/);

      const css = await supertest(ctx.app).get('/assets/css/app.css');
      assert.equal(css.status, 200);
      assert.match(css.headers['content-type'], /css/);

      const js = await supertest(ctx.app).get('/assets/js/app.js');
      assert.equal(js.status, 200);
      assert.match(js.headers['content-type'], /javascript/);
    });

    it('signed-in users can load application pages', async () => {
      const agent = await login(ctx.app, 'alice');
      const res = await agent.get('/employers');
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /html/);
    });
  });
});
