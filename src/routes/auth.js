'use strict';

const express = require('express');
const { asyncHandler } = require('../lib/async-handler');
const { roleLabelOf, permissionsOf } = require('../security/authorize');
const { parseWith } = require('../validation/common');
const { loginSchema, changePasswordSchema } = require('../validation/auth');

/** What the client is told about the signed-in user's role. */
function roleDetails(user) {
  return { role: user.role, roleLabel: roleLabelOf(user), permissions: permissionsOf(user) };
}

/**
 * /api/auth: login, logout, check and change-password. Only the user id is
 * kept in the session; everything else is read from the database on each
 * request (req.user).
 * @param {ReturnType<import('../services/auth-service').createAuthService>} authService
 */
function createAuthRouter(authService) {
  const router = express.Router();

  router.post(
    '/login',
    asyncHandler(async (req, res, next) => {
      const { username, password } = parseWith(loginSchema, req.body);
      const user = await authService.login(username, password, req.ctx);
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        return res.json({
          success: true,
          username: user.username,
          ...roleDetails(user),
          mustChangePassword: user.mustChangePassword,
        });
      });
    })
  );

  router.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('ero.sid');
      res.json({ success: true });
    });
  });

  router.get('/check', (req, res) => {
    if (!req.user) return res.status(401).json({ authenticated: false });
    return res.json({
      authenticated: true,
      username: req.user.username,
      ...roleDetails(req.user),
      userId: req.user.id,
      mustChangePassword: req.user.mustChangePassword,
    });
  });

  router.post(
    '/change-password',
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      const { currentPassword, newPassword } = parseWith(changePasswordSchema, req.body);
      await authService.changePassword({ currentPassword, newPassword, keepSessionId: req.sessionID }, req.ctx);
      return res.json({ success: true });
    })
  );

  return router;
}

module.exports = { createAuthRouter };
