'use strict';

const express = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../lib/async-handler');
const { parseWith, positiveId } = require('../validation/common');

/**
 * The five CRUD endpoints of a record type:
 *   GET / (list, filtered by the query), GET /:id, POST /, PUT /:id, DELETE /:id
 *
 * @param {ReturnType<import('../services/record-service').createRecordService>} service
 * @param {object} options
 * @param {import('zod').ZodType} options.listQuerySchema  validates the list query
 * @param {string} options.idLabel  how the :id parameter is named in messages
 * @returns {import('express').Router}
 */
function createRecordRouter(service, { listQuerySchema, idLabel }) {
  const router = express.Router();
  const idSchema = z.object({ id: positiveId(idLabel) });

  router.param('id', (req, _res, next, value) => {
    try {
      req.recordId = parseWith(idSchema, { id: value }).id;
      next();
    } catch (err) {
      next(err);
    }
  });

  router.get(
    '/',
    asyncHandler((req, res) => {
      res.json(service.list(parseWith(listQuerySchema, req.query)));
    })
  );

  router.get(
    '/:id',
    asyncHandler((req, res) => {
      res.json(service.get(req.recordId));
    })
  );

  router.post(
    '/',
    asyncHandler((req, res) => {
      res.status(201).json(service.create(req.body));
    })
  );

  router.put(
    '/:id',
    asyncHandler((req, res) => {
      res.json(service.update(req.recordId, req.body));
    })
  );

  router.delete(
    '/:id',
    asyncHandler((req, res) => {
      res.json(service.remove(req.recordId));
    })
  );

  return router;
}

module.exports = { createRecordRouter };
