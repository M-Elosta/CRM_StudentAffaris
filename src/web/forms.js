'use strict';

/**
 * Turning records into form values and submitted forms into service bodies,
 * and service errors into the form's messages. No business rules: the
 * services validate and decide.
 */

const { AppError } = require('../lib/errors');
const { formState } = require('./render');
const { screenFor } = require('./screens');

const CONFLICT_MESSAGE = 'Someone else changed this record while you were editing. Reload to see their changes.';
const INVALID_MESSAGE = 'Check the fields marked below.';

const firstOf = (value) => (Array.isArray(value) ? value[0] : value);
const lastOf = (value) => (Array.isArray(value) ? value[value.length - 1] : value);

/** The values a form shows for a stored record. */
function valuesFromRecord(screen, record) {
  const values = { UpdatedAt: record.UpdatedAt };
  for (const field of screen.fields) {
    const value = record[field.name];
    if (field.control === 'checkbox') values[field.name] = value ? 1 : 0;
    else if (field.control === 'checkboxes') values[field.name] = Array.isArray(value) ? value : [];
    else values[field.name] = value ?? '';
  }
  return values;
}

/**
 * The service body from a submitted form: checkboxes become 1/0 (the macro
 * sends a hidden 0 before the box), checkbox groups become arrays, every
 * other value a single string. Fields the screen does not declare are dropped.
 */
function bodyFromForm(screen, submitted = {}) {
  const body = {};
  for (const field of screen.fields) {
    const raw = submitted[field.name];
    if (field.control === 'checkbox') body[field.name] = lastOf(raw) === '1' ? 1 : 0;
    else if (field.control === 'checkboxes') body[field.name] = raw === undefined ? [] : [].concat(raw).map(String);
    else body[field.name] = raw === undefined ? '' : String(firstOf(raw));
  }
  if (submitted.UpdatedAt !== undefined) body.UpdatedAt = String(firstOf(submitted.UpdatedAt));
  return body;
}

/**
 * The form state after the service refused a save, or null when the error is
 * not about the form (permissions, missing record, server errors).
 * @returns {{ status: number, form: object } | null}
 */
function formFromError(err, values) {
  if (!(err instanceof AppError)) return null;
  if (err.status === 409) return { status: 409, form: formState(values, {}, CONFLICT_MESSAGE) };
  if (err.status === 400) {
    const errors = { ...(err.fields ?? {}) };
    const known = Object.keys(values);
    const general = Object.keys(errors).filter((key) => !known.includes(key));
    const detail = general.map((key) => errors[key]).join(' ');
    return { status: 422, form: formState(values, errors, err.fields ? INVALID_MESSAGE : err.message, detail) };
  }
  return null;
}

/** The page of an activity item (timeline), by its record type. */
function activityHref(item) {
  return `${screenFor(item.type).base}/${item.id}`;
}

module.exports = { valuesFromRecord, bodyFromForm, formFromError, activityHref, CONFLICT_MESSAGE };
