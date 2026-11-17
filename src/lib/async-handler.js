'use strict';

/**
 * Wrap an Express handler so that a thrown error or a rejected promise is
 * passed to next() and reaches the error middleware.
 * @param {(req: import('express').Request, res: import('express').Response, next: Function) => unknown} handler
 */
function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === 'function') result.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { asyncHandler };
