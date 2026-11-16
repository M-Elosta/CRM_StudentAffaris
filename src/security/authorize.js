'use strict';

/**
 * Permission checks for the services. Each check takes the request context
 * ({ user, requestId, ip }) and throws when the signed-in user may not do
 * the thing, with a message that says what is not allowed and who to ask.
 * Who may do what is defined only in ./permissions.js.
 */

const { ForbiddenError, UnauthorizedError } = require('../lib/errors');
const { ALL_PERMISSIONS, PERMISSIONS, ROLE_LABELS, can, canAccessRecord, normalizeRole } = require('./permissions');

const P = PERMISSIONS;

/** How each record type is named in messages. */
const RECORD_TYPE_NAMES = Object.freeze({
  companies: 'employers',
  contacts: 'contacts',
  outreach: 'outreach records',
  recruitment: 'recruitment postings',
  'career-events': 'career events',
  'student-events': 'student-led events',
  academic: 'academic engagements',
  'hiring-feedback': 'hiring feedback',
  collaboration: 'potential collaborations',
  tasks: 'tasks',
  notes: 'notes',
});

/** The verb of each record permission, as used in messages. */
const RECORD_VERBS = Object.freeze({
  [P.RECORD_READ]: 'view',
  [P.RECORD_CREATE]: 'add',
  [P.RECORD_UPDATE]: 'change',
  [P.RECORD_DELETE]: 'delete',
});

/** What each general permission allows, as used in messages. */
const PERMISSION_ACTIONS = Object.freeze({
  [P.SENSITIVE_READ]: 'see personal contact details or student data',
  [P.REPORTS_VIEW]: 'view reports',
  [P.EXPORT_RUN]: 'export data',
  [P.IMPORT_RUN]: 'import data',
  [P.USERS_MANAGE]: 'manage user accounts',
});

/** The display label of a user's role, e.g. "Read-only". */
function roleLabelOf(user) {
  return ROLE_LABELS[normalizeRole(user?.role)];
}

/** Every permission string the user holds. */
function permissionsOf(user) {
  return ALL_PERMISSIONS.filter((permission) => can(user, permission));
}

function forbidden(user, action) {
  return new ForbiddenError(
    `Your role (${roleLabelOf(user)}) cannot ${action}. Ask an administrator if you need this.`
  );
}

/** The signed-in user of a request context; UnauthorizedError when there is none. */
function userOf(ctx) {
  if (!ctx?.user) throw new UnauthorizedError('Not authenticated');
  return ctx.user;
}

/**
 * Throw unless the context's user holds the permission.
 * @param {{ user: object }} ctx
 * @param {string} permission  a value of PERMISSIONS
 * @param {string} [action]  what the permission allows, for the message
 */
function requirePermission(ctx, permission, action = PERMISSION_ACTIONS[permission] ?? 'do this') {
  const user = userOf(ctx);
  if (!can(user, permission)) throw forbidden(user, action);
  return user;
}

/**
 * Throw unless the context's user holds the record permission for this record type.
 * @param {{ user: object }} ctx
 * @param {string} permission  RECORD_READ, RECORD_CREATE, RECORD_UPDATE or RECORD_DELETE
 * @param {string} recordType  e.g. 'career-events'
 */
function requireRecordAccess(ctx, permission, recordType) {
  const user = userOf(ctx);
  if (!canAccessRecord(user, permission, recordType)) {
    const verb = RECORD_VERBS[permission] ?? 'use';
    throw forbidden(user, `${verb} ${RECORD_TYPE_NAMES[recordType] ?? recordType}`);
  }
  return user;
}

/** Whether the context's user may read this record type (false without a user). */
function canReadRecordType(ctx, recordType) {
  return canAccessRecord(ctx?.user, P.RECORD_READ, recordType);
}

module.exports = {
  roleLabelOf,
  permissionsOf,
  requirePermission,
  requireRecordAccess,
  canReadRecordType,
  userOf,
};
