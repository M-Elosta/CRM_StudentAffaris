'use strict';

const { z } = require('zod');
const { IMPORT_ENTITIES } = require('../domain/record-types');

const MAX_IMPORT_ROWS = 5000;
const KNOWN_ENTITIES = new Set(IMPORT_ENTITIES);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** An import entity name such as 'Company' or 'Career Event'. */
const entitySchema = z
  .string({ error: 'Choose what kind of records to import' })
  .refine((value) => KNOWN_ENTITIES.has(value), { error: 'Unknown entity' });

const rowsSchema = z
  .array(z.unknown(), { error: 'rows must be a non-empty array' })
  .min(1, { error: 'rows must be a non-empty array' })
  .max(MAX_IMPORT_ROWS, { error: `rows must contain at most ${MAX_IMPORT_ROWS} entries` });

/** Body of POST /api/import/validate. */
const validateRequestSchema = z.object({
  entity: entitySchema,
  rows: rowsSchema,
  mapping: z.custom(isPlainObject, { error: 'mapping must be an object' }),
});

/** Body of POST /api/import/confirm. Each row is checked on its own by the import service. */
const confirmRequestSchema = z.object({
  entity: entitySchema,
  rows: rowsSchema,
});

module.exports = { MAX_IMPORT_ROWS, entitySchema, validateRequestSchema, confirmRequestSchema, isPlainObject };
