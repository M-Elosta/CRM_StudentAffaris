'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');

const { buildApp, createUser, login, post, DEFAULT_PASSWORD } = require('../helpers/app');

describe('The signed-in user is read from the database on every request', () => {
  let ctx;

  before(async () => {
    ctx = await buildApp();
  });

  after(() => ctx.close());

  const sessionCount = (userId) => ctx.db.prepare('SELECT COUNT(*) AS n FROM Sessions WHERE UserID = ?').get(userId).n;

  it('a user deactivated in the database is refused on the next API request and the session is deleted', async () => {
    const user = createUser(ctx.db, { username: 'switched-off', role: 'readonly' });
    const agent = await login(ctx.app, 'switched-off');
    assert.equal((await agent.get('/api/companies')).status, 200);

    ctx.db.prepare('UPDATE Users SET IsActive = 0 WHERE UserID = ?').run(user.id);
    const res = await agent.get('/api/companies');
    assert.equal(res.status, 401);
    assert.equal(sessionCount(user.id), 0);

    // Reactivating the account does not bring the old session back.
    ctx.db.prepare('UPDATE Users SET IsActive = 1 WHERE UserID = ?').run(user.id);
    assert.equal((await agent.get('/api/companies')).status, 401);
  });

  it('a deactivated user requesting a page is sent to the login page', async () => {
    const user = createUser(ctx.db, { username: 'page-reader', role: 'readonly' });
    const agent = await login(ctx.app, 'page-reader');
    ctx.db.prepare('UPDATE Users SET IsActive = 0 WHERE UserID = ?').run(user.id);
    const res = await agent.get('/employers');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login?next=%2Femployers');
  });

  it('a role changed in the database applies on the next request', async () => {
    const user = createUser(ctx.db, { username: 'role-shifter', role: 'admin' });
    const agent = await login(ctx.app, 'role-shifter');
    ctx.db.prepare("UPDATE Users SET Role = 'readonly' WHERE UserID = ?").run(user.id);
    const res = await agent.get('/api/auth/check');
    assert.equal(res.status, 200);
    assert.equal(res.body.role, 'readonly');
    assert.equal(res.body.roleLabel, 'Read-only');
  });

  it('an unknown role in the database is treated as the least privileged role', async () => {
    const user = createUser(ctx.db, { username: 'odd-role', role: 'readonly' });
    const agent = await login(ctx.app, 'odd-role');
    ctx.db.prepare("UPDATE Users SET Role = 'superuser' WHERE UserID = ?").run(user.id);
    assert.equal((await agent.get('/api/auth/check')).body.role, 'student_worker');
  });

  it('a deactivated user cannot sign in, with the same message as a wrong password', async () => {
    const user = createUser(ctx.db, { username: 'inactive-login', role: 'readonly' });
    ctx.db.prepare('UPDATE Users SET IsActive = 0 WHERE UserID = ?').run(user.id);
    const inactive = await post(supertest.agent(ctx.app), '/api/auth/login', {
      username: 'inactive-login',
      password: DEFAULT_PASSWORD,
    });
    const wrong = await post(supertest.agent(ctx.app), '/api/auth/login', {
      username: 'inactive-login',
      password: 'not-the-right-password',
    });
    assert.equal(inactive.status, 401);
    assert.equal(inactive.body.error, 'Invalid username or password');
    assert.equal(inactive.body.error, wrong.body.error);
  });

  it('a successful sign-in records LastLoginAt', async () => {
    const user = createUser(ctx.db, { username: 'last-login', role: 'readonly' });
    const lastLogin = () => ctx.db.prepare('SELECT LastLoginAt FROM Users WHERE UserID = ?').get(user.id).LastLoginAt;
    assert.equal(lastLogin(), null);
    await login(ctx.app, 'last-login');
    assert.ok(lastLogin());
    assert.ok(Math.abs(Date.parse(lastLogin()) - Date.now()) < 60_000);
  });

  it('changing the password ends the other sessions of that user but keeps the current one', async () => {
    const user = createUser(ctx.db, { username: 'two-browsers', password: 'first-password-123' });
    const laptop = await login(ctx.app, 'two-browsers', 'first-password-123');
    const phone = await login(ctx.app, 'two-browsers', 'first-password-123');
    assert.equal(sessionCount(user.id), 2);

    const res = await post(laptop, '/api/auth/change-password', {
      currentPassword: 'first-password-123',
      newPassword: 'second-password-456',
    });
    assert.equal(res.status, 200);
    assert.equal(sessionCount(user.id), 1);
    assert.equal((await laptop.get('/api/companies')).status, 200);
    assert.equal((await phone.get('/api/companies')).status, 401);
  });
});
