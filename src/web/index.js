'use strict';

const express = require('express');
const { version } = require('../../package.json');
const { createLocals } = require('./locals');
const { createCsrfGuard } = require('./csrf');
const { renderErrorPage, createPageErrorHandler } = require('./errors');
const { createAuthController } = require('./controllers/auth');
const { createDashboardController } = require('./controllers/dashboard');
const { createEmployersController } = require('./controllers/employers');
const { createRecordController, createEventsController, createOptionsController } = require('./controllers/records');
const { createFollowUpsController } = require('./controllers/follow-ups');
const { createReportsController } = require('./controllers/reports');
const { createAdminUsersController } = require('./controllers/admin-users');
const { createImportController, IMPORT_UPLOAD_PATH } = require('./controllers/import');
const { createSearchController } = require('./controllers/search');
const { createTrashController } = require('./controllers/trash');
const { SCREENS } = require('./screens');

/** Paths a user who must change their password may still open. */
const ROTATION_ALLOWED = new Set(['/account', '/account/password', '/auth/sign-out', '/login', '/session/extend']);

/**
 * The server-rendered pages: every route outside /api. Pages are complete
 * HTML from the server; htmx swaps parts of them.
 *
 * @param {object} deps
 * @param {object} deps.services  the result of createServices()
 * @param {object} deps.config
 * @param {{ error: Function }} [deps.logger]
 */
function createWebRouter({ services, config, logger = console }) {
  const router = express.Router();

  // The JSON API has its own handlers.
  router.use((req, _res, next) => (req.path.startsWith('/api/') ? next('router') : next()));

  router.use(express.urlencoded({ extended: false, limit: config.jsonBodyLimit, parameterLimit: 500 }));
  router.use(createLocals({ config, assetVersion: version, followUps: services.activity, trash: services.trash }));
  const expired = (req, res) =>
    renderErrorPage(req, res, 403, {
      title: 'This form has expired',
      message: 'This form has expired. Reload the page and try again.',
      action: 'Anything you typed may need to be entered again.',
    });
  router.use(createCsrfGuard(expired, { uploadPaths: [IMPORT_UPLOAD_PATH] }));
  router.use((req, res, next) => {
    if (req.user?.mustChangePassword && !ROTATION_ALLOWED.has(req.path)) return res.redirect('/account');
    return next();
  });

  router.get('/', (_req, res) => res.redirect('/dashboard'));
  router.use(createAuthController({ services, config }));
  router.use(createDashboardController({ services, config }));
  router.use(createEmployersController({ services, config }));
  router.use(createEventsController({ services }));
  router.use(createFollowUpsController({ services }));
  router.use(createReportsController({ services, config }));
  router.use(createAdminUsersController({ services }));
  router.use(createSearchController({ services }));
  router.use(createImportController({ services, expired }));
  router.use(createTrashController({ services }));
  router.use(createOptionsController({ services }));
  for (const screen of SCREENS) {
    if (screen.recordType !== 'companies')
      router.use(createRecordController({ services, config, screen, list: !screen.listPath }));
  }

  router.use((req, res) => renderErrorPage(req, res, 404));
  router.use(createPageErrorHandler(logger));
  return router;
}

module.exports = { createWebRouter, ASSET_VERSION: version };
