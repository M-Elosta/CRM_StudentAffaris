'use strict';

const path = require('node:path');

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

function createErrorHandler(logger) {
  // eslint-disable-next-line no-unused-vars -- Express identifies error handlers by their four arguments
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
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
