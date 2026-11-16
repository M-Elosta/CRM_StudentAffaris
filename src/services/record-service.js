'use strict';

const { z } = require('zod');
const { ConflictError, NotFoundError, ValidationError } = require('../lib/errors');
const { normalizeTimestamp, todayInTimeZone } = require('../lib/dates');
const { parseWith, recordTimestamp } = require('../validation/common');
const defaultPermissions = require('../security/permissions');
const { createAuthorizer } = require('../security/authorize');

const STALE_RECORD_MESSAGE =
  'This record was changed by someone else while you were editing. Please reload and try again.';

const versionSchema = z.object({ UpdatedAt: recordTimestamp() });

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * The generic service behind the five CRUD endpoints of a record type.
 *
 * Every method takes the request context ({ user, requestId, ip }) as its last
 * argument and checks the user's permission for this record type first.
 * Everything returned is redacted for that user: a user who may not read
 * sensitive fields gets them as null and named in `_withheld`, cannot search
 * by them, and cannot change them (they keep their stored value on update and
 * are stored as null on create).
 *
 * Every write runs in one transaction, child tables included, so a failure
 * part-way leaves nothing behind.
 *
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {ReturnType<import('../db/repositories/crud-repository').createCrudRepository>} deps.repository
 * @param {object} deps.definition  the record type definition (src/domain/record-types.js)
 * @param {{ bodySchema: import('zod').ZodType }} deps.schema  the record type's validation module
 * @param {{ findCompany: Function, findContact: Function }} deps.lookups  stored company/contact by id
 * @param {string} deps.timeZone  the office time zone; "today" is computed in it once per call
 * @param {object} [deps.hooks]
 * @param {(values: object, context: object) => void} [deps.hooks.beforeWrite]  adjust values before saving
 * @param {(id: number, values: object, context: object) => void} [deps.hooks.afterWrite]  follow-up writes
 * @param {(stored: object) => object} [deps.hooks.describeRemoval]  response body for a deletion
 * @param {() => Date} [deps.now]  clock, replaceable in tests
 * @param {object} [deps.permissions]  the permission module (src/security/permissions.js), replaceable in tests
 */
function createRecordService({
  db,
  repository,
  definition,
  schema,
  lookups,
  timeZone,
  hooks = {},
  now = () => new Date(),
  permissions = defaultPermissions,
}) {
  const { PERMISSIONS: P } = defaultPermissions;
  const recordType = definition.path;
  const authorize = createAuthorizer(permissions);
  const today = () => todayInTimeZone(timeZone, now());

  /** Sensitive fields that are columns of this record type, and joined columns that carry sensitive values. */
  const sensitiveColumns = permissions
    .sensitiveFieldsFor(recordType)
    .filter((field) => definition.columns.includes(field));
  const withheldJoined = definition.list.withheldColumns ?? [];
  const withheldForSearch = [...permissions.sensitiveFieldsFor(recordType), ...withheldJoined];

  const seesSensitive = (user) => permissions.can(user, P.SENSITIVE_READ);

  /** A record as this user may see it. */
  function present(user, record) {
    if (!record || seesSensitive(user)) return record;
    const redacted = permissions.redactRecord(user, recordType, record);
    const joined = withheldJoined.filter((column) => column in redacted);
    if (!joined.length) return redacted;
    const copy = { ...redacted };
    for (const column of joined) copy[column] = null;
    copy._withheld = [...(redacted._withheld ?? []), ...joined];
    return copy;
  }

  /** The body with every sensitive field replaced by its stored value (or null) for a user who may not read them. */
  function protectSensitive(user, body, existing) {
    if (seesSensitive(user) || !isPlainObject(body) || !sensitiveColumns.length) return body;
    const copy = { ...body };
    for (const field of sensitiveColumns) copy[field] = existing ? existing[field] : null;
    delete copy._withheld;
    return copy;
  }

  function notFound() {
    return new NotFoundError(definition.notFoundMessage);
  }

  /** Make sure the employer and contact a record points to exist and belong together. */
  function resolveReferences(values) {
    const found = { company: null, contact: null };
    if (definition.references.company) {
      found.company = lookups.findCompany(values.CompanyID);
      if (!found.company) {
        const message = 'The selected employer does not exist';
        throw new ValidationError(message, { CompanyID: message });
      }
    }
    if (definition.references.contact) {
      found.contact = lookups.findContact(values.ContactID);
      if (!found.contact) {
        const message = 'The selected contact does not exist';
        throw new ValidationError(message, { ContactID: message });
      }
      if (found.contact.CompanyID !== values.CompanyID) {
        const message = 'The selected contact does not belong to this employer';
        throw new ValidationError(message, { ContactID: message });
      }
    }
    return found;
  }

  /** Fill empty "defaults to today" columns: from the stored record when editing, else today. */
  function applyDateDefaults(values, existing, currentDay) {
    for (const column of definition.todayDefaults) {
      if (values[column] === null || values[column] === undefined) values[column] = existing?.[column] ?? currentDay;
    }
  }

  function save(id, body, { existing, currentDay, user }) {
    const values = parseWith(schema.bodySchema, protectSensitive(user, body ?? {}, existing));
    applyDateDefaults(values, existing, currentDay);
    const references = resolveReferences(values);
    const context = { today: currentDay, existing, ...references };
    hooks.beforeWrite?.(values, context);

    let recordId = id;
    if (existing) {
      repository.update(recordId, values);
    } else {
      recordId = repository.insert(values);
    }
    repository.replaceChildren(recordId, values);
    hooks.afterWrite?.(recordId, values, context);
    return repository.getStoredById(recordId);
  }

  const createInTransaction = db.transaction((body, currentDay, user) =>
    save(null, body, { existing: null, currentDay, user })
  );

  const updateInTransaction = db.transaction((id, body, currentDay, { checkVersion, user }) => {
    const storedUpdatedAt = repository.getUpdatedAt(id);
    if (storedUpdatedAt === undefined) throw notFound();
    if (checkVersion) {
      const loaded = parseWith(versionSchema, body ?? {}).UpdatedAt;
      const current = normalizeTimestamp(storedUpdatedAt);
      // Any difference means the record was saved again after this copy was loaded.
      if (current && current !== loaded) throw new ConflictError(STALE_RECORD_MESSAGE);
    }
    return save(id, body, { existing: repository.getStoredById(id), currentDay, user });
  });

  const removeInTransaction = db.transaction((id) => {
    const stored = repository.getStoredById(id);
    if (!stored) throw notFound();
    const summary = hooks.describeRemoval ? hooks.describeRemoval(stored) : { message: 'Deleted' };
    repository.remove(id);
    return summary;
  });

  return {
    definition,

    /** Throw a ValidationError unless the employer and contact that parsed values point to exist and match. */
    checkReferences(values) {
      resolveReferences(values);
    },

    /**
     * Records matching already validated list filters, as the user may see them.
     * @param {object} filters
     * @param {{ user: object }} ctx
     */
    list(filters, ctx) {
      const user = authorize.requireRecordAccess(ctx, P.RECORD_READ, recordType);
      const withheldColumns = seesSensitive(user) ? [] : withheldForSearch;
      return repository.list(filters, { withheldColumns }).map((record) => present(user, record));
    },

    /**
     * One page of the list screen, as the user may see it.
     * @param {{ filters?: object, sort?: string, dir?: string, page?: number, pageSize?: number }} query
     *   already validated; unknown sort keys fall back to the default sort
     * @param {{ user: object }} ctx
     * @returns {{ rows: object[], total: number, sort: string, dir: string, page: number, pageSize: number }}
     */
    page({ filters = {}, sort, dir, page = 1, pageSize = 25 } = {}, ctx) {
      const user = authorize.requireRecordAccess(ctx, P.RECORD_READ, recordType);
      const currentDay = today();
      const total = repository.count(filters, { user, today: currentDay });
      const pages = Math.max(1, Math.ceil(total / pageSize));
      const current = Math.min(Math.max(1, page), pages);
      const result = repository.page(filters, {
        sort,
        dir,
        limit: pageSize,
        offset: (current - 1) * pageSize,
        user,
        today: currentDay,
      });
      return {
        rows: result.rows.map((record) => present(user, record)),
        total,
        sort: result.sort,
        dir: result.dir,
        page: current,
        pageSize,
      };
    },

    /** One record in the list shape; NotFoundError when it does not exist. */
    get(id, ctx) {
      const user = authorize.requireRecordAccess(ctx, P.RECORD_READ, recordType);
      const record = repository.getById(id);
      if (!record) throw notFound();
      return present(user, record);
    },

    /** Validate and insert a record (with its child arrays); returns it as stored. */
    create(body, ctx) {
      const user = authorize.requireRecordAccess(ctx, P.RECORD_CREATE, recordType);
      return present(user, createInTransaction(body, today(), user));
    },

    /**
     * Validate and save an edit. The body must carry the UpdatedAt the edit was
     * based on; a different stored value means someone else saved first (409).
     */
    update(id, body, ctx) {
      const user = authorize.requireRecordAccess(ctx, P.RECORD_UPDATE, recordType);
      return present(user, updateInTransaction(id, body, today(), { checkVersion: true, user }));
    },

    /** Replace an existing record in place without the version check (used by import "overwrite"). */
    overwrite(id, body, ctx) {
      const user = authorize.requireRecordAccess(ctx, P.RECORD_UPDATE, recordType);
      return present(user, updateInTransaction(id, body, today(), { checkVersion: false, user }));
    },

    /** Delete a record; returns the response body describing the deletion. */
    remove(id, ctx) {
      authorize.requireRecordAccess(ctx, P.RECORD_DELETE, recordType);
      return removeInTransaction(id);
    },
  };
}

module.exports = { createRecordService, STALE_RECORD_MESSAGE };
