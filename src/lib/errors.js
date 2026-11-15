'use strict';

/**
 * Errors the application raises on purpose. Each carries the HTTP status the
 * error middleware sends and a message that is safe to show to the user.
 */
class AppError extends Error {
  /**
   * @param {string} message  safe to send to the client
   * @param {object} [options]
   * @param {number} [options.status]  HTTP status code (default 500)
   * @param {Record<string, string>} [options.fields]  per-field messages
   * @param {string} [options.code]  machine-readable code
   */
  constructor(message, { status = 500, fields, code } = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    if (fields) this.fields = fields;
    if (code) this.code = code;
  }
}

/** The request is malformed or breaks a validation rule (400). */
class ValidationError extends AppError {
  /**
   * @param {string} message
   * @param {Record<string, string>} [fields]
   */
  constructor(message, fields) {
    super(message, { status: 400, fields });
  }
}

/** Credentials are missing or wrong (401). */
class UnauthorizedError extends AppError {
  constructor(message) {
    super(message, { status: 401 });
  }
}

/** The user may not do this (403). */
class ForbiddenError extends AppError {
  constructor(message) {
    super(message, { status: 403 });
  }
}

/** The requested record does not exist (404). */
class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, { status: 404 });
  }
}

/** The request conflicts with the current state, e.g. a stale edit or a duplicate (409). */
class ConflictError extends AppError {
  constructor(message) {
    super(message, { status: 409 });
  }
}

/**
 * Turn a zod error into a ValidationError: the first issue becomes the
 * message and every failing field gets its own entry in `fields`.
 * @param {{ issues: Array<{ path: PropertyKey[], message: string }> }} zodError
 */
function validationErrorFromZod(zodError) {
  const fields = {};
  for (const issue of zodError.issues) {
    const field = issue.path.length ? String(issue.path[0]) : 'request';
    if (!Object.hasOwn(fields, field)) fields[field] = issue.message;
  }
  const message = zodError.issues[0]?.message || 'The request is not valid.';
  return new ValidationError(message, fields);
}

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  validationErrorFromZod,
};
