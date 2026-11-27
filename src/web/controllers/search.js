'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');
const { screenFor } = require('../screens');

const MAX_LENGTH = 100;

const queryOf = (req) => (typeof req.query.q === 'string' ? req.query.q.trim().slice(0, MAX_LENGTH) : '');

/** Search results with a link for each hit, as the templates show them. */
function presentResults(results) {
  const withHref = (group, href) => group && { ...group, rows: group.rows.map((row) => ({ ...row, href: href(row) })) };
  return {
    employers: withHref(results.employers, (row) => `/employers/${row.CompanyID}`),
    contacts: withHref(results.contacts, (row) => `/contacts/${row.ContactID}`),
    events: withHref(results.events, (row) => `${screenFor(row.type).base}/${row.id}`),
  };
}

/**
 * GET /search?q= (results page, grouped) and GET /search/suggest?q= (the top
 * five of each group for the dropdown under the search box). Only the groups
 * the role may read are searched.
 * @param {{ services: object }} deps
 */
function createSearchController({ services }) {
  const router = express.Router();

  router.get(
    '/search',
    asyncHandler((req, res) => {
      const q = queryOf(req);
      const results = q ? presentResults(services.search.search(q, req.ctx, { limit: 25 })) : null;
      res.render('search/index.njk', { q, results });
    })
  );

  router.get(
    '/search/suggest',
    asyncHandler((req, res, next) => {
      const q = queryOf(req);
      if (!q) return res.type('html').send('');
      const results = presentResults(services.search.search(q, req.ctx, { limit: 5 }));
      // app.render, not res.render: a fragment must not use up the page's one-time messages.
      return req.app.render('search/_suggest.njk', { q, results }, (err, html) =>
        err ? next(err) : res.type('html').send(html)
      );
    })
  );

  return router;
}

module.exports = { createSearchController };
