'use strict';

const express = require('express');
const { asyncHandler } = require('../lib/async-handler');
const { parseWith } = require('../validation/common');
const { dateRangeQuerySchema } = require('../validation/dashboard');

/** Endpoint name → dashboard service method. */
const ENDPOINTS = new Map([
  ['stats', 'stats'],
  ['companies-by-month', 'companiesByMonth'],
  ['outreach-by-month', 'outreachByMonth'],
  ['companies-by-sector', 'companiesBySector'],
  ['recruitment-by-major', 'recruitmentByMajor'],
  ['event-attendance', 'eventAttendance'],
  ['top-engaged', 'topEngaged'],
  ['hiring-trends', 'hiringTrends'],
]);

/**
 * /api/dashboard/*: every endpoint takes an optional from/to date range.
 * @param {ReturnType<import('../services/dashboard-service').createDashboardService>} dashboardService
 */
function createDashboardRouter(dashboardService) {
  const router = express.Router();
  for (const [endpoint, method] of ENDPOINTS) {
    router.get(
      `/${endpoint}`,
      asyncHandler((req, res) => {
        res.json(dashboardService[method](parseWith(dateRangeQuerySchema, req.query)));
      })
    );
  }
  return router;
}

module.exports = { createDashboardRouter };
