'use strict';

/**
 * Permission checks for the services. Each check takes the request context
 * ({ user, requestId, ip }) and throws when the signed-in user may not do
 * the thing, with a message that says what is not allowed and who to ask.
 * Who may do what is defined only in ./permissions.js.
 */

const { ForbiddenError, UnauthorizedError } = require('../lib/errors');
const defaultPermissions = require('./permissions');

const { ALL_PERMISSIONS, PERMISSIONS, ROLE_LABELS, normalizeRole } = defaultPermissions;
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
  [P.RECORD_RESTORE]: 'restore',
  [P.RECORD_PURGE]: 'permanently delete',
});

/** What each general permission allows, as used in messages. */
const PERMISSION_ACTIONS = Object.freeze({
  [P.SENSITIVE_READ]: 'see personal contact details or student data',
  [P.REPORTS_VIEW]: 'view reports',
  [P.EXPORT_RUN]: 'export data',
  [P.IMPORT_RUN]: 'import data',
  [P.USERS_MANAGE]: 'manage user accounts',
  [P.TRASH_VIEW]: 'view the Trash',
});

/** The display label of a user's role, e.g. "Read-only". */
function roleLabelOf(user) {
  return ROLE_LABELS[normalizeRole(user?.role)];
}

/** The signed-in user of a request context; UnauthorizedError when there is none. */
function userOf(ctx) {
  if (!ctx?.user) throw new UnauthorizedError('Not authenticated');
  return ctx.user;
}

function forbidden(user, action) {
  return new ForbiddenError(
    `Your role (${roleLabelOf(user)}) cannot ${action}. Ask an administrator if you need this.`
  );
}

/**
 * Build the checks around a permission module. Services use the default
 * instance; tests can pass a variant of the module to reach rules that the
 * real matrix makes unreachable.
 * @param {{ can: Function, canAccessRecord: Function }} [permissions]  defaults to ./permissions.js
 */
function createAuthorizer(permissions = defaultPermissions) {
  return {
    /** Every permission string the user holds. */
    permissionsOf(user) {
      return ALL_PERMISSIONS.filter((permission) => permissions.can(user, permission));
    },

    /** Whether the context's user holds the permission (false without a user). */
    has(ctx, permission) {
      return permissions.can(ctx?.user, permission);
    },

    /** Whether the context's user may read this record type (false without a user). */
    canReadRecordType(ctx, recordType) {
      return permissions.canAccessRecord(ctx?.user, P.RECORD_READ, recordType);
    },

    /**
     * Throw unless the context's user holds the permission; returns the user.
     * @param {{ user: object }} ctx
     * @param {string} permission  a value of PERMISSIONS
     * @param {string} [action]  what the permission allows, for the message
     */
    requirePermission(ctx, permission, action = PERMISSION_ACTIONS[permission] ?? 'do this') {
      const user = userOf(ctx);
      if (!permissions.can(user, permission)) throw forbidden(user, action);
      return user;
    },

    /**
     * Throw unless the context's user holds the record permission for this
     * record type; returns the user.
     * @param {{ user: object }} ctx
     * @param {string} permission  RECORD_READ, RECORD_CREATE, RECORD_UPDATE or RECORD_DELETE
     * @param {string} recordType  e.g. 'career-events'
     */
    requireRecordAccess(ctx, permission, recordType) {
      const user = userOf(ctx);
      if (!permissions.canAccessRecord(user, permission, recordType)) {
        const verb = RECORD_VERBS[permission] ?? 'use';
        throw forbidden(user, `${verb} ${RECORD_TYPE_NAMES[recordType] ?? recordType}`);
      }
      return user;
    },
  };
}

module.exports = {
  createAuthorizer,
  roleLabelOf,
  userOf,
  ...createAuthorizer(),
};
