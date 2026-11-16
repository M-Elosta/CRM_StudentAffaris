'use strict';

const express = require('express');
const { asyncHandler } = require('../lib/async-handler');
const { normalizeRole } = require('../lib/roles');
const { parseWith } = require('../validation/common');
const { loginSchema, changePasswordSchema } = require('../validation/auth');

/**
 * /api/auth: login, logout, check and change-password.
 * @param {ReturnType<import('../services/auth-service').createAuthService>} authService
 */
function createAuthRouter(authService) {
  const router = express.Router();

  router.post(
    '/login',
    asyncHandler(async (req, res, next) => {
      const { username, password } = parseWith(loginSchema, req.body);
      const user = await authService.login(username, password);
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.userId;
        req.session.username = user.username;
        req.session.role = user.role;
        req.session.mustChangePassword = user.mustChangePassword;
        return res.json({
          success: true,
          username: user.username,
          role: user.role,
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
    if (!req.session?.userId) return res.status(401).json({ authenticated: false });
    return res.json({
      authenticated: true,
      username: req.session.username,
      role: normalizeRole(req.session.role),
      userId: req.session.userId,
      mustChangePassword: Boolean(req.session.mustChangePassword),
    });
  });

  router.post(
    '/change-password',
    asyncHandler(async (req, res) => {
      if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
      const { currentPassword, newPassword } = parseWith(changePasswordSchema, req.body);
      await authService.changePassword(req.session.userId, currentPassword, newPassword);
      req.session.mustChangePassword = false;
      return res.json({ success: true });
    })
  );

  return router;
}

module.exports = { createAuthRouter };
