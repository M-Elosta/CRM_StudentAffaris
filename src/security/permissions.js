'use strict';

/**
 * Roles and permissions.
 *
 * This module is the single definition of who may do what. Routes and services
 * ask it; they never compare role names themselves. Everything here is
 * enforced on the server. Hiding a button in the interface is a courtesy, not
 * a control.
 *
 * Roles
 *   admin           Runs the system: users, settings, audit log, privacy requests, merges, purge.
 *   staff           Employer Relations staff: full day-to-day work on all records.
 *   readonly        Leadership: sees everything, changes nothing, may export reports.
 *   student_worker  Student employee: data entry on employers' activity only.
 *                   No personal contact details, no student data, no exports, no deletes.
 */

const ROLES = Object.freeze({
  ADMIN: 'admin',
  STAFF: 'staff',
  READONLY: 'readonly',
  STUDENT_WORKER: 'student_worker',
});

const ROLE_LABELS = Object.freeze({
  admin: 'Admin',
  staff: 'Staff',
  readonly: 'Read-only',
  student_worker: 'Student Worker',
});

/** Least privileged first. Used when an unknown role must be mapped to something safe. */
const ROLE_ORDER = Object.freeze([ROLES.STUDENT_WORKER, ROLES.READONLY, ROLES.STAFF, ROLES.ADMIN]);

/** Record types, keyed the way the rest of the application refers to them. */
const RECORD_TYPES = Object.freeze([
  'companies',
  'contacts',
  'outreach',
  'recruitment',
  'career-events',
  'student-events',
  'academic',
  'hiring-feedback',
  'collaboration',
  'tasks',
  'notes',
]);

const PERMISSIONS = Object.freeze({
  // Records. Checked together with a record type, see canAccessRecord().
  RECORD_READ: 'record:read',
  RECORD_CREATE: 'record:create',
  RECORD_UPDATE: 'record:update',
  RECORD_DELETE: 'record:delete', // soft delete: recoverable
  RECORD_RESTORE: 'record:restore',
  RECORD_PURGE: 'record:purge', // permanent removal
  SENSITIVE_READ: 'sensitive:read', // personal contact details and student data

  HISTORY_VIEW: 'history:view', // "last edited by" and the change history of a record
  TRASH_VIEW: 'trash:view',

  REPORTS_VIEW: 'reports:view',
  EXPORT_RUN: 'export:run',
  IMPORT_RUN: 'import:run',
  DUPLICATES_MERGE: 'duplicates:merge',

  USERS_MANAGE: 'users:manage',
  AUDIT_VIEW: 'audit:view',
  SETTINGS_MANAGE: 'settings:manage',
  PRIVACY_MANAGE: 'privacy:manage', // export or erase everything held about one person
});
const P = PERMISSIONS;

const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.ADMIN]: new Set(ALL_PERMISSIONS),

  [ROLES.STAFF]: new Set([
    P.RECORD_READ,
    P.RECORD_CREATE,
    P.RECORD_UPDATE,
    P.RECORD_DELETE,
    P.RECORD_RESTORE,
    P.SENSITIVE_READ,
    P.HISTORY_VIEW,
    P.TRASH_VIEW,
    P.REPORTS_VIEW,
    P.EXPORT_RUN,
    P.IMPORT_RUN,
  ]),

  [ROLES.READONLY]: new Set([P.RECORD_READ, P.SENSITIVE_READ, P.HISTORY_VIEW, P.REPORTS_VIEW, P.EXPORT_RUN]),

  [ROLES.STUDENT_WORKER]: new Set([P.RECORD_READ, P.RECORD_CREATE, P.RECORD_UPDATE, P.REPORTS_VIEW]),
});

/**
 * Student workers are limited by record type as well as by action.
 * A type missing from a list is not available to them at all.
 */
const STUDENT_WORKER_RECORD_ACCESS = Object.freeze({
  [P.RECORD_READ]: new Set([
    'companies',
    'contacts', // names, employers and job titles only; see SENSITIVE_FIELDS
    'outreach',
    'recruitment',
    'career-events',
    'academic',
    'collaboration',
    'tasks',
    'notes',
  ]),
  [P.RECORD_CREATE]: new Set(['outreach', 'recruitment', 'career-events', 'tasks', 'notes']),
  [P.RECORD_UPDATE]: new Set(['outreach', 'recruitment', 'career-events', 'tasks', 'notes']),
});

/**
 * Fields that hold personal contact details, student data or internal
 * judgements. A role without SENSITIVE_READ receives these as null and is told
 * which fields were withheld. Reading them is recorded in the audit log.
 */
const SENSITIVE_FIELDS = Object.freeze({
  companies: ['Comment'],
  contacts: ['EmailAddress', 'WorkPhone', 'Mobile', 'Address', 'LinkedInURL', 'HandshakeURL'],
  outreach: [],
  recruitment: [],
  'career-events': [],
  'student-events': ['StudentName', 'StudentEmail', 'StudentPhoneNumber'],
  academic: ['Email', 'PhoneNumber'],
  'hiring-feedback': ['HiredStudentName', 'Comment'],
  collaboration: [],
  tasks: [],
  notes: [],
});

function isKnownRole(role) {
  return Object.hasOwn(ROLE_PERMISSIONS, role);
}

/**
 * Map whatever is stored for a user to a role this module knows.
 * The legacy value "viewer" is the old name of Read-only. Anything
 * unrecognised gets the least privileged role, never more.
 */
function normalizeRole(role) {
  if (role === 'viewer') return ROLES.READONLY;
  return isKnownRole(role) ? role : ROLES.STUDENT_WORKER;
}

function roleOf(user) {
  return normalizeRole(typeof user === 'string' ? user : user?.role);
}

/** A deactivated or missing user can do nothing, whatever their role. */
function isUsable(user) {
  if (typeof user === 'string') return true;
  return Boolean(user) && user.isActive !== false;
}

/** Does this user hold the permission at all? */
function can(user, permission) {
  if (!isUsable(user)) return false;
  return ROLE_PERMISSIONS[roleOf(user)].has(permission);
}

/** Does this user hold the permission for this type of record? */
function canAccessRecord(user, permission, recordType) {
  if (!can(user, permission)) return false;
  if (!RECORD_TYPES.includes(recordType)) return false;
  if (roleOf(user) !== ROLES.STUDENT_WORKER) return true;
  return STUDENT_WORKER_RECORD_ACCESS[permission]?.has(recordType) ?? false;
}

function sensitiveFieldsFor(recordType) {
  return SENSITIVE_FIELDS[recordType] ?? [];
}

/**
 * Return a copy of a record that is safe to show this user.
 * Withheld fields are set to null and named in `_withheld`, so the interface
 * can show "Restricted" instead of an empty value.
 */
function redactRecord(user, recordType, record) {
  if (!record || can(user, P.SENSITIVE_READ)) return record;
  const fields = sensitiveFieldsFor(recordType).filter((field) => field in record);
  if (!fields.length) return record;
  const copy = { ...record };
  for (const field of fields) copy[field] = null;
  copy._withheld = fields;
  return copy;
}

function redactRecords(user, recordType, records) {
  if (can(user, P.SENSITIVE_READ)) return records;
  return records.map((record) => redactRecord(user, recordType, record));
}

/** The record types a user may see, for building navigation and search. */
function readableRecordTypes(user) {
  return RECORD_TYPES.filter((type) => canAccessRecord(user, P.RECORD_READ, type));
}

/** Roles an administrator may assign. */
function assignableRoles() {
  return ROLE_ORDER.slice().reverse();
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  ROLE_ORDER,
  RECORD_TYPES,
  PERMISSIONS,
  ALL_PERMISSIONS,
  SENSITIVE_FIELDS,
  normalizeRole,
  isKnownRole,
  can,
  canAccessRecord,
  sensitiveFieldsFor,
  redactRecord,
  redactRecords,
  readableRecordTypes,
  assignableRoles,
};
