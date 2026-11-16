'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');

/**
 * The dashboard: key figures, follow-ups due, recent activity and two charts,
 * all in the first response.
 * @param {{ services: object, config: object }} deps
 */
function createDashboardController({ services }) {
  const router = express.Router();

  router.get(
    '/dashboard',
    asyncHandler((req, res) => {
      res.render('dashboard/index.njk', { overview: services.dashboard.overview?.(req.ctx) ?? null });
    })
  );

  return router;
}

module.exports = { createDashboardController };
