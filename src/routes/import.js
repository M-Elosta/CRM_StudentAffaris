'use strict';

const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { asyncHandler } = require('../lib/async-handler');
const { ValidationError } = require('../lib/errors');
const { parseWith } = require('../validation/common');
const { validateRequestSchema, confirmRequestSchema } = require('../validation/import');

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ALLOWED_IMPORT_MIME_TYPES = new Set([XLSX_CONTENT_TYPE, 'application/octet-stream']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, callback) {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (extension !== '.xlsx' || !ALLOWED_IMPORT_MIME_TYPES.has(file.mimetype)) {
      return callback(new ValidationError('Only .xlsx files are supported for import'));
    }
    return callback(null, true);
  },
});

/**
 * /api/import: template download, workbook parsing, row validation and the
 * confirmed import.
 * @param {ReturnType<import('../services/import-service').createImportService>} importService
 */
function createImportRouter(importService) {
  const router = express.Router();

  router.get(
    '/template/:entity',
    asyncHandler(async (req, res) => {
      const { fileName, buffer } = await importService.template(req.params.entity, req.ctx);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
      res.send(buffer);
    })
  );

  router.post(
    '/parse',
    upload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new ValidationError('No file uploaded');
      res.json(await importService.parse(req.file.buffer, req.ctx));
    })
  );

  router.post(
    '/validate',
    asyncHandler((req, res) => {
      res.json(importService.validate(parseWith(validateRequestSchema, req.body), req.ctx));
    })
  );

  router.post(
    '/confirm',
    asyncHandler(async (req, res) => {
      res.json(await importService.confirm(parseWith(confirmRequestSchema, req.body), req.ctx));
    })
  );

  return router;
}

module.exports = { createImportRouter };
