'use strict';

const crypto = require('node:crypto');
const { normalizeRole, ROLES } = require('../security/permissions');

// Reachable without signing in: the login page and the assets it needs.
const PUBLIC_PREFIXES = ['/login.html', '/api/auth/login', '/css/', '/js/', '/favicon'];

const PASSWORD_ROTATION_ALLOWED = new Set(['/api/auth/check', '/api/auth/change-password', '/api/auth/logout']);

const isPublic = (req) => PUBLIC_PREFIXES.some((prefix) => req.path.startsWith(prefix));

function denyUnauthenticated(req, res) {
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  return res.redirect('/login.html');
}

/**
 * Give every request a context: { user, requestId, ip }. The request id is
 * fresh for each request and sent back as X-Request-Id; the user is filled in
 * by the current-user loader once the session is known.
 */
function requestContext(req, res, next) {
  const requestId = crypto.randomUUID();
  res.set('X-Request-Id', requestId);
  req.ctx = { user: null, requestId, ip: req.ip };
  next();
}

/**
 * Load the signed-in user from the database on every request, so a changed
 * role applies at once and a deactivated or deleted account loses access on
 * its very next request: its session is destroyed and the request refused.
 * @param {{ currentUser: (userId: number) => object|null }} authService
 */
function createCurrentUserLoader(authService) {
  return function loadCurrentUser(req, res, next) {
    const userId = req.session?.userId;
    if (!userId) return next();
    const user = authService.currentUser(userId);
    if (user) {
      req.user = user;
      req.ctx.user = user;
      return next();
    }
    return req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('ero.sid');
      return isPublic(req) ? next() : denyUnauthenticated(req, res);
    });
  };
}

/** Everything but the login page and its assets needs a signed-in user. */
function requireAuth(req, res, next) {
  if (isPublic(req) || req.user) return next();
  return denyUnauthenticated(req, res);
}

/** A user who must change their password can do nothing else through the API. */
function requirePasswordRotation(req, res, next) {
  if (!req.user?.mustChangePassword) return next();
  if (!req.path.startsWith('/api/')) return next();
  if (PASSWORD_ROTATION_ALLOWED.has(req.path)) return next();
  return res.status(403).json({
    error: 'Password change required before continuing.',
    code: 'PASSWORD_CHANGE_REQUIRED',
  });
}

function requireAdminSession(req, res, next) {
  if (normalizeRole(req.user?.role) !== ROLES.ADMIN) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  return next();
}

module.exports = {
  requestContext,
  createCurrentUserLoader,
  requireAuth,
  requirePasswordRotation,
  requireAdminSession,
};
