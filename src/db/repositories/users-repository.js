'use strict';

/**
 * Data access for the Users table.
 * @param {import('better-sqlite3').Database} db
 */
function createUsersRepository(db) {
  const statements = {
    count: db.prepare('SELECT COUNT(*) AS n FROM Users'),
    countAdmins: db.prepare("SELECT COUNT(*) AS n FROM Users WHERE Role = 'admin'"),
    list: db.prepare('SELECT UserID, Username, Role, CreatedAt FROM Users ORDER BY CreatedAt'),
    findById: db.prepare('SELECT * FROM Users WHERE UserID = ?'),
    findByUsername: db.prepare('SELECT * FROM Users WHERE Username = ?'),
    insert: db.prepare(
      'INSERT INTO Users (Username, PasswordHash, Role, MustChangePassword) VALUES (@username, @passwordHash, @role, @mustChangePassword)'
    ),
    updateRole: db.prepare('UPDATE Users SET Role = ? WHERE UserID = ?'),
    requirePasswordChange: db.prepare('UPDATE Users SET MustChangePassword = 1 WHERE UserID = ?'),
    updatePassword: db.prepare('UPDATE Users SET PasswordHash = ?, MustChangePassword = 0 WHERE UserID = ?'),
    remove: db.prepare('DELETE FROM Users WHERE UserID = ?'),
  };

  return {
    /** Number of user accounts. */
    count: () => statements.count.get().n,

    /** Number of accounts with the admin role. */
    countAdmins: () => statements.countAdmins.get().n,

    /** Every account without its password hash, oldest first. */
    list: () => statements.list.all(),

    /** The full row of one account, or undefined. */
    findById: (id) => statements.findById.get(id),

    /** The full row of the account with this exact username, or undefined. */
    findByUsername: (username) => statements.findByUsername.get(username),

    /**
     * Insert an account and return its id.
     * @param {{ username: string, passwordHash: string, role: string, mustChangePassword: boolean }} user
     */
    insert: ({ username, passwordHash, role, mustChangePassword }) =>
      Number(
        statements.insert.run({ username, passwordHash, role, mustChangePassword: mustChangePassword ? 1 : 0 })
          .lastInsertRowid
      ),

    /** Change an account's role; returns the number of changed rows. */
    updateRole: (id, role) => statements.updateRole.run(role, id).changes,

    /** Flag an account so its owner must change the password before doing anything else. */
    requirePasswordChange: (id) => statements.requirePasswordChange.run(id).changes,

    /** Store a new password hash and clear the change-password flag. */
    updatePassword: (id, passwordHash) => statements.updatePassword.run(passwordHash, id).changes,

    /** Delete an account; returns the number of deleted rows. */
    remove: (id) => statements.remove.run(id).changes,
  };
}

module.exports = { createUsersRepository };
