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

function respondWithRouteError(res, err) {
  if (err instanceof RequestValidationError || err?.status) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  return res.status(500).json({ error: err.message || 'Internal server error' });
}

module.exports = {
  asyncRoute,
  RequestValidationError,
  ensureEnum,
  getCompanyBlacklistState,
  optionalInteger,
  optionalDateString,
  optionalTrimmed,
  parseBooleanFlag,
  requiredTrimmed,
  resolveContactStatus,
  respondWithRouteError,
  todayDate,
};
