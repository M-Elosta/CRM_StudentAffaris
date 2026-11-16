'use strict';

const { ZodError } = require('zod');
const { AppError } = require('../lib/errors');
const { isHtmx } = require('./render');
const { toastHeader } = require('./flash');

/** The text of each error page. */
const PAGES = {
  403: {
    title: 'You do not have access to this page',
    message: 'Your role does not include this part of the system.',
    action: 'If you need it for your work, ask an administrator to change your role.',
  },
  404: {
    title: 'This page does not exist',
    message: 'The address may be mistyped, or the record may have been deleted.',
    action: 'Check the address, or find the record from the list it belongs to.',
  },
  429: {
    title: 'Too many attempts',
    message: 'There were too many attempts in a short time.',
    action: 'Wait a few minutes, then try again.',
  },
  500: {
    title: 'Something went wrong on our side',
    message: 'The page could not be shown. Nothing you typed has been saved on this attempt.',
    action: 'Try again in a moment. If it keeps happening, tell the system administrator what you were doing.',
  },
};

/**
 * Render a friendly error page with its status.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {number} status
 * @param {{ title?: string, message?: string, action?: string }} [override]
 */
function renderErrorPage(req, res, status, override = {}) {
  const page = { ...(PAGES[status] ?? PAGES[500]), ...override };
  const signedIn = Boolean(req.user);
  res.status(status);
  // An htmx request that is not a navigation shows the problem as a toast instead.
  if (isHtmx(req) && req.get('HX-Boosted') !== 'true') {
    const text = `${page.message} ${page.action ?? ''}`.trim();
    toastHeader(res, text, 'error');
    res.set('HX-Reswap', 'none');
    return res.type('html').send('');
  }
  return res.render('errors/error.njk', {
    status,
    ...page,
    homeHref: signedIn ? '/dashboard' : '/login',
    homeLabel: signedIn ? 'Go to the dashboard' : 'Go to sign in',
  });
}

/**
 * Error handler of the server-rendered pages. Permission problems render the
 * 403 page with the service's message, missing records the 404 page, and
 * anything unexpected is logged and shown as the 500 page.
 */
function createPageErrorHandler(logger) {
  // Express recognises error handlers by their four arguments.
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err instanceof AppError ? err.status : err?.statusCode || err?.status;
    if (status === 401) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (status === 403) return renderErrorPage(req, res, 403, { message: err.message });
    if (status === 404 || err instanceof ZodError || status === 400) return renderErrorPage(req, res, 404);
    if (status === 413) {
      return renderErrorPage(req, res, 400, {
        title: 'That was too large to send',
        message: 'The form or file is larger than the system accepts.',
        action: 'Try a smaller file, or fewer rows at a time.',
      });
    }
    logger.error(`[${req.method} ${req.path}]`, err?.stack || err);
    return renderErrorPage(req, res, 500);
  };
}

module.exports = { renderErrorPage, createPageErrorHandler };
