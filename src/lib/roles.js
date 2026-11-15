'use strict';

const ROLES = Object.freeze({ ADMIN: 'admin', VIEWER: 'viewer' });

/** Anything that is not exactly "admin" is treated as the least-privileged role. */
function normalizeRole(role) {
  return role === ROLES.ADMIN ? ROLES.ADMIN : ROLES.VIEWER;
}

module.exports = { ROLES, normalizeRole };
