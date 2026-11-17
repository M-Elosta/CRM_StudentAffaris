'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const { isInsecurePassword } = require('../lib/password-policy');
const { ROLES } = require('../security/permissions');
const { createUsersRepository } = require('../db/repositories/users-repository');
const { BCRYPT_COST } = require('./users-service');

/**
 * Create the first administrator when the Users table is empty.
 *
 * Staging and production refuse to invent a password: one must be supplied in
 * BOOTSTRAP_ADMIN_PASSWORD. The password is never written to the log there.
 */
async function bootstrapAdmin(db, config, logger = console) {
  const usersRepository = createUsersRepository(db);
  if (usersRepository.count() > 0) return { created: false };

  if (config.isProductionLike && !config.bootstrapAdminPassword) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be set before the first start (no users exist yet)');
  }

  const password = config.bootstrapAdminPassword || crypto.randomBytes(18).toString('base64url');
  usersRepository.insert({
    username: config.bootstrapAdminUsername,
    passwordHash: await bcrypt.hash(password, BCRYPT_COST),
    role: ROLES.ADMIN,
    mustChangePassword: isInsecurePassword(password),
  });

  if (config.isProductionLike) {
    logger.info(
      `First administrator "${config.bootstrapAdminUsername}" created. Change the bootstrap password after signing in.`
    );
  } else if (!config.isTest) {
    logger.info(`First administrator created — username: ${config.bootstrapAdminUsername}, password: ${password}`);
  }
  return { created: true, username: config.bootstrapAdminUsername };
}

module.exports = { bootstrapAdmin };
