'use strict';

const crypto = require('node:crypto');
const { Store } = require('express-session');
const { createSessionsRepository } = require('../db/repositories/sessions-repository');

const CLEANUP_INTERVAL_MS = 60 * 1000;

/** The SHA-256 hex of a session identifier: the only form in which it is stored. */
function hashSessionId(sid) {
  return crypto.createHash('sha256').update(String(sid)).digest('hex');
}

/**
 * An express-session store backed by the Sessions table.
 *
 * A session expires after `idleMs` without use, and in any case `absoluteMs`
 * after it was created. A session past either limit is treated as absent and
 * deleted. Expired rows are also removed at most once a minute when a session
 * is written, and by deleteExpired(). Nothing here runs on a timer.
 */
class DatabaseSessionStore extends Store {
  /**
   * @param {object} options
   * @param {import('better-sqlite3').Database} options.db
   * @param {number} options.idleMs      idle timeout in milliseconds
   * @param {number} options.absoluteMs  absolute lifetime in milliseconds, from creation
   * @param {() => number} [options.now] clock in epoch milliseconds, replaceable in tests
   */
  constructor({ db, idleMs, absoluteMs, now = Date.now }) {
    super();
    this.repository = createSessionsRepository(db);
    this.idleMs = idleMs;
    this.absoluteMs = absoluteMs;
    this.now = now;
    this.lastCleanup = 0;
  }

  /** The expiry of a session last used at `lastSeenAt`: the idle limit, capped by the absolute limit. */
  expiryFor(createdAt, lastSeenAt) {
    return Math.min(lastSeenAt + this.idleMs, createdAt + this.absoluteMs);
  }

  isLive(row, now) {
    return now < row.ExpiresAt && now < row.CreatedAt + this.absoluteMs;
  }

  /** The stored row of a live session; an expired one is deleted and undefined returned. */
  liveRow(sid) {
    const hash = hashSessionId(sid);
    const row = this.repository.find(hash);
    if (!row) return undefined;
    if (this.isLive(row, this.now())) return row;
    this.repository.remove(hash);
    return undefined;
  }

  cleanupIfDue(now) {
    if (now - this.lastCleanup < CLEANUP_INTERVAL_MS) return;
    this.lastCleanup = now;
    this.deleteExpired();
  }

  get(sid, callback) {
    try {
      const row = this.liveRow(sid);
      callback(null, row ? JSON.parse(row.Data) : null);
    } catch (err) {
      callback(err);
    }
  }

  set(sid, session, callback) {
    try {
      const now = this.now();
      const existing = this.liveRow(sid);
      const createdAt = existing ? existing.CreatedAt : now;
      this.repository.save({
        hash: hashSessionId(sid),
        userId: Number.isInteger(session?.userId) ? session.userId : null,
        data: JSON.stringify(session),
        createdAt,
        lastSeenAt: now,
        expiresAt: this.expiryFor(createdAt, now),
      });
      this.cleanupIfDue(now);
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid, _session, callback) {
    try {
      const now = this.now();
      const existing = this.liveRow(sid);
      if (existing) this.repository.touch(existing.SessionHash, now, this.expiryFor(existing.CreatedAt, now));
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid, callback) {
    try {
      this.repository.remove(hashSessionId(sid));
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  /**
   * Delete every session of a user, so they are signed out everywhere at once.
   * @param {number} userId
   * @returns {number} the number of sessions deleted
   */
  destroyForUser(userId) {
    return this.repository.removeForUser(userId);
  }

  /**
   * Delete every session past its idle or absolute limit.
   * @returns {number} the number of sessions deleted
   */
  deleteExpired() {
    const now = this.now();
    return this.repository.removeExpired(now, now - this.absoluteMs);
  }
}

module.exports = { DatabaseSessionStore, hashSessionId };
