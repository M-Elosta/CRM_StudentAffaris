'use strict';

const POISON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function inspect(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(inspect);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (POISON_KEYS.has(key)) {
      const err = new Error('Unsupported field in request payload');
      err.statusCode = 400;
      throw err;
    }
    inspect(nested);
  }
}

/** Reject request bodies and query strings that try to reach object prototypes. */
function rejectPoisonedKeys(req, _res, next) {
  try {
    inspect(req.body);
    inspect(req.query);
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { rejectPoisonedKeys };
