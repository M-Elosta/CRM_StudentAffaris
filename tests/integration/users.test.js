'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');

const { buildApp, createUser, login, post, patch, del } = require('../helpers/app');

describe('User management', () => {
  let ctx;
  let admin;
  let adminUser;

  before(async () => {
    ctx = await buildApp();
    adminUser = createUser(ctx.db, { username: 'head-admin', role: 'admin' });
    admin = await login(ctx.app, 'head-admin');
  });

  after(() => ctx.close());

  const roleOf = (id) => ctx.db.prepare('SELECT Role FROM Users WHERE UserID = ?').get(id)?.Role;

  it('lists users without exposing password hashes', async () => {
    const res = await admin.get('/api/users');
    assert.equal(res.status, 200);
    assert.ok(res.body.some((user) => user.Username === 'head-admin'));
    for (const user of res.body) {
      assert.deepEqual(Object.keys(user).sort(), ['CreatedAt', 'Role', 'UserID', 'Username']);
    }
  });

  it('creates a user who can then sign in with that role', async () => {
    const res = await post(admin, '/api/users', {
      username: 'new.viewer',
      password: 'viewer-password-123',
      role: 'readonly',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.Username, 'new.viewer');
    assert.equal(res.body.Role, 'readonly');
    assert.ok(Number(res.body.UserID) > 0);

    const signIn = await post(supertest.agent(ctx.app), '/api/auth/login', {
      username: 'new.viewer',
      password: 'viewer-password-123',
    });
    assert.equal(signIn.status, 200);
    assert.equal(signIn.body.role, 'readonly');
    assert.equal(signIn.body.mustChangePassword, false);
  });

  it('stores a bcrypt hash, not the password', async () => {
    await post(admin, '/api/users', { username: 'hash.check', password: 'hash-check-password', role: 'readonly' });
    const row = ctx.db.prepare("SELECT PasswordHash FROM Users WHERE Username = 'hash.check'").get();
    assert.match(row.PasswordHash, /^\$2[aby]\$/);
    assert.ok(!row.PasswordHash.includes('hash-check-password'));
  });

  it('rejects a duplicate username with 409', async () => {
    await post(admin, '/api/users', { username: 'dupe', password: 'first-password-123', role: 'readonly' });
    const res = await post(admin, '/api/users', { username: 'dupe', password: 'second-password-123', role: 'admin' });
    assert.equal(res.status, 409);
    assert.equal(roleOf(ctx.db.prepare("SELECT UserID FROM Users WHERE Username = 'dupe'").get().UserID), 'readonly');
  });

  it('rejects a password shorter than 12 characters with 400', async () => {
    const res = await post(admin, '/api/users', { username: 'shorty', password: 'short-pw-11', role: 'readonly' });
    assert.equal(res.status, 400);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM Users WHERE Username = 'shorty'").get().n, 0);
  });

  it('rejects an unknown role with 400', async () => {
    const res = await post(admin, '/api/users', { username: 'superuser', password: 'super-password-1', role: 'root' });
    assert.equal(res.status, 400);
  });

  it('rejects a username with invalid characters with 400', async () => {
    for (const username of ['ab', 'has space', 'semi;colon', 'x'.repeat(65)]) {
      const res = await post(admin, '/api/users', { username, password: 'valid-password-123', role: 'readonly' });
      assert.equal(res.status, 400, username);
    }
  });

  it('promotes a read-only user to admin and demotes them again', async () => {
    const user = createUser(ctx.db, { username: 'promotable', role: 'readonly' });
    assert.equal((await patch(admin, `/api/users/${user.id}/role`, { role: 'admin' })).status, 200);
    assert.equal(roleOf(user.id), 'admin');
    assert.equal((await patch(admin, `/api/users/${user.id}/role`, { role: 'readonly' })).status, 200);
    assert.equal(roleOf(user.id), 'readonly');
  });

  it('rejects an invalid role change with 400', async () => {
    const user = createUser(ctx.db, { username: 'role-target', role: 'readonly' });
    assert.equal((await patch(admin, `/api/users/${user.id}/role`, { role: 'owner' })).status, 400);
    assert.equal((await patch(admin, '/api/users/abc/role', { role: 'readonly' })).status, 400);
  });

  it('returns 404 when changing the role of a user that does not exist', async () => {
    assert.equal((await patch(admin, '/api/users/999999/role', { role: 'admin' })).status, 404);
    assert.equal((await patch(admin, '/api/users/999999/role', { role: 'readonly' })).status, 404);
  });

  it('does not let an admin change their own role', async () => {
    createUser(ctx.db, { username: 'backup-admin', role: 'admin' });
    const res = await patch(admin, `/api/users/${adminUser.id}/role`, { role: 'readonly' });
    assert.equal(res.status, 403);
    assert.equal(roleOf(adminUser.id), 'admin');
  });

  it('does not let an admin delete their own account', async () => {
    const res = await del(admin, `/api/users/${adminUser.id}`);
    assert.equal(res.status, 403);
    assert.ok(roleOf(adminUser.id));
  });

  it('deletes another user', async () => {
    const user = createUser(ctx.db, { username: 'leaver', role: 'readonly' });
    assert.equal((await del(admin, `/api/users/${user.id}`)).status, 200);
    assert.equal(roleOf(user.id), undefined);
  });

  it('returns 404 when deleting a user that does not exist', async () => {
    assert.equal((await del(admin, '/api/users/999999')).status, 404);
  });

  it('rejects a non-numeric user id with 400', async () => {
    assert.equal((await del(admin, '/api/users/abc')).status, 400);
  });
});

describe('User management: last admin protection', () => {
  let ctx;

  before(async () => {
    ctx = await buildApp();
  });

  after(() => ctx.close());

  it('does not let anyone demote or delete the last admin', async () => {
    // A signed-in admin cannot touch their own account, so the last-admin rule
    // is reached through a second session whose user has since been demoted
    // directly in the database, leaving exactly one admin.
    const lastAdmin = createUser(ctx.db, { username: 'only-admin', role: 'admin' });
    createUser(ctx.db, { username: 'acting-admin', role: 'admin' });
    const acting = await login(ctx.app, 'acting-admin');
    ctx.db.prepare("UPDATE Users SET Role = 'readonly' WHERE Username = 'acting-admin'").run();
    // The session still says admin. Whether the request is refused by the
    // last-admin rule or by a fresh role check, it must be refused.
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM Users WHERE Role = 'admin'").get().n, 1);

    const demote = await patch(acting, `/api/users/${lastAdmin.id}/role`, { role: 'readonly' });
    assert.equal(demote.status, 403);

    const remove = await del(acting, `/api/users/${lastAdmin.id}`);
    assert.equal(remove.status, 403);

    assert.equal(ctx.db.prepare('SELECT Role FROM Users WHERE UserID = ?').get(lastAdmin.id).Role, 'admin');
  });

  it('allows demoting an admin while another admin remains', async () => {
    const ctx2 = await buildApp();
    try {
      createUser(ctx2.db, { username: 'admin-a', role: 'admin' });
      const second = createUser(ctx2.db, { username: 'admin-b', role: 'admin' });
      const agent = await login(ctx2.app, 'admin-a');
      assert.equal((await patch(agent, `/api/users/${second.id}/role`, { role: 'readonly' })).status, 200);
      // admin-a is now the last admin and cannot demote themselves either.
      const self = ctx2.db.prepare("SELECT UserID FROM Users WHERE Username = 'admin-a'").get().UserID;
      assert.equal((await patch(agent, `/api/users/${self}/role`, { role: 'readonly' })).status, 403);
    } finally {
      ctx2.close();
    }
  });
});

describe('User management: existing sessions', () => {
  let ctx;
  let admin;

  before(async () => {
    ctx = await buildApp();
    createUser(ctx.db, { username: 'boss', role: 'admin' });
    admin = await login(ctx.app, 'boss');
  });

  after(() => ctx.close());

  const COMPANY = { CompanyName: 'Session Co', Industry: 'X', Sector: 'Private', Country: 'Qatar' };

  it('a demoted admin loses write access without signing in again', async () => {
    const demoted = createUser(ctx.db, { username: 'soon-viewer', role: 'admin' });
    const agent = await login(ctx.app, 'soon-viewer');
    assert.equal((await patch(admin, `/api/users/${demoted.id}/role`, { role: 'readonly' })).status, 200);
    assert.equal((await post(agent, '/api/companies', COMPANY)).status, 403);
  });

  it('a deleted user can no longer use their session', async () => {
    const leaver = createUser(ctx.db, { username: 'leaving-viewer', role: 'readonly' });
    const agent = await login(ctx.app, 'leaving-viewer');
    assert.equal((await del(admin, `/api/users/${leaver.id}`)).status, 200);
    assert.equal((await agent.get('/api/companies')).status, 401);
  });
});
