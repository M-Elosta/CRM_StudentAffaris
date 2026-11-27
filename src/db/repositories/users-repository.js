'use strict';

/** The columns an administrator sees: never the password hash or second-factor data. */
const PUBLIC_COLUMNS = `UserID, Username, DisplayName, Email, AndrewID, Role, IsActive, AuthProvider,
  LastLoginAt, CreatedAt, DeactivatedAt`;

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * Data access for the Users table.
 * @param {import('better-sqlite3').Database} db
 */
function createUsersRepository(db) {
  const statements = {
    count: db.prepare('SELECT COUNT(*) AS n FROM Users'),
    countAdmins: db.prepare("SELECT COUNT(*) AS n FROM Users WHERE Role = 'admin'"),
    remove: db.prepare('DELETE FROM Users WHERE UserID = ?'),
    countActiveAdmins: db.prepare("SELECT COUNT(*) AS n FROM Users WHERE Role = 'admin' AND IsActive = 1"),
    list: db.prepare('SELECT UserID, Username, Role, CreatedAt FROM Users ORDER BY CreatedAt'),
    listAccounts: db.prepare(
      `SELECT ${PUBLIC_COLUMNS} FROM Users ORDER BY IsActive DESC, COALESCE(DisplayName, Username) COLLATE NOCASE`
    ),
    findPublicById: db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM Users WHERE UserID = ?`),
    findById: db.prepare('SELECT * FROM Users WHERE UserID = ?'),
    findByUsername: db.prepare('SELECT * FROM Users WHERE Username = ?'),
    findIdByEmail: db.prepare('SELECT UserID FROM Users WHERE lower(Email) = lower(?)'),
    findIdByAndrewId: db.prepare('SELECT UserID FROM Users WHERE lower(AndrewID) = lower(?)'),
    insert: db.prepare(
      `INSERT INTO Users (Username, PasswordHash, Role, MustChangePassword, DisplayName, Email, AndrewID, CreatedBy, UpdatedAt)
       VALUES (@username, @passwordHash, @role, @mustChangePassword, @displayName, @email, @andrewId, @createdBy, ${NOW})`
    ),
    updateRole: db.prepare(`UPDATE Users SET Role = ?, UpdatedAt = ${NOW} WHERE UserID = ?`),
    requirePasswordChange: db.prepare('UPDATE Users SET MustChangePassword = 1 WHERE UserID = ?'),
    updatePassword: db.prepare(
      `UPDATE Users SET PasswordHash = ?, MustChangePassword = 0, PasswordChangedAt = ${NOW}, UpdatedAt = ${NOW}
       WHERE UserID = ?`
    ),
    recordLogin: db.prepare(`UPDATE Users SET LastLoginAt = ${NOW} WHERE UserID = ?`),
    deactivate: db.prepare(
      `UPDATE Users SET IsActive = 0, DeactivatedAt = ${NOW}, DeactivatedBy = ?, UpdatedAt = ${NOW}
       WHERE UserID = ? AND IsActive = 1`
    ),
    reactivate: db.prepare(
      `UPDATE Users SET IsActive = 1, DeactivatedAt = NULL, DeactivatedBy = NULL, UpdatedAt = ${NOW}
       WHERE UserID = ? AND IsActive = 0`
    ),
  };

  /** Profile columns that may be changed, API name → column. */
  const PROFILE_COLUMNS = { displayName: 'DisplayName', email: 'Email', andrewId: 'AndrewID', role: 'Role' };

  return {
    /** Number of user accounts. */
    count: () => statements.count.get().n,

    /** Number of accounts with the admin role. */
    countAdmins: () => statements.countAdmins.get().n,

    /** Delete an account; returns the number of deleted rows. */
    remove: (id) => statements.remove.run(id).changes,

    /** Number of active accounts with the admin role. */
    countActiveAdmins: () => statements.countActiveAdmins.get().n,

    /** Every account in the administrator's view, oldest first. */
    list: () => statements.list.all(),

    /** Every account in the administrator's view with its status and last sign-in, active ones first. */
    listAccounts: () => statements.listAccounts.all(),

    /** One account in the administrator's view, or undefined. */
    findPublicById: (id) => statements.findPublicById.get(id),

    /** The full row of one account, or undefined. */
    findById: (id) => statements.findById.get(id),

    /** The full row of the account with this exact username, or undefined. */
    findByUsername: (username) => statements.findByUsername.get(username),

    /** The id of the account with this email address, ignoring case, or undefined. */
    findIdByEmail: (email) => statements.findIdByEmail.get(email)?.UserID,

    /** The id of the account with this Andrew ID, ignoring case, or undefined. */
    findIdByAndrewId: (andrewId) => statements.findIdByAndrewId.get(andrewId)?.UserID,

    /**
     * Insert an account and return its id.
     * @param {{ username: string, passwordHash: string, role: string, mustChangePassword: boolean,
     *   displayName?: string|null, email?: string|null, andrewId?: string|null, createdBy?: number|null }} user
     */
    insert: ({ username, passwordHash, role, mustChangePassword, displayName, email, andrewId, createdBy }) =>
      Number(
        statements.insert.run({
          username,
          passwordHash,
          role,
          mustChangePassword: mustChangePassword ? 1 : 0,
          displayName: displayName ?? null,
          email: email ?? null,
          andrewId: andrewId ?? null,
          createdBy: createdBy ?? null,
        }).lastInsertRowid
      ),

    /**
     * Change the given profile fields of an account (displayName, email, andrewId, role);
     * fields left undefined keep their value. Returns the number of changed rows.
     */
    updateProfile(id, changes) {
      const entries = Object.entries(PROFILE_COLUMNS).filter(([key]) => changes[key] !== undefined);
      if (!entries.length) return statements.findById.get(id) ? 1 : 0;
      const assignments = entries.map(([key, column]) => `${column} = @${key}`).join(', ');
      const params = Object.fromEntries(entries.map(([key]) => [key, changes[key]]));
      return db.prepare(`UPDATE Users SET ${assignments}, UpdatedAt = ${NOW} WHERE UserID = @id`).run({ ...params, id })
        .changes;
    },

    /** Change an account's role; returns the number of changed rows. */
    updateRole: (id, role) => statements.updateRole.run(role, id).changes,

    /** Flag an account so its owner must change the password before doing anything else. */
    requirePasswordChange: (id) => statements.requirePasswordChange.run(id).changes,

    /** Store a new password hash and clear the change-password flag. */
    updatePassword: (id, passwordHash) => statements.updatePassword.run(passwordHash, id).changes,

    /** Record a successful sign-in now. */
    recordLogin: (id) => statements.recordLogin.run(id).changes,

    /** Mark an active account deactivated by `actorId`; returns the number of changed rows. */
    deactivate: (id, actorId) => statements.deactivate.run(actorId ?? null, id).changes,

    /** Make a deactivated account active again; returns the number of changed rows. */
    reactivate: (id) => statements.reactivate.run(id).changes,
  };
}

module.exports = { createUsersRepository };
