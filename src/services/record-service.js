'use strict';

const { z } = require('zod');
const { ConflictError, NotFoundError, ValidationError } = require('../lib/errors');
const { normalizeTimestamp, todayInTimeZone } = require('../lib/dates');
const { parseWith, recordTimestamp } = require('../validation/common');

const STALE_RECORD_MESSAGE =
  'This record was changed by someone else while you were editing. Please reload and try again.';

const versionSchema = z.object({ UpdatedAt: recordTimestamp() });

/**
 * The generic service behind the five CRUD endpoints of a record type.
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
 */
function createRecordService({ db, repository, definition, schema, lookups, timeZone, hooks = {}, now = () => new Date() }) {
  const today = () => todayInTimeZone(timeZone, now());

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

  /** Validate a request body and check its references. Returns the values to save. */
  function validate(body) {
    const values = parseWith(schema.bodySchema, body ?? {});
    resolveReferences(values);
    return values;
  }

  /** Fill empty "defaults to today" columns: from the stored record when editing, else today. */
  function applyDateDefaults(values, existing, currentDay) {
    for (const column of definition.todayDefaults) {
      if (values[column] === null || values[column] === undefined) values[column] = existing?.[column] ?? currentDay;
    }
  }

  function save(id, body, { existing, currentDay }) {
    const values = parseWith(schema.bodySchema, body ?? {});
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

  const createInTransaction = db.transaction((body, currentDay) => save(null, body, { existing: null, currentDay }));

  const updateInTransaction = db.transaction((id, body, currentDay, { checkVersion }) => {
    const storedUpdatedAt = repository.getUpdatedAt(id);
    if (storedUpdatedAt === undefined) throw notFound();
    if (checkVersion) {
      const loaded = parseWith(versionSchema, body ?? {}).UpdatedAt;
      const current = normalizeTimestamp(storedUpdatedAt);
      // Any difference means the record was saved again after this copy was loaded.
      if (current && current !== loaded) throw new ConflictError(STALE_RECORD_MESSAGE);
    }
    return save(id, body, { existing: repository.getStoredById(id), currentDay });
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
    validate,

    /** Records matching already validated list filters. */
    list(filters) {
      return repository.list(filters);
    },

    /** One record in the list shape; NotFoundError when it does not exist. */
    get(id) {
      const record = repository.getById(id);
      if (!record) throw notFound();
      return record;
    },

    /** Validate and insert a record (with its child arrays); returns it as stored. */
    create(body) {
      return createInTransaction(body, today());
    },

    /**
     * Validate and save an edit. The body must carry the UpdatedAt the edit was
     * based on; a different stored value means someone else saved first (409).
     */
    update(id, body) {
      return updateInTransaction(id, body, today(), { checkVersion: true });
    },

    /** Replace an existing record in place without the version check (used by import "overwrite"). */
    overwrite(id, body) {
      return updateInTransaction(id, body, today(), { checkVersion: false });
    },

    /** Delete a record; returns the response body describing the deletion. */
    remove(id) {
      return removeInTransaction(id);
    },
  };
}

module.exports = { createRecordService, STALE_RECORD_MESSAGE };
