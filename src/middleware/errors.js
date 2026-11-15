'use strict';

const path = require('node:path');
const { ZodError } = require('zod');
const { AppError, validationErrorFromZod } = require('../lib/errors');

/** Log the real error, tell the client nothing about it. */
function respondServerError(logger, req, res, err) {
  // The path is logged without its query string: search terms can be names.
  logger.error(`[${req.method} ${req.baseUrl || ''}${req.path}]`, err?.stack || err);
  if (res.headersSent) return undefined;
  return res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
}

function notFoundHandler(publicDir) {
  return (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    return res.status(404).sendFile(path.join(publicDir, '404.html'));
  };
}

/** Send an application error as { error, fields?, code? } with its status. */
function sendAppError(res, err) {
  const body = { error: err.message };
  if (err.fields) body.fields = err.fields;
  if (err.code) body.code = err.code;
  return res.status(err.status).json(body);
}

/**
 * The final error middleware. Application errors (AppError, ZodError) become
 * JSON responses with their status; anything unexpected is logged and the
 * client gets a generic message.
 */
function createErrorHandler(logger) {
  // Express identifies error handlers by their four arguments.
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ZodError) return sendAppError(res, validationErrorFromZod(err));
    if (err instanceof AppError && err.status < 500) return sendAppError(res, err);
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'That request is too large to process. Try a smaller file or fewer rows.' });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'The request could not be read.' });
    }
    const status = err?.statusCode || err?.status;
    if (status && status < 500) return res.status(status).json({ error: err.message });
    return respondServerError(logger, req, res, err);
  };
}

module.exports = { respondServerError, notFoundHandler, createErrorHandler };
