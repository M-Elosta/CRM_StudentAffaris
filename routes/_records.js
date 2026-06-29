const { conflictError, optionalTrimmedString, validationError } = require('./_validation');

const DB_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;
const STALE_RECORD_MESSAGE = 'This record was changed by someone else while you were editing. Please reload and try again.';

function normalizeTimestamp(value) {
  if (!value) return null;
  return String(value).replace('T', ' ').slice(0, 19);
}

function requireLoadedUpdatedAt(value) {
  const updatedAt = optionalTrimmedString(value, 'UpdatedAt', 32);
  if (!updatedAt) throw validationError('UpdatedAt is required when editing a record');
  const normalized = normalizeTimestamp(updatedAt);
  if (!DB_TIMESTAMP_RE.test(normalized)) {
    throw validationError('UpdatedAt must be a valid record timestamp');
  }
  return normalized;
}

async function ensureRecordNotStale(db, tableName, idColumn, idValue, loadedUpdatedAt, notFoundMessage = 'Record not found') {
  const row = (await db.prepare(`SELECT UpdatedAt FROM ${tableName} WHERE ${idColumn} = ?`).get(idValue));
  if (!row) {
    const err = new Error(notFoundMessage);
    err.statusCode = 404;
    throw err;
  }

  const loaded = requireLoadedUpdatedAt(loadedUpdatedAt);
  const current = normalizeTimestamp(row.UpdatedAt);
  if (current && current > loaded) {
    throw conflictError(STALE_RECORD_MESSAGE);
  }
}

module.exports = {
  STALE_RECORD_MESSAGE,
  ensureRecordNotStale,
};
