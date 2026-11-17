'use strict';

/**
 * Data access for the Sessions table. Sessions are keyed by the SHA-256 of
 * their identifier (the caller hashes); times are epoch milliseconds.
 * @param {import('better-sqlite3').Database} db
 */
function createSessionsRepository(db) {
  const statements = {
    find: db.prepare('SELECT * FROM Sessions WHERE SessionHash = ?'),
    upsert: db.prepare(
      `INSERT INTO Sessions (SessionHash, UserID, Data, CreatedAt, LastSeenAt, ExpiresAt)
       VALUES (@hash, @userId, @data, @createdAt, @lastSeenAt, @expiresAt)
       ON CONFLICT (SessionHash) DO UPDATE SET
         UserID = excluded.UserID, Data = excluded.Data,
         LastSeenAt = excluded.LastSeenAt, ExpiresAt = excluded.ExpiresAt`
    ),
    touch: db.prepare('UPDATE Sessions SET LastSeenAt = ?, ExpiresAt = ? WHERE SessionHash = ?'),
    remove: db.prepare('DELETE FROM Sessions WHERE SessionHash = ?'),
    removeForUser: db.prepare('DELETE FROM Sessions WHERE UserID = ?'),
    removeForUserExcept: db.prepare('DELETE FROM Sessions WHERE UserID = ? AND SessionHash <> ?'),
    removeExpired: db.prepare('DELETE FROM Sessions WHERE ExpiresAt <= ? OR CreatedAt <= ?'),
  };

  return {
    /** The row of one session, or undefined. */
    find: (hash) => statements.find.get(hash),

    /**
     * Insert a session or replace its data and times. CreatedAt is kept for an existing row.
     * @param {{ hash: string, userId: number|null, data: string, createdAt: number, lastSeenAt: number, expiresAt: number }} row
     */
    save: (row) => statements.upsert.run(row).changes,

    /** Record activity on a session: new last-seen and expiry times. */
    touch: (hash, lastSeenAt, expiresAt) => statements.touch.run(lastSeenAt, expiresAt, hash).changes,

    /** Delete one session; returns the number of deleted rows. */
    remove: (hash) => statements.remove.run(hash).changes,

    /** Delete every session of a user, or every one except `exceptHash`; returns the number deleted. */
    removeForUser: (userId, exceptHash) =>
      exceptHash
        ? statements.removeForUserExcept.run(userId, exceptHash).changes
        : statements.removeForUser.run(userId).changes,

    /** Delete sessions past their expiry or created at or before `createdBefore`; returns the number deleted. */
    removeExpired: (now, createdBefore) => statements.removeExpired.run(now, createdBefore).changes,
  };
}

module.exports = { createSessionsRepository };
