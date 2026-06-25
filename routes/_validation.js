const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME_RE = /^\d{2}:\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,64}$/;

function validationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function conflictError(message) {
  const err = new Error(message);
  err.statusCode = 409;
  return err;
}

function sendValidationError(res, err) {
  return res.status(err.statusCode || 400).json({ error: err.message });
}

function requirePositiveInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw validationError(`${name} must be a positive integer`);
  return n;
}

function optionalPositiveInt(value, name) {
  if (value === undefined || value === null || value === '') return null;
  return requirePositiveInt(value, name);
}

function requireTrimmedString(value, name, maxLength = 255) {
  if (typeof value !== 'string') throw validationError(`${name} is required`);
  const trimmed = value.trim();
  if (!trimmed) throw validationError(`${name} is required`);
  if (trimmed.length > maxLength) throw validationError(`${name} must be ${maxLength} characters or fewer`);
  return trimmed;
}

function optionalTrimmedString(value, name, maxLength = 255) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw validationError(`${name} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw validationError(`${name} must be ${maxLength} characters or fewer`);
  return trimmed;
}

function requireEnum(value, name, allowedValues) {
  if (!allowedValues.includes(value)) {
    throw validationError(`${name} must be one of: ${allowedValues.join(', ')}`);
  }
  return value;
}

function optionalEnum(value, name, allowedValues) {
  if (value === undefined || value === null || value === '') return null;
  return requireEnum(value, name, allowedValues);
}

function requireIsoDate(value, name) {
  const date = requireTrimmedString(value, name, 10);
  if (!ISO_DATE_RE.test(date)) throw validationError(`${name} must be in YYYY-MM-DD format`);
  return date;
}

function optionalIsoDate(value, name) {
  if (value === undefined || value === null || value === '') return null;
  return requireIsoDate(value, name);
}

function requireIsoTime(value, name) {
  const time = requireTrimmedString(value, name, 5);
  if (!ISO_TIME_RE.test(time)) throw validationError(`${name} must be in HH:MM format`);
  return time;
}

function requireEmail(value, name) {
  const email = requireTrimmedString(value, name, 254);
  if (!EMAIL_RE.test(email)) throw validationError(`${name} must be a valid email address`);
  return email;
}

function optionalHttpUrl(value, name, maxLength = 2048) {
  const url = optionalTrimmedString(value, name, maxLength);
  if (!url) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    throw validationError(`${name} must be a valid http or https URL`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw validationError(`${name} must be a valid http or https URL`);
  }

  return parsed.toString();
}

function requireUsername(value) {
  const username = requireTrimmedString(value, 'Username', 64);
  if (!USERNAME_RE.test(username)) {
    throw validationError('Username must be 3-64 characters and contain only letters, numbers, dot, underscore, or hyphen');
  }
  return username;
}

function requirePassword(value, name = 'Password') {
  if (typeof value !== 'string' || value.length < 12) {
    throw validationError(`${name} must be at least 12 characters`);
  }
  return value;
}

function requireString(value, name, maxLength = 1024) {
  if (typeof value !== 'string' || value.length === 0) {
    throw validationError(`${name} is required`);
  }
  if (value.length > maxLength) {
    throw validationError(`${name} must be ${maxLength} characters or fewer`);
  }
  return value;
}

function optionalStringArray(value, name, { maxItems = 50, maxItemLength = 100, allowedValues = null } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw validationError(`${name} must be an array`);
  if (value.length > maxItems) throw validationError(`${name} must contain at most ${maxItems} values`);
  return value.map((item) => {
    const trimmed = requireTrimmedString(item, name, maxItemLength);
    if (allowedValues && !allowedValues.includes(trimmed)) {
      throw validationError(`${name} contains an invalid value: ${trimmed}`);
    }
    return trimmed;
  });
}

function parseBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

module.exports = {
  validationError,
  conflictError,
  sendValidationError,
  requirePositiveInt,
  optionalPositiveInt,
  requireTrimmedString,
  optionalTrimmedString,
  requireEnum,
  optionalEnum,
  requireIsoDate,
  optionalIsoDate,
  requireIsoTime,
  requireEmail,
  optionalHttpUrl,
  requireUsername,
  requirePassword,
  requireString,
  optionalStringArray,
  parseBoolean,
};
