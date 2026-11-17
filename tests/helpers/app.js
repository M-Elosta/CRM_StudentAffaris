'use strict';

/**
 * Shared helpers for the API integration tests.
 *
 * Every test file builds its own app around a fresh in-memory database, so no
 * file depends on data created by another one. Nothing here opens a port.
 */

const bcrypt = require('bcrypt');
const supertest = require('supertest');

const { loadConfig } = require('../../src/config');
const { openDatabase } = require('../../src/db/connection');
const { migrate } = require('../../src/db/migrate');
const { createApp } = require('../../src/app');
const { todayInTimeZone } = require('../../src/lib/dates');

const ORIGIN = 'http://crm.test';
const DEFAULT_PASSWORD = 'correct-horse-battery-staple';
const STALE_TIMESTAMP = '2000-01-01 00:00:00';

/** A logger that stays quiet but remembers what was logged, so tests can inspect it. */
function createSilentLogger() {
  const entries = { info: [], warn: [], error: [], debug: [] };
  return {
    entries,
    info: (...args) => entries.info.push(args),
    warn: (...args) => entries.warn.push(args),
    error: (...args) => entries.error.push(args),
    debug: (...args) => entries.debug.push(args),
  };
}

/**
 * Build a fresh app and database.
 * @param {object} [options]
 * @param {object} [options.env] extra environment variables for loadConfig
 */
async function buildApp({ env = {} } = {}) {
  const config = loadConfig({ NODE_ENV: 'test', BASE_URL: ORIGIN, ...env });
  const logger = createSilentLogger();
  const db = openDatabase(':memory:');
  await migrate(db, { logger });
  const app = createApp({ config, db, logger });
  return {
    app,
    db,
    config,
    logger,
    close() {
      if (db.open) db.close();
    },
  };
}

/** Insert a user straight into the database (bcrypt cost 4 keeps tests fast). */
function createUser(db, { username, password = DEFAULT_PASSWORD, role = 'admin', mustChangePassword = false }) {
  const info = db
    .prepare('INSERT INTO Users (Username, PasswordHash, Role, MustChangePassword) VALUES (?,?,?,?)')
    .run(username, bcrypt.hashSync(password, 4), role, mustChangePassword ? 1 : 0);
  return { id: Number(info.lastInsertRowid), username, password, role };
}

/** Sign in and return a supertest agent that keeps the session cookie. */
async function login(app, username, password = DEFAULT_PASSWORD) {
  const agent = supertest.agent(app);
  const res = await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ username, password });
  if (res.status !== 200) {
    throw new Error(`Login as ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

/** Create a user with the given role (once per app) and return a signed-in agent. */
async function loginAs(ctx, role, username = `${role}-user`) {
  const existing = ctx.db.prepare('SELECT UserID FROM Users WHERE Username = ?').get(username);
  if (!existing) createUser(ctx.db, { username, role });
  return login(ctx.app, username);
}

// State-changing requests must carry the app's Origin header.
const post = (agent, url, body = {}) => agent.post(url).set('Origin', ORIGIN).send(body);
const put = (agent, url, body = {}) => agent.put(url).set('Origin', ORIGIN).send(body);
const patch = (agent, url, body = {}) => agent.patch(url).set('Origin', ORIGIN).send(body);
const del = (agent, url) => agent.delete(url).set('Origin', ORIGIN);

/** Today's date as YYYY-MM-DD in the office time zone, the same way the services compute it. */
function today() {
  return todayInTimeZone(loadConfig({ NODE_ENV: 'test' }).timeZone);
}

/**
 * Set a record's stored UpdatedAt to an exact value.
 *
 * The schema has AFTER UPDATE triggers that rewrite UpdatedAt to now, and
 * UpdatedAt has one-second resolution, so a test that needs two different
 * timestamps sets the value here instead of sleeping. The table's update
 * triggers are dropped for the duration and restored from their own SQL.
 */
function setStoredUpdatedAt(db, table, idField, id, value) {
  const triggers = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND sql LIKE '%AFTER UPDATE%'"
    )
    .all(table);
  db.transaction(() => {
    for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name}"`);
    db.prepare(`UPDATE ${table} SET UpdatedAt = ? WHERE ${idField} = ?`).run(value, id);
    for (const trigger of triggers) db.exec(trigger.sql);
  })();
}

/** supertest parser that collects a binary response body into a Buffer. */
function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

module.exports = {
  ORIGIN,
  DEFAULT_PASSWORD,
  STALE_TIMESTAMP,
  XLSX_CONTENT_TYPE,
  createSilentLogger,
  buildApp,
  createUser,
  login,
  loginAs,
  post,
  put,
  patch,
  del,
  today,
  setStoredUpdatedAt,
  binaryParser,
};
