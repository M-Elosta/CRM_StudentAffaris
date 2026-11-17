'use strict';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function toOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Cross-site request forgery defence for the JSON API: a state-changing
 * request must come from this application's own origin.
 *
 * The expected origin is BASE_URL when configured (required behind a reverse
 * proxy), otherwise the origin the request was addressed to.
 */
function createOriginGuard(config) {
  const configuredOrigin = config.baseUrl ? toOrigin(config.baseUrl) : null;

  return function requireTrustedOrigin(req, res, next) {
    if (!WRITE_METHODS.has(req.method) || !req.path.startsWith('/api/')) return next();

    const expected = new Set([`${req.protocol}://${req.get('host')}`]);
    if (configuredOrigin) expected.add(configuredOrigin);

    const origin = toOrigin(req.get('origin'));
    if (origin && expected.has(origin)) return next();

    const referer = toOrigin(req.get('referer'));
    if (!origin && referer && expected.has(referer)) return next();

    return res.status(403).json({ error: 'This request did not come from the application and was blocked.' });
  };
}

module.exports = { createOriginGuard };
