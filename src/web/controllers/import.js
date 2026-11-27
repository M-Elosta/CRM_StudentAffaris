'use strict';

const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { asyncHandler } = require('../../lib/async-handler');
const { AppError } = require('../../lib/errors');
const { IMPORT_ENTITIES } = require('../../domain/record-types');
const { PERMISSIONS: P } = require('../../security/permissions');
const authorize = require('../../security/authorize');
const { csrfValid } = require('../csrf');
const { flash } = require('../flash');

const IMPORT_UPLOAD_PATH = '/import/preview';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PREVIEW_ROWS = 200;

/** The interface's names for the import entities. */
const ENTITY_LABELS = {
  Company: 'Employers',
  Contact: 'Contacts',
  Outreach: 'Interactions',
  Recruitment: 'Postings',
  'Career Event': 'Career events',
  'Potential Collaboration': 'Collaboration ideas',
  'Academic Engagement': 'Academic engagements',
  'Student-Led Event': 'Student-led events',
  'Hiring Feedback': 'Hiring outcomes',
};
const ENTITIES = IMPORT_ENTITIES.map((entity) => ({ value: entity, label: ENTITY_LABELS[entity] ?? entity }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter(_req, file, callback) {
    callback(null, path.extname(file.originalname || '').toLowerCase() === '.xlsx');
  },
}).single('file');

/** 'Company Name', 'company_name' and 'CompanyName' all read as 'companyname'. */
const normalise = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Match a file's headers to the entity's columns by name; unmatched headers are ignored. */
function automaticMapping(headers, columns) {
  const byName = new Map([...columns.required, ...columns.optional].map((column) => [normalise(column), column]));
  return Object.fromEntries(headers.map((header) => [header, byName.get(normalise(header)) ?? '__ignore__']));
}

/**
 * /import: choose what to import and the file, preview every row with its
 * problems and duplicates, then confirm. The import service does the work;
 * the rows wait in the session between the preview and the confirmation.
 * @param {{ services: object, expired: (req, res) => void }} deps
 */
function createImportController({ services, expired }) {
  const router = express.Router();
  const importer = services.import;

  router.use('/import', (req, _res, next) => {
    authorize.requirePermission(req.ctx, P.IMPORT_RUN);
    next();
  });

  const renderStart = (req, res, { status = 200, error = '', entity = '' } = {}) =>
    res.status(status).render('import/start.njk', { entities: ENTITIES, error, entity });

  router.get('/import', (req, res) => renderStart(req, res, { entity: String(req.query.entity ?? '') }));

  router.get(
    '/import/template/:entity',
    asyncHandler(async (req, res) => {
      const { fileName, buffer } = await importer.template(req.params.entity, req.ctx);
      res.set('Content-Disposition', `attachment; filename="${fileName}"`);
      res.type(XLSX_TYPE).send(buffer);
    })
  );

  router.post(IMPORT_UPLOAD_PATH, (req, res, next) => {
    upload(req, res, (uploadError) => {
      if (req.csrfPending && !csrfValid(req)) return expired(req, res);
      const entity = typeof req.body?.entity === 'string' ? req.body.entity : '';
      const fail = (error) => renderStart(req, res, { status: 422, error, entity });
      if (uploadError) {
        return fail(
          uploadError.code === 'LIMIT_FILE_SIZE'
            ? 'The file is larger than 5 MB. Split it into smaller files.'
            : 'The file could not be read.'
        );
      }
      if (!IMPORT_ENTITIES.includes(entity)) return fail('Choose what kind of records the file holds.');
      if (!req.file) return fail('Choose an Excel file (.xlsx) to import.');
      return Promise.resolve()
        .then(async () => {
          const parsed = await importer.parse(req.file.buffer, req.ctx);
          if (!parsed.totalRows) return fail('The file has no rows under its header row.');
          const mapping = automaticMapping(parsed.headers, importer.columns(entity, req.ctx));
          if (!Object.values(mapping).some((field) => field !== '__ignore__')) {
            return fail('None of the column names match. Start from the template for this kind of record.');
          }
          const rows = importer.validate({ entity, rows: parsed.allRows, mapping }, req.ctx);
          req.session.importBatch = { entity, fileName: req.file.originalname, rows };
          return res.redirect(303, '/import/preview');
        })
        .catch((err) => (err instanceof AppError && err.status === 400 ? fail(err.message) : next(err)));
    });
  });

  router.get('/import/preview', (req, res) => {
    const batch = req.session.importBatch;
    if (!batch) return res.redirect('/import');
    const counts = { valid: 0, duplicate: 0, error: 0 };
    for (const row of batch.rows) counts[row.status] += 1;
    const columns = importer.columns(batch.entity, req.ctx);
    const shown = [...columns.required, ...columns.optional]
      .filter((column) => batch.rows.some((item) => item.row[column] !== undefined && item.row[column] !== ''))
      .slice(0, 4);
    return res.render('import/preview.njk', {
      batch,
      label: ENTITY_LABELS[batch.entity] ?? batch.entity,
      counts,
      columns: shown,
      rows: batch.rows.slice(0, PREVIEW_ROWS),
      more: Math.max(0, batch.rows.length - PREVIEW_ROWS),
    });
  });

  router.post(
    '/import/confirm',
    asyncHandler(async (req, res) => {
      const batch = req.session.importBatch;
      if (!batch) {
        flash(req, 'There is nothing waiting to be imported. Choose the file again.', 'error');
        return res.redirect(303, '/import');
      }
      const overwrite = req.body.duplicates === 'overwrite';
      const rows = batch.rows
        .filter((item) => item.status !== 'error')
        .map((item) => ({
          row: item.row,
          action: item.status === 'duplicate' ? (overwrite ? 'overwrite' : 'skip') : 'import',
        }));
      if (!rows.length) {
        flash(req, 'No row can be imported. Correct the file and choose it again.', 'error');
        return res.redirect(303, '/import/preview');
      }
      const result = await importer.confirm({ entity: batch.entity, rows }, req.ctx);
      delete req.session.importBatch;
      return res.render('import/done.njk', {
        label: ENTITY_LABELS[batch.entity] ?? batch.entity,
        fileName: batch.fileName,
        result: { ...result, skipped: result.skipped + (batch.rows.length - rows.length) },
      });
    })
  );

  router.post('/import/cancel', (req, res) => {
    delete req.session.importBatch;
    flash(req, 'Import cancelled. Nothing was saved.');
    res.redirect(303, '/import');
  });

  return router;
}

module.exports = { createImportController, IMPORT_UPLOAD_PATH, automaticMapping };
