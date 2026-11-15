'use strict';

/**
 * Reusable zod building blocks. Every builder takes the field's label in
 * plain words ("Email address", "Interaction date") and produces messages
 * that name it, so a failed validation reads as one clear sentence.
 */

const { z } = require('zod');
const { isRealIsoDate, isDatabaseTimestamp, normalizeTimestamp } = require('../lib/dates');
const { validationErrorFromZod } = require('../lib/errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,64}$/;
const TRUE_VALUES = new Set([true, 1, 'true', '1']);

const isBlank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/** Missing, null and blank strings become null; everything else is passed on. */
const blankToNull = (value) => (isBlank(value) ? null : value);

/** Missing, null and blank strings become undefined, so a .default() applies. */
const blankToUndefined = (value) => (isBlank(value) ? undefined : value);

/** Numeric strings become numbers; everything else is passed on for the number check to judge. */
const numericStringToNumber = (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value);

function textTypeError(label) {
  return (issue) => (issue.input == null ? `${label} is required` : `${label} must be text`);
}

function tooLong(label, max) {
  return { error: `${label} must be ${max} characters or fewer` };
}

/**
 * A required string: trimmed, not blank, at most `max` characters.
 * @param {string} label
 * @param {{ max?: number }} [options]
 */
function requiredText(label, { max = 255 } = {}) {
  return z
    .string({ error: textTypeError(label) })
    .trim()
    .min(1, { error: `${label} is required` })
    .max(max, tooLong(label, max));
}

/**
 * An optional string: trimmed, blank becomes null, at most `max` characters.
 * @param {string} label
 * @param {{ max?: number }} [options]
 */
function optionalText(label, { max = 255 } = {}) {
  return z.preprocess(
    blankToNull,
    z
      .string({ error: textTypeError(label) })
      .trim()
      .max(max, tooLong(label, max))
      .nullable()
  );
}

/**
 * A required string taken exactly as given (no trimming), e.g. a password.
 * @param {string} label
 * @param {{ max?: number }} [options]
 */
function exactText(label, { max = 1024 } = {}) {
  return z
    .string({ error: textTypeError(label) })
    .min(1, { error: `${label} is required` })
    .max(max, tooLong(label, max));
}

function dateMessage(label) {
  return `${label} must be a real date in YYYY-MM-DD format`;
}

/** A required YYYY-MM-DD date that exists on the calendar. */
function isoDate(label) {
  return z
    .string({ error: textTypeError(label) })
    .trim()
    .min(1, { error: `${label} is required` })
    .refine(isRealIsoDate, { error: dateMessage(label) });
}

/** An optional YYYY-MM-DD date that exists on the calendar; blank becomes null. */
function optionalIsoDate(label) {
  return z.preprocess(
    blankToNull,
    z
      .string({ error: dateMessage(label) })
      .trim()
      .refine(isRealIsoDate, { error: dateMessage(label) })
      .nullable()
  );
}

/** A required 24-hour time in HH:MM format. */
function timeOfDay(label) {
  return z
    .string({ error: textTypeError(label) })
    .trim()
    .min(1, { error: `${label} is required` })
    .regex(TIME_RE, { error: `${label} must be a time in HH:MM format` });
}

/** A required email address. */
function email(label, { max = 254 } = {}) {
  return z
    .string({ error: textTypeError(label) })
    .trim()
    .min(1, { error: `${label} is required` })
    .max(max, tooLong(label, max))
    .regex(EMAIL_RE, { error: `${label} is not valid` });
}

/** An optional email address; blank becomes null. */
function optionalEmail(label, { max = 254 } = {}) {
  return z.preprocess(
    blankToNull,
    z
      .string({ error: `${label} is not valid` })
      .trim()
      .max(max, tooLong(label, max))
      .regex(EMAIL_RE, { error: `${label} is not valid` })
      .nullable()
  );
}

function toHttpUrl(value, context, label) {
  const message = `${label} must be a valid http or https URL`;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    context.addIssue({ code: 'custom', message });
    return z.NEVER;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    context.addIssue({ code: 'custom', message });
    return z.NEVER;
  }
  return parsed.toString();
}

/** An optional http(s) URL, normalised by the URL parser; blank becomes null. */
function optionalHttpUrl(label, { max = 2048 } = {}) {
  return z.preprocess(
    blankToNull,
    z
      .string({ error: `${label} must be a valid http or https URL` })
      .trim()
      .max(max, tooLong(label, max))
      .transform((value, context) => toHttpUrl(value, context, label))
      .nullable()
  );
}

function positiveIntegerSchema(label) {
  const message = `${label} must be a positive integer`;
  return z
    .number({ error: (issue) => (isBlank(issue.input) ? `${label} is required` : message) })
    .int({ error: message })
    .positive({ error: message });
}

/** A required positive integer, given as a number or a numeric string (ids, years). */
function positiveId(label) {
  return z.preprocess(numericStringToNumber, positiveIntegerSchema(label));
}

/** An optional positive integer; blank becomes null. */
function optionalPositiveId(label) {
  return z.preprocess((value) => numericStringToNumber(blankToNull(value)), positiveIntegerSchema(label).nullable());
}

/**
 * A yes/no flag stored as 1 or 0. true, 1, 'true' and '1' mean yes; false, 0,
 * 'false', '0', a missing value and anything else mean no.
 */
function booleanFlag() {
  return z.preprocess((value) => (TRUE_VALUES.has(value) ? 1 : 0), z.union([z.literal(0), z.literal(1)]));
}

function enumMessage(label, values) {
  return `${label} must be one of: ${values.join(', ')}`;
}

/**
 * A required value from a fixed list, matched exactly.
 * @param {string} label
 * @param {readonly string[]} values
 */
function enumOf(label, values) {
  return z.enum(values, {
    error: (issue) => (issue.input == null || issue.input === '' ? `${label} is required` : enumMessage(label, values)),
  });
}

/**
 * An optional value from a fixed list. A missing or blank value becomes
 * `defaultValue` (null unless given).
 */
function optionalEnumOf(label, values, defaultValue = null) {
  const schema = z.enum(values, { error: enumMessage(label, values) });
  if (defaultValue === null) return z.preprocess(blankToNull, schema.nullable());
  return z.preprocess(blankToUndefined, schema.default(defaultValue));
}

/**
 * An optional list of short strings; missing becomes []. Each item is
 * trimmed and must not be blank.
 * @param {string} label
 * @param {{ maxItems?: number, maxItemLength?: number, allowedValues?: readonly string[] }} [options]
 */
function stringArray(label, { maxItems = 50, maxItemLength = 100, allowedValues = null } = {}) {
  let item = z
    .string({ error: `${label} must contain only text` })
    .trim()
    .min(1, { error: `${label} cannot contain blank values` })
    .max(maxItemLength, { error: `Each value in ${label} must be ${maxItemLength} characters or fewer` });
  if (allowedValues) {
    item = item.refine((value) => allowedValues.includes(value), {
      error: (issue) => `${label} contains an invalid value: ${issue.input}`,
    });
  }
  return z.preprocess(
    (value) => (value === undefined || value === null ? [] : value),
    z
      .array(item, { error: `${label} must be an array` })
      .max(maxItems, { error: `${label} must contain at most ${maxItems} values` })
  );
}

/** A username: 3-64 letters, digits, dots, underscores or hyphens. */
function username(label = 'Username') {
  return requiredText(label, { max: 64 }).regex(USERNAME_RE, {
    error: `${label} must be 3-64 characters and contain only letters, numbers, dot, underscore, or hyphen`,
  });
}

/** A new password: at least 12 characters, taken exactly as typed. */
function newPassword(label = 'Password') {
  const message = `${label} must be at least 12 characters`;
  return z.string({ error: message }).min(12, { error: message }).max(1024, tooLong(label, 1024));
}

/**
 * The UpdatedAt value an edit was based on, normalised to 'YYYY-MM-DD HH:MM:SS'.
 * ISO strings are accepted.
 */
function recordTimestamp(label = 'UpdatedAt') {
  const required = `${label} is required when editing a record`;
  return z.preprocess(
    (value) => (typeof value === 'string' ? normalizeTimestamp(value.trim()) : value),
    z.string({ error: required }).refine(isDatabaseTimestamp, { error: `${label} must be a valid record timestamp` })
  );
}

/** The optional from/to query parameters that limit a list or report to a date range. */
function dateRangeQuery() {
  return {
    from: optionalIsoDate('From date'),
    to: optionalIsoDate('To date'),
  };
}

/**
 * Parse input with a schema and return the result, or throw a
 * ValidationError naming every failing field.
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @param {unknown} input
 * @returns {T}
 */
function parseWith(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw validationErrorFromZod(result.error);
  return result.data;
}

module.exports = {
  requiredText,
  optionalText,
  exactText,
  isoDate,
  optionalIsoDate,
  timeOfDay,
  email,
  optionalEmail,
  optionalHttpUrl,
  positiveId,
  optionalPositiveId,
  booleanFlag,
  enumOf,
  optionalEnumOf,
  stringArray,
  username,
  newPassword,
  recordTimestamp,
  dateRangeQuery,
  parseWith,
};
