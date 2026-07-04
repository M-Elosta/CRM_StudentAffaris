class RequestValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'RequestValidationError';
    this.status = status;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function requiredTrimmed(value, field) {
  if (value === undefined || value === null) {
    throw new RequestValidationError(`${field} is required`);
  }

  const text = String(value).trim();
  if (!text) {
    throw new RequestValidationError(`${field} is required`);
  }

  return text;
}

function optionalTrimmed(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function optionalDateString(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function optionalInteger(value, field) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number.parseInt(String(value).trim(), 10);
  if (Number.isNaN(parsed)) {
    throw new RequestValidationError(`${field} must be a whole number`);
  }

  return parsed;
}

function parseBooleanFlag(value) {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0 || value === null || value === undefined || value === '') return 0;

  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return 1;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return 0;

  return 0;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function ensureEnum(value, allowed, field) {
  const text = requiredTrimmed(value, field);
  if (!allowed.includes(text)) {
    throw new RequestValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  }

  return text;
}

function getCompanyBlacklistState(db, companyId) {
  const company = db.prepare('SELECT Blacklisted FROM Company WHERE CompanyID = ?').get(companyId);
  return company ? Number(company.Blacklisted) === 1 : false;
}

function resolveContactStatus(db, companyId, status) {
  if (getCompanyBlacklistState(db, companyId)) {
    return 'Non-mailable';
  }

  if (status === undefined || status === null || status === '') {
    return 'Mailable';
  }

  return ensureEnum(status, ['Mailable', 'Non-mailable'], 'Status');
}

// Express router.param handler for numeric :id params.
// Usage: router.param('id', idParam);  → 400 on non-numeric ids.
function idParam(req, res, next, value) {
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (Number.isNaN(parsed)) {
    return res.status(400).json({ error: 'Invalid id parameter' });
  }
  req.params.id = parsed;
  next();
}

const CONFLICT_MESSAGE = 'This record was changed by someone else while you were editing. Please reload and try again.';

// Optimistic concurrency check for PUT routes.
// If the client sent an UpdatedAt value, compare it (trimmed string compare)
// against the row's current UpdatedAt. Responds 404 if the row is missing and
// 409 on mismatch, returning false so the caller can bail out. Returns true
// when the update may proceed (including when no UpdatedAt was provided —
// backward compatible). `table` and `idColumn` must be code literals, never
// user input.
function checkUpdateConflict(db, table, idColumn, id, clientUpdatedAt, res, notFoundMessage = 'Not found') {
  const provided = clientUpdatedAt === undefined || clientUpdatedAt === null
    ? ''
    : String(clientUpdatedAt).trim();
  if (!provided) return true;

  const row = db.prepare(`SELECT UpdatedAt FROM ${table} WHERE ${idColumn} = ?`).get(id);
  if (!row) {
    res.status(404).json({ error: notFoundMessage });
    return false;
  }

  const current = row.UpdatedAt === undefined || row.UpdatedAt === null
    ? ''
    : String(row.UpdatedAt).trim();
  if (provided !== current) {
    res.status(409).json({ error: CONFLICT_MESSAGE });
    return false;
  }

  return true;
}

function respondWithRouteError(res, err) {
  if (err instanceof RequestValidationError || err?.status) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  return res.status(500).json({ error: err.message || 'Internal server error' });
}

module.exports = {
  asyncRoute,
  RequestValidationError,
  checkUpdateConflict,
  ensureEnum,
  getCompanyBlacklistState,
  idParam,
  optionalInteger,
  optionalDateString,
  optionalTrimmed,
  parseBooleanFlag,
  requiredTrimmed,
  resolveContactStatus,
  respondWithRouteError,
  todayDate,
};
