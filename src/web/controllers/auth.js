'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { asyncHandler } = require('../../lib/async-handler');
const { AppError } = require('../../lib/errors');
const { parseWith } = require('../../validation/common');
const { loginSchema, changePasswordSchema } = require('../../validation/auth');
const { rotateCsrfToken } = require('../csrf');
const { flash } = require('../flash');
const { formState, safeLocalPath, redirectWithMessage } = require('../render');
const { renderErrorPage } = require('../errors');

const WRONG_CREDENTIALS = 'Username or password is not correct';

/** `next` from the query or the form, if it is a path inside the application. */
const nextOf = (req) => safeLocalPath(req.body?.next) || safeLocalPath(req.query.next) || '';

/**
 * Sign in, sign out and the account page.
 * @param {{ services: object, config: object }} deps
 */
function createAuthController({ services, config }) {
  const router = express.Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.loginRateLimitPer15Min,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    skip: () => config.isTest,
    handler: (req, res) =>
      renderErrorPage(req, res, 429, {
        title: 'Too many sign-in attempts',
        message: 'There were too many unsuccessful sign-in attempts from this computer.',
        action: 'Wait 15 minutes, then try again.',
      }),
  });

  const renderLogin = (req, res, { status = 200, form = formState(), notice = '' } = {}) =>
    res.status(status).render('auth/login.njk', { form, next: nextOf(req), notice });

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect(nextOf(req) || '/dashboard');
    const notice = req.query['signed-out'] === '1' ? 'You have signed out.' : '';
    return renderLogin(req, res, { notice });
  });

  router.post(
    '/login',
    loginLimiter,
    asyncHandler(async (req, res, next) => {
      const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
      const values = { username };
      let credentials;
      try {
        credentials = parseWith(loginSchema, { username, password: req.body.password });
      } catch {
        const errors = {};
        if (!username) errors.username = 'Enter your username.';
        if (!req.body.password) errors.password = 'Enter your password.';
        return renderLogin(req, res, {
          status: 422,
          form: formState(values, errors, 'Enter your username and password to sign in.'),
        });
      }
      let user;
      try {
        user = await services.auth.login(credentials.username, credentials.password, req.ctx);
      } catch (err) {
        if (err instanceof AppError && err.status === 401) {
          return renderLogin(req, res, { status: 401, form: formState(values, {}, WRONG_CREDENTIALS) });
        }
        throw err;
      }
      const destination = nextOf(req);
      return req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        rotateCsrfToken(req);
        if (user.mustChangePassword) {
          return res.redirect(303, destination ? `/account?next=${encodeURIComponent(destination)}` : '/account');
        }
        return res.redirect(303, destination || '/dashboard');
      });
    })
  );

  router.post('/auth/sign-out', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('ero.sid');
      return res.redirect(303, '/login?signed-out=1');
    });
  });

  // Extends the idle window: any request does, this one does nothing else.
  router.post('/session/extend', (_req, res) => res.status(204).end());

  const renderAccount = (req, res, { status = 200, form = formState() } = {}) =>
    res.status(status).render('account/index.njk', {
      form,
      mustChange: req.user.mustChangePassword,
      next: nextOf(req),
    });

  router.get('/account', (req, res) => renderAccount(req, res));

  router.post(
    '/account/password',
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword, confirmPassword } = req.body;
      const fail = (errors, message) => renderAccount(req, res, { status: 422, form: formState({}, errors, message) });
      let change;
      try {
        change = parseWith(changePasswordSchema, { currentPassword, newPassword });
      } catch (err) {
        if (!err.fields) throw err;
        const errors = { ...err.fields };
        if (errors.currentPassword) errors.currentPassword = 'Enter your current password.';
        return fail(errors, 'The password was not changed. Check the fields marked below.');
      }
      if (newPassword !== confirmPassword) {
        return fail({ confirmPassword: 'The two new passwords are not the same.' }, 'The password was not changed.');
      }
      try {
        await services.auth.changePassword({ ...change, keepSessionId: req.sessionID }, req.ctx);
      } catch (err) {
        if (err instanceof AppError && err.status === 401) {
          return fail({ currentPassword: 'This is not your current password.' }, 'The password was not changed.');
        }
        if (err instanceof AppError && err.status === 400) {
          return fail({ newPassword: err.message }, 'The password was not changed.');
        }
        throw err;
      }
      flash(req, 'Password changed. You stay signed in here; other sessions were signed out.');
      return redirectWithMessage(req, res, nextOf(req) || '/dashboard');
    })
  );

  return router;
}

module.exports = { createAuthController };
