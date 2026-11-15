'use strict';

const { ROLES, normalizeRole } = require('../lib/roles');

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Reachable without signing in: the login page and the assets it needs.
const PUBLIC_PREFIXES = ['/login.html', '/api/auth/login', '/css/', '/js/', '/favicon'];

const PASSWORD_ROTATION_ALLOWED = new Set(['/api/auth/check', '/api/auth/change-password', '/api/auth/logout']);

function requireAuth(req, res, next) {
  if (PUBLIC_PREFIXES.some((prefix) => req.path.startsWith(prefix))) return next();
  if (req.session?.userId) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  return res.redirect('/login.html');
}

/** A user who must change their password can do nothing else through the API. */
function requirePasswordRotation(req, res, next) {
  if (!req.session?.mustChangePassword) return next();
  if (!req.path.startsWith('/api/')) return next();
  if (PASSWORD_ROTATION_ALLOWED.has(req.path)) return next();
  return res.status(403).json({
    error: 'Password change required before continuing.',
    code: 'PASSWORD_CHANGE_REQUIRED',
  });
}

/** Viewers may read but never create, change or delete. */
function blockWritesForViewers(req, res, next) {
  if (WRITE_METHODS.has(req.method) && normalizeRole(req.session?.role) !== ROLES.ADMIN) {
    return res.status(403).json({ error: 'Viewers cannot make changes. Contact an admin.' });
  }
  return next();
}

function requireAdminSession(req, res, next) {
  if (normalizeRole(req.session?.role) !== ROLES.ADMIN) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  return next();
}

module.exports = { requireAuth, requirePasswordRotation, blockWritesForViewers, requireAdminSession };
