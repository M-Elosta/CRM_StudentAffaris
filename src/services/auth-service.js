'use strict';

const bcrypt = require('bcrypt');
const { UnauthorizedError, ValidationError } = require('../lib/errors');
const { isInsecurePassword } = require('../lib/password-policy');
const { normalizeRole } = require('../lib/roles');
const { BCRYPT_COST } = require('./users-service');

/**
 * Sign-in and password changes. Sessions themselves stay with the route.
 * @param {object} deps
 * @param {ReturnType<import('../db/repositories/users-repository').createUsersRepository>} deps.usersRepository
 */
function createAuthService({ usersRepository }) {
  return {
    /**
     * Check a username and password. Signing in with a known insecure password
     * flags the account for a password change.
     * @returns {Promise<{ userId: number, username: string, role: string, mustChangePassword: boolean }>}
     */
    async login(username, password) {
      const user = usersRepository.findByUsername(username);
      const match = user ? await bcrypt.compare(password, user.PasswordHash) : false;
      if (!user || !match) throw new UnauthorizedError('Invalid username or password');

      const mustChangePassword = Boolean(user.MustChangePassword) || isInsecurePassword(password);
      if (mustChangePassword && !user.MustChangePassword) usersRepository.requirePasswordChange(user.UserID);

      return { userId: user.UserID, username: user.Username, role: normalizeRole(user.Role), mustChangePassword };
    },

    /** Replace a user's password after checking the current one. */
    async changePassword(userId, currentPassword, newPassword) {
      if (isInsecurePassword(newPassword)) {
        throw new ValidationError('Choose a stronger password than the default one.');
      }
      if (newPassword === currentPassword) {
        throw new ValidationError('New password must be different from the current password.');
      }
      const user = usersRepository.findById(userId);
      const match = user ? await bcrypt.compare(currentPassword, user.PasswordHash) : false;
      if (!match) throw new UnauthorizedError('Current password is incorrect');

      usersRepository.updatePassword(userId, await bcrypt.hash(newPassword, BCRYPT_COST));
    },
  };
}

module.exports = { createAuthService };
