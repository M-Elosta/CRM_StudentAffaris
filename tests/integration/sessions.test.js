'use strict';

const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');

const { loadConfig } = require('../../src/config');
const { openDatabase } = require('../../src/db/connection');
const { migrate } = require('../../src/db/migrate');
const { createApp } = require('../../src/app');
const { hashSessionId } = require('../../src/security/session-store');
const { ORIGIN, buildApp, createSilentLogger, createUser, login, post } = require('../helpers/app');
const { makeTempDir } = require('../helpers/tmp');

const SECRET = 'a-fixed-session-secret-of-at-least-32-chars';

/** The session id inside a signed ero.sid cookie of a supertest agent. */
function sessionIdOf(agent) {
  const cookie = agent.jar.getCookie('ero.sid', { domain: '127.0.0.1', path: '/', secure: false, script: false });
  const value = decodeURIComponent(cookie.value);
  return value.slice(2, value.lastIndexOf('.'));
}

describe('Database sessions', () => {
  let ctx;

  before(async () => {
    ctx = await buildApp();
    createUser(ctx.db, { username: 'sam', role: 'admin' });
  });

  after(() => ctx.close());

  const sessionRows = () => ctx.db.prepare('SELECT * FROM Sessions').all();

  it('stores a signed-in session under the hash of its id, never the raw id', async () => {
    const agent = await login(ctx.app, 'sam');
    const sid = sessionIdOf(agent);
    const rows = sessionRows();
    assert.ok(rows.some((row) => row.SessionHash === hashSessionId(sid)));
    assert.ok(!JSON.stringify(rows).includes(sid));
  });

  it('logout deletes the session row', async () => {
    const agent = await login(ctx.app, 'sam');
    const hash = hashSessionId(sessionIdOf(agent));
    assert.ok(ctx.db.prepare('SELECT 1 FROM Sessions WHERE SessionHash = ?').get(hash));
    assert.equal((await post(agent, '/api/auth/logout')).status, 200);
    assert.equal(ctx.db.prepare('SELECT 1 FROM Sessions WHERE SessionHash = ?').get(hash), undefined);
  });

  it('sends a rolling cookie that expires after the idle timeout', async () => {
    const agent = await login(ctx.app, 'sam');
    const res = await agent.get('/api/companies');
    const cookie = res.headers['set-cookie']?.find((value) => value.startsWith('ero.sid='));
    assert.ok(cookie, 'the cookie is sent again on activity');
    const expires = Date.parse(/Expires=([^;]+)/i.exec(cookie)[1]);
    const idleMs = ctx.config.sessionIdleMinutes * 60 * 1000;
    assert.ok(Math.abs(expires - (Date.now() + idleMs)) < 5000);
  });
});

describe('Database sessions across a restart', () => {
  it('a session created through one app works on a second app over the same database file', async (t) => {
    const dir = makeTempDir(t);
    const env = {
      NODE_ENV: 'test',
      BASE_URL: ORIGIN,
      SESSION_SECRET: SECRET,
      DATABASE_PATH: path.join(dir, 'crm.db'),
    };
    const config = loadConfig(env);
    const logger = createSilentLogger();

    const firstDb = openDatabase(config.databasePath);
    await migrate(firstDb, { logger });
    createUser(firstDb, { username: 'restart-user', role: 'admin' });
    const first = createApp({ config, db: firstDb, logger });
    const agent = await login(first, 'restart-user');
    assert.equal((await agent.get('/api/companies')).status, 200);
    const cookie = agent.jar.getCookie('ero.sid', { domain: '127.0.0.1', path: '/', secure: false, script: false });
    firstDb.close();

    const secondDb = openDatabase(config.databasePath);
    t.after(() => secondDb.close());
    const second = createApp({ config: loadConfig(env), db: secondDb, logger });
    const res = await supertest(second).get('/api/auth/check').set('Cookie', `ero.sid=${cookie.value}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.username, 'restart-user');
  });
});
