'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, createUser, login, DEFAULT_PASSWORD } = require('../helpers/app');
const { webLoginAs, webLogin, postForm, assertNoInlineCode } = require('../helpers/web');
const { loadConfig } = require('../../src/config');
const { createServices } = require('../../src/services');

describe('web: user administration', () => {
  let ctx;
  const agents = {};

  before(async () => {
    ctx = await buildApp();
    for (const role of ['admin', 'staff', 'readonly', 'student_worker']) agents[role] = await webLoginAs(ctx, role);
  });
  after(() => ctx.close());

  it('is open to administrators only', async () => {
    const res = await agents.admin.get('/admin/users');
    assert.equal(res.status, 200);
    assert.match(res.text, /web-staff/);
    assertNoInlineCode(res.text, '/admin/users');
    for (const role of ['staff', 'readonly', 'student_worker']) {
      assert.equal((await agents[role].get('/admin/users')).status, 403, role);
      assert.equal((await postForm(agents[role], '/admin/users', { username: 'x' })).status, 403, role);
    }
    assert.doesNotMatch((await agents.staff.get('/dashboard')).text, /href="\/admin\/users"/);
  });

  it('adds a user, and keeps the form with a message when the input is wrong', async () => {
    const bad = await postForm(agents.admin, '/admin/users', {
      username: 'new user',
      password: 'short',
      role: 'staff',
    });
    assert.equal(bad.status, 422);
    assert.match(bad.text, /Password must be at least 12 characters/);
    assert.match(bad.text, /value="new user"/);
    const good = await postForm(agents.admin, '/admin/users', {
      username: 'new.user',
      password: 'a-long-enough-password',
      role: 'readonly',
    });
    assert.equal(good.status, 303);
    assert.match((await agents.admin.get('/admin/users')).text, /User new\.user added/);
    const taken = await postForm(agents.admin, '/admin/users', {
      username: 'new.user',
      password: 'a-long-enough-password',
      role: 'readonly',
    });
    assert.equal(taken.status, 422);
    assert.match(taken.text, /This username is already taken/);
  });

  it('changes a role, but not the administrator’s own', async () => {
    const target = createUser(ctx.db, { username: 'role-target', role: 'staff' });
    const res = await postForm(agents.admin, `/admin/users/${target.id}/role`, { role: 'readonly' });
    assert.equal(res.status, 303);
    assert.equal(ctx.db.prepare('SELECT Role FROM Users WHERE UserID = ?').get(target.id).Role, 'readonly');
    const selfId = ctx.db.prepare("SELECT UserID FROM Users WHERE Username = 'web-admin'").get().UserID;
    await postForm(agents.admin, `/admin/users/${selfId}/role`, { role: 'staff' });
    assert.match((await agents.admin.get('/admin/users')).text, /Cannot change your own role/);
  });

  it('deactivates: the account is signed out at once and cannot sign in; reactivates', async () => {
    const target = createUser(ctx.db, { username: 'leaver', role: 'staff' });
    const session = await webLogin(ctx.app, 'leaver');
    assert.equal((await session.get('/dashboard')).status, 200);

    const res = await postForm(agents.admin, `/admin/users/${target.id}/deactivate`);
    assert.equal(res.status, 303);
    const row = ctx.db
      .prepare('SELECT IsActive, DeactivatedAt, DeactivatedBy FROM Users WHERE UserID = ?')
      .get(target.id);
    assert.equal(row.IsActive, 0);
    assert.ok(row.DeactivatedAt);
    assert.ok(row.DeactivatedBy);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM Sessions WHERE UserID = ?').get(target.id).n, 0);
    assert.equal((await session.get('/dashboard')).status, 302);
    await assert.rejects(login(ctx.app, 'leaver', DEFAULT_PASSWORD));

    assert.equal((await postForm(agents.admin, `/admin/users/${target.id}/reactivate`)).status, 303);
    assert.ok(await login(ctx.app, 'leaver', DEFAULT_PASSWORD));
  });
});

describe('users service: deactivation rules', () => {
  let ctx;
  let users;

  before(async () => {
    ctx = await buildApp();
    users = createServices({ db: ctx.db, config: loadConfig({ NODE_ENV: 'test' }), logger: ctx.logger }).users;
  });
  after(() => ctx.close());

  it('refuses to deactivate your own account', () => {
    const admin = createUser(ctx.db, { username: 'self-admin', role: 'admin' });
    assert.throws(() => users.deactivate(admin.id, admin.id), /cannot deactivate your own account/);
  });

  it('refuses to deactivate the last active admin', () => {
    const first = createUser(ctx.db, { username: 'admin-a', role: 'admin' });
    const second = createUser(ctx.db, { username: 'admin-b', role: 'admin' });
    const other = ctx.db.prepare("SELECT UserID FROM Users WHERE Username = 'self-admin'").get().UserID;
    assert.equal(users.deactivate(first.id, other), true);
    assert.equal(users.deactivate(first.id, second.id), true);
    assert.throws(() => users.deactivate(second.id, first.id), /last active admin/);
    assert.equal(users.deactivate(first.id, second.id), false, 'already deactivated');
  });

  it('is a NotFoundError for an unknown account', () => {
    assert.throws(() => users.deactivate(1, 999999), /User not found/);
  });

  it('lists accounts with status and last sign-in, active first', () => {
    const accounts = users.listAccounts();
    assert.ok(accounts.length >= 3);
    assert.ok('LastLoginAt' in accounts[0]);
    assert.equal(accounts[0].IsActive, 1);
    assert.equal(accounts.at(-1).IsActive, 0);
    assert.ok(!('PasswordHash' in accounts[0]));
  });
});
