'use strict';

const express = require('express');
const { asyncHandler } = require('../lib/async-handler');

/**
 * /api/meta: GET /last-updated returns the latest change per record type.
 * @param {ReturnType<import('../services/meta-service').createMetaService>} metaService
 */
function createMetaRouter(metaService) {
  const router = express.Router();
  router.get(
    '/last-updated',
    asyncHandler((_req, res) => {
      res.json(metaService.lastUpdated());
    })
  );
  return router;
}

module.exports = { createMetaRouter };
