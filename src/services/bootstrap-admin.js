'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const { isInsecurePassword } = require('../lib/password-policy');

/**
 * Create the first administrator when the Users table is empty.
 *
 * Staging and production refuse to invent a password: one must be supplied in
 * BOOTSTRAP_ADMIN_PASSWORD. The password is never written to the log there.
 */
async function bootstrapAdmin(db, config, logger = console) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM Users').get();
  if (n > 0) return { created: false };

  if (config.isProductionLike && !config.bootstrapAdminPassword) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be set before the first start (no users exist yet)');
  }

  const password = config.bootstrapAdminPassword || crypto.randomBytes(18).toString('base64url');
  const hash = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO Users (Username, PasswordHash, Role, MustChangePassword) VALUES (?, ?, ?, ?)').run(
    config.bootstrapAdminUsername,
    hash,
    'admin',
    isInsecurePassword(password) ? 1 : 0
  );

  if (config.isProductionLike) {
    logger.info(`First administrator "${config.bootstrapAdminUsername}" created. Change the bootstrap password after signing in.`);
  } else if (!config.isTest) {
    logger.info(`First administrator created — username: ${config.bootstrapAdminUsername}, password: ${password}`);
  }
  return { created: true, username: config.bootstrapAdminUsername };
}

module.exports = { bootstrapAdmin };
