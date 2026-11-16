'use strict';

const bcrypt = require('bcrypt');
const { ConflictError, ForbiddenError, NotFoundError } = require('../lib/errors');
const { isInsecurePassword } = require('../lib/password-policy');
const { ROLES } = require('../security/permissions');

const BCRYPT_COST = 12;

/**
 * User administration rules: no one changes their own role, deletes or
 * deactivates their own account, the last admin can be neither demoted nor
 * removed, the last active admin cannot be deactivated, and usernames are
 * unique. Deactivating an account ends all of its sessions at once.
 *
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {ReturnType<import('../db/repositories/users-repository').createUsersRepository>} deps.usersRepository
 * @param {ReturnType<import('../db/repositories/sessions-repository').createSessionsRepository>} [deps.sessionsRepository]
 */
function createUsersService({ db, usersRepository, sessionsRepository }) {
  const deactivateInTransaction = db.transaction((actingUserId, targetId) => {
    const target = usersRepository.findById(targetId);
    if (!target) throw new NotFoundError('User not found.');
    if (target.IsActive !== 1) return false;
    if (target.Role === ROLES.ADMIN && usersRepository.countActiveAdmins() <= 1) {
      throw new ForbiddenError('Cannot deactivate the last active admin account.');
    }
    usersRepository.deactivate(targetId, actingUserId);
    sessionsRepository.removeForUser(targetId);
    return true;
  });

  const reactivateInTransaction = db.transaction((targetId) => {
    const target = usersRepository.findById(targetId);
    if (!target) throw new NotFoundError('User not found.');
    return usersRepository.reactivate(targetId) > 0;
  });

  function ensureNotLastAdmin(target) {
    if (target.Role === ROLES.ADMIN && usersRepository.countAdmins() <= 1) {
      throw new ForbiddenError('Cannot remove the last admin account.');
    }
  }

  const changeRoleInTransaction = db.transaction((targetId, role) => {
    if (role !== ROLES.ADMIN) {
      const target = usersRepository.findById(targetId);
      if (!target) throw new NotFoundError('User not found.');
      ensureNotLastAdmin(target);
    }
    if (!usersRepository.updateRole(targetId, role)) throw new NotFoundError('User not found.');
  });

  const removeInTransaction = db.transaction((targetId) => {
    const target = usersRepository.findById(targetId);
    if (!target) throw new NotFoundError('User not found.');
    ensureNotLastAdmin(target);
    usersRepository.remove(targetId);
  });

  return {
    /** Every account (id, username, role, created), oldest first. */
    list() {
      return usersRepository.list();
    },

    /**
     * Create an account with a bcrypt-hashed password.
     * @param {{ username: string, password: string, role: string }} user  already validated
     */
    async create({ username, password, role }) {
      if (usersRepository.findByUsername(username)) throw new ConflictError('Username already exists.');
      const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
      try {
        const id = usersRepository.insert({
          username,
          passwordHash,
          role,
          mustChangePassword: isInsecurePassword(password),
        });
        return { UserID: id, Username: username, Role: role };
      } catch (err) {
        // Another request created the same username while the hash was computed.
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new ConflictError('Username already exists.');
        throw err;
      }
    },

    /** Change another user's role. */
    changeRole(actingUserId, targetId, role) {
      if (targetId === actingUserId) throw new ForbiddenError('Cannot change your own role.');
      changeRoleInTransaction(targetId, role);
    },

    /** Every account with its display name, status and last sign-in, for the administration page. */
    listAccounts() {
      return usersRepository.listAccounts();
    },

    /** One account in the administrator's view; NotFoundError when it does not exist. */
    findAccount(targetId) {
      const account = usersRepository.findPublicById(targetId);
      if (!account) throw new NotFoundError('User not found.');
      return account;
    },

    /**
     * Deactivate another user's account and end its sessions, in one
     * transaction. The account can no longer sign in. Returns false when it was
     * already deactivated.
     */
    deactivate(actingUserId, targetId) {
      if (targetId === actingUserId) throw new ForbiddenError('You cannot deactivate your own account.');
      return deactivateInTransaction(actingUserId, targetId);
    },

    /** Let a deactivated account sign in again. Returns false when it was already active. */
    reactivate(actingUserId, targetId) {
      if (targetId === actingUserId) throw new ForbiddenError('You cannot reactivate your own account.');
      return reactivateInTransaction(targetId);
    },

    /** Delete another user's account. */
    remove(actingUserId, targetId) {
      if (targetId === actingUserId) throw new ForbiddenError('Cannot delete your own account.');
      removeInTransaction(targetId);
    },
  };
}

module.exports = { createUsersService, BCRYPT_COST };
