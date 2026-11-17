'use strict';

const express = require('express');
const { asyncHandler } = require('../lib/async-handler');
const { parseWith } = require('../validation/common');
const { quickReportQuerySchema } = require('../validation/reports');

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * /api/reports: GET /periods and GET /quick/:type (JSON, or xlsx with ?export=1).
 * @param {ReturnType<import('../services/reports').createReportsService>} reportsService
 */
function createReportsRouter(reportsService) {
  const router = express.Router();

  router.get(
    '/periods',
    asyncHandler((_req, res) => {
      res.json(reportsService.periods());
    })
  );

  router.get(
    '/quick/:type',
    asyncHandler(async (req, res) => {
      const { type } = req.params;
      reportsService.ensureQuickReport(type);
      const query = parseWith(quickReportQuerySchema, req.query);
      if (!query.export) return res.json(reportsService.runQuickReport(type, query));

      const { fileName, buffer } = await reportsService.exportQuickReport(type, query);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
      return res.send(buffer);
    })
  );

  return router;
}

module.exports = { createReportsRouter };
