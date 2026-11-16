'use strict';

const crypto = require('node:crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The session's CSRF token, created on first use. */
function csrfTokenFor(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

/** Replace the token, e.g. after signing in. */
function rotateCsrfToken(req) {
  if (req.session) req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  return req.session?.csrfToken ?? '';
}

function sameToken(expected, given) {
  if (typeof expected !== 'string' || typeof given !== 'string' || !expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Cross-site request forgery defence for the server-rendered pages: every
 * state-changing request outside /api must carry the session's token, as the
 * `_csrf` form field or the X-CSRF-Token header (htmx sends the header).
 * The JSON API keeps its Origin check instead.
 * @param {(req, res) => void} reject  renders the "form has expired" page
 */
function createCsrfGuard(reject) {
  return function verifyCsrf(req, res, next) {
    if (SAFE_METHODS.has(req.method) || req.path.startsWith('/api/')) return next();
    const given = req.get('x-csrf-token') || (req.body && typeof req.body._csrf === 'string' ? req.body._csrf : '');
    if (sameToken(req.session?.csrfToken, given)) return next();
    return reject(req, res);
  };
}

module.exports = { csrfTokenFor, rotateCsrfToken, createCsrfGuard };
