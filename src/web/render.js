'use strict';

const { flash } = require('./flash');

/** Whether the request was made by htmx. */
const isHtmx = (req) => req.get('HX-Request') === 'true';

/** Whether the request was made by htmx for a boosted link or form (a page navigation). */
const isBoosted = (req) => isHtmx(req) && req.get('HX-Boosted') === 'true';

/**
 * Finish a successful form submission: remember the message for the next
 * page and go there. A plain or boosted request gets a 303 redirect; an htmx
 * request from a dialog gets HX-Redirect, so the browser loads the page.
 * `options` as for flash() (an Undo URL).
 */
function redirectWithMessage(req, res, url, message, kind = 'success', options = {}) {
  if (message) flash(req, message, kind, options);
  if (isHtmx(req) && !isBoosted(req)) {
    res.set('HX-Redirect', url);
    return res.status(200).type('html').send('');
  }
  return res.redirect(303, url);
}

/** A relative path within the application, or null when the value is anything else. */
function safeLocalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return null;
  }
  if (/[\r\n]/.test(value) || value.length > 2000) return null;
  if (value.startsWith('/login') || value.startsWith('/auth/') || value.startsWith('/api/')) return null;
  return value;
}

/**
 * The `form` object of the form macros: values to show, one message per
 * invalid field, and a summary message.
 */
function formState(values = {}, errors = {}, message = '', detail = '') {
  return { values, errors, message, detail };
}

module.exports = { isHtmx, isBoosted, redirectWithMessage, safeLocalPath, formState };
