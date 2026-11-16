'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { promisify } = require('node:util');

const { openDatabase } = require('../../src/db/connection');
const { migrate } = require('../../src/db/migrate');
const { DatabaseSessionStore, hashSessionId } = require('../../src/security/session-store');
const { createSilentLogger, createUser } = require('../helpers/app');

const MINUTE = 60 * 1000;
const IDLE = 30 * MINUTE;
const ABSOLUTE = 12 * 60 * MINUTE;

describe('DatabaseSessionStore', () => {
  let db;
  let clock;
  let store;
  let get;
  let set;
  let touch;
  let destroy;
  let userId;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    await migrate(db, { logger: createSilentLogger() });
    userId = createUser(db, { username: 'session-owner' }).id;
    clock = { now: 1_700_000_000_000 };
    store = new DatabaseSessionStore({ db, idleMs: IDLE, absoluteMs: ABSOLUTE, now: () => clock.now });
    get = promisify(store.get.bind(store));
    set = promisify(store.set.bind(store));
    touch = promisify(store.touch.bind(store));
    destroy = promisify(store.destroy.bind(store));
  });

  afterEach(() => db.close());

  const rows = () => db.prepare('SELECT * FROM Sessions').all();
  const session = (extra = {}) => ({ cookie: { path: '/' }, userId, ...extra });

  it('stores the SHA-256 of the session id, never the id itself', async () => {
    await set('raw-session-id-123', session());
    const [row] = rows();
    assert.equal(row.SessionHash, hashSessionId('raw-session-id-123'));
    assert.match(row.SessionHash, /^[0-9a-f]{64}$/);
    const everything = JSON.stringify(rows());
    assert.ok(!everything.includes('raw-session-id-123'));
  });

  it('fills UserID from the session data and round-trips the data', async () => {
    await set('sid', session({ note: 'kept' }));
    assert.equal(rows()[0].UserID, userId);
    assert.deepEqual(await get('sid'), session({ note: 'kept' }));
    assert.equal(await get('unknown'), null);
  });

  it('expires a session left idle past the idle timeout, and deletes it', async () => {
    await set('sid', session());
    clock.now += IDLE - 1;
    assert.ok(await get('sid'));
    clock.now += 1;
    assert.equal(await get('sid'), null);
    assert.equal(rows().length, 0);
  });

  it('activity extends the idle window', async () => {
    await set('sid', session());
    for (let step = 0; step < 5; step++) {
      clock.now += IDLE - MINUTE;
      await touch('sid', session());
    }
    assert.ok(await get('sid'), 'still alive after 5 nearly idle periods');
  });

  it('expires a session at the absolute limit even when it stays active', async () => {
    await set('sid', session());
    const created = clock.now;
    while (clock.now + IDLE / 2 < created + ABSOLUTE) {
      clock.now += IDLE / 2;
      await touch('sid', session());
      assert.ok(await get('sid'));
    }
    assert.ok(rows()[0].ExpiresAt <= created + ABSOLUTE, 'never extended beyond the absolute limit');
    clock.now = created + ABSOLUTE;
    assert.equal(await get('sid'), null);
    assert.equal(rows().length, 0);
  });

  it('keeps CreatedAt when a session is saved again', async () => {
    await set('sid', session());
    const created = rows()[0].CreatedAt;
    clock.now += MINUTE;
    await set('sid', session({ changed: true }));
    assert.equal(rows()[0].CreatedAt, created);
    assert.equal(rows()[0].LastSeenAt, clock.now);
  });

  it('destroy deletes the row', async () => {
    await set('sid', session());
    await destroy('sid');
    assert.equal(rows().length, 0);
  });

  it('destroyForUser deletes every session of that user only', async () => {
    const other = createUser(db, { username: 'someone-else' }).id;
    await set('a', session());
    await set('b', session());
    await set('c', session({ userId: other }));
    assert.equal(store.destroyForUser(userId), 2);
    assert.deepEqual(
      rows().map((row) => row.UserID),
      [other]
    );
  });

  it('deleteExpired removes idle and over-age sessions and keeps live ones', async () => {
    await set('old', session());
    clock.now += MINUTE / 2;
    await set('fresh', session());
    clock.now += IDLE - MINUTE / 2 + 1;
    assert.equal(store.deleteExpired(), 1);
    assert.equal(rows().length, 1);
    assert.ok(await get('fresh'));
  });

  it('cleans up expired rows opportunistically on write, at most once a minute', async () => {
    await set('old', session());
    clock.now += IDLE + 1;
    await set('trigger', session());
    assert.equal(rows().length, 1, 'the expired row was removed on write');

    await set('old-2', session());
    clock.now += IDLE + 1;
    await set('trigger-2', session());
    // More than a minute has passed since the last cleanup, so this write cleaned up again.
    assert.equal(rows().length, 1);

    await set('old-3', session());
    await set('trigger-3', session());
    assert.equal(rows().length, 3, 'no second cleanup within the same minute');
  });
});
