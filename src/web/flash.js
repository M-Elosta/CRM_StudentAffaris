'use strict';

/**
 * One-time messages for the toasts of the application shell.
 *
 * A message set before a redirect is stored in the session and shown on the
 * next page that renders. A request from htmx that does not navigate gets its
 * message through the HX-Trigger response header instead; app.js shows it.
 */

/**
 * Store a message for the next rendered page. `options.undoUrl` adds an Undo
 * button that POSTs there (with the CSRF token).
 */
function flash(req, message, kind = 'success', { undoUrl } = {}) {
  if (!req.session) return;
  req.session.flash = [...(req.session.flash ?? []), { kind, message, ...(undoUrl ? { undoUrl } : {}) }];
}

/** Take (and clear) the stored messages. */
function takeFlash(req) {
  const messages = req.session?.flash ?? [];
  if (req.session?.flash) delete req.session.flash;
  return messages;
}

/** Send a toast with an htmx response that does not navigate. */
function toastHeader(res, message, kind = 'success') {
  // Header values must be ASCII: names in the message may be Arabic.
  const json = JSON.stringify({ toast: { kind, message } }).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
  res.set('HX-Trigger', json);
}

module.exports = { flash, takeFlash, toastHeader };
