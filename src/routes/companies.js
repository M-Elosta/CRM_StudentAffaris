'use strict';

const { asyncHandler } = require('../lib/async-handler');
const { createRecordRouter } = require('./record-router');

/**
 * /api/companies: the generic CRUD endpoints plus
 * GET /:id/related-counts, the counts shown before an employer is deleted.
 *
 * @param {ReturnType<import('../services/companies-service').createCompaniesService>} service
 * @param {object} options  as for createRecordRouter
 */
function createCompaniesRouter(service, options) {
  const router = createRecordRouter(service, options);

  router.get(
    '/:id/related-counts',
    asyncHandler((req, res) => {
      res.json(service.relatedCounts(req.recordId));
    })
  );

  return router;
}

module.exports = { createCompaniesRouter };
