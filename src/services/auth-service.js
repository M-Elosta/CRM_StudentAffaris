'use strict';

const bcrypt = require('bcrypt');
const { UnauthorizedError, ValidationError } = require('../lib/errors');
const { isInsecurePassword } = require('../lib/password-policy');
const { normalizeRole } = require('../security/permissions');
const { userOf } = require('../security/authorize');
const { hashSessionId } = require('../security/session-store');
const { BCRYPT_COST } = require('./users-service');

const INVALID_CREDENTIALS = 'Invalid username or password';

/** A compared-against hash, so an unknown username takes as long as a wrong password. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

/** The signed-in user as the rest of the application sees it (req.user). */
function toCurrentUser(row) {
  return {
    id: row.UserID,
    username: row.Username,
    displayName: row.DisplayName ?? null,
    email: row.Email ?? null,
    role: normalizeRole(row.Role),
    isActive: row.IsActive === 1,
    mustChangePassword: Boolean(row.MustChangePassword),
  };
}

/**
 * Sign-in, the current user of a session, and password changes.
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {ReturnType<import('../db/repositories/users-repository').createUsersRepository>} deps.usersRepository
 * @param {ReturnType<import('../db/repositories/sessions-repository').createSessionsRepository>} deps.sessionsRepository
 */
function createAuthService({ db, usersRepository, sessionsRepository }) {
  const changePasswordInTransaction = db.transaction((userId, passwordHash, keepSessionId) => {
    usersRepository.updatePassword(userId, passwordHash);
    sessionsRepository.removeForUser(userId, keepSessionId ? hashSessionId(keepSessionId) : undefined);
  });

  return {
    /**
     * The active user with this id as req.user, or null when the account no
     * longer exists or is deactivated. Called on every request to build the
     * request context, so it takes none.
     * @param {number} userId
     */
    currentUser(userId) {
      const row = usersRepository.findById(userId);
      if (!row || row.IsActive !== 1) return null;
      return toCurrentUser(row);
    },

    /**
     * Check a username and password and return the user. A deactivated account
     * gets the same answer as a wrong password. Signing in with a known
     * insecure password flags the account for a password change.
     * @param {string} username
     * @param {string} password
     * @param {{ requestId: string, ip: string }} _ctx  the request context (no user yet)
     */
    async login(username, password, _ctx) {
      const row = usersRepository.findByUsername(username);
      const match = await bcrypt.compare(password, row ? row.PasswordHash : DUMMY_HASH);
      if (!row || !match || row.IsActive !== 1) throw new UnauthorizedError(INVALID_CREDENTIALS);

      if (isInsecurePassword(password) && !row.MustChangePassword) {
        usersRepository.requirePasswordChange(row.UserID);
        row.MustChangePassword = 1;
      }
      usersRepository.recordLogin(row.UserID);
      return toCurrentUser(row);
    },

    /**
     * Replace the signed-in user's password after checking the current one,
     * and end every other session of that user.
     * @param {{ currentPassword: string, newPassword: string, keepSessionId?: string }} change
     * @param {{ user: object }} ctx
     */
    async changePassword({ currentPassword, newPassword, keepSessionId }, ctx) {
      const { id: userId } = userOf(ctx);
      if (isInsecurePassword(newPassword)) {
        throw new ValidationError('Choose a stronger password than the default one.');
      }
      if (newPassword === currentPassword) {
        throw new ValidationError('New password must be different from the current password.');
      }
      const row = usersRepository.findById(userId);
      const match = row ? await bcrypt.compare(currentPassword, row.PasswordHash) : false;
      if (!match) throw new UnauthorizedError('Current password is incorrect');

      changePasswordInTransaction(userId, await bcrypt.hash(newPassword, BCRYPT_COST), keepSessionId);
    },
  };
}

module.exports = { createAuthService, toCurrentUser };
