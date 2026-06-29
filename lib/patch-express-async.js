function wrapHandler(handler) {
  if (typeof handler !== 'function') return handler;
  return function wrappedHandler(req, res, next) {
    try {
      const result = handler.call(this, req, res, next);
      if (result && typeof result.then === 'function') {
        result.catch(next);
      }
      return result;
    } catch (error) {
      return next(error);
    }
  };
}

function patchExpressAsync(express) {
  const methods = ['use', 'all', 'get', 'post', 'put', 'patch', 'delete'];
  const originalRoute = express.Router;

  express.Router = function patchedRouter(...args) {
    const router = originalRoute.apply(this, args);
    for (const method of methods) {
      const original = router[method].bind(router);
      router[method] = (...handlers) => original(...handlers.map(wrapHandler));
    }
    return router;
  };
}

module.exports = {
  patchExpressAsync,
};
