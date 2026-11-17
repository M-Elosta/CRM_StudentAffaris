'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');
const { NotFoundError, ValidationError } = require('../../lib/errors');
const { canAccessRecord, PERMISSIONS: P } = require('../../security/permissions');
const authorize = require('../../security/authorize');
const { parseListQuery, buildList, PAGE_SIZE } = require('../list');
const { redirectWithMessage, safeLocalPath } = require('../render');
const { screenFor } = require('../screens');
const { hiddenText } = require('../trash-text');

const ID_RE = /^[1-9]\d{0,9}$/;
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * /trash: everything deleted, newest first, with Restore and (for
 * administrators) Delete permanently; and the two actions themselves, which
 * the Undo button of the "moved to the Trash" message uses too.
 * @param {{ services: object }} deps
 */
function createTrashController({ services }) {
  const router = express.Router();
  const trash = services.trash;
  const typeOptions = trash.types.map((type) => ({ value: type, label: capitalize(screenFor(type).plural) }));
  const LIST_SPEC = {
    filters: [{ param: 'type', options: typeOptions }],
    sorts: { deleted: 'Deleted on' },
    defaultSort: ['deleted', 'desc'],
  };

  /** The record type and id of a Trash action; a 404 for anything that is not one. */
  function target(req) {
    const { type, id } = req.params;
    if (!trash.types.includes(type) || !ID_RE.test(id)) throw new NotFoundError();
    return { type, id: Number(id), screen: screenFor(type), service: services.records.get(type).service };
  }

  /** Where a record lives once it is restored: its own page. */
  const homeOf = (screen, id) => `${screen.base}/${id}`;

  router.get(
    '/trash',
    asyncHandler((req, res) => {
      authorize.requirePermission(req.ctx, P.TRASH_VIEW);
      const params = parseListQuery(req.query, LIST_SPEC);
      const result = trash.page({ type: params.filters.type, page: params.page, pageSize: PAGE_SIZE }, req.ctx);
      const list = buildList({
        basePath: '/trash',
        params,
        result: { ...result, sort: 'deleted', dir: 'desc' },
        sorts: LIST_SPEC.sorts,
      });
      const here = list.url();
      list.rows = result.rows.map((row) => {
        const screen = screenFor(row.type);
        return {
          ...row,
          typeLabel: capitalize(screen.singular),
          name: screen.nameOf(row.record),
          employer: row.type === 'companies' ? '' : row.record.CompanyName,
          hiddenText: row.hidden ? hiddenText(row.hidden.contacts, row.hidden.activities) : '',
          canRestore: canAccessRecord(req.user, P.RECORD_RESTORE, row.type),
          canPurge: canAccessRecord(req.user, P.RECORD_PURGE, row.type),
          restoreUrl: `/trash/${row.type}/${row.id}/restore`,
          purgeUrl: `/trash/${row.type}/${row.id}/purge`,
        };
      });
      res.render('trash/index.njk', { list, here, typeOptions });
    })
  );

  router.post(
    '/trash/:type/:id/restore',
    asyncHandler((req, res) => {
      const { id, screen, service } = target(req);
      authorize.requireRecordAccess(req.ctx, P.RECORD_RESTORE, req.params.type);
      const back = safeLocalPath(req.body.returnTo);
      const name = screen.nameOf(service.getAny(id, req.ctx));
      try {
        service.restore(id, req.ctx);
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err;
        return redirectWithMessage(req, res, back || '/trash', `${name} was not restored. ${err.message}`, 'error');
      }
      return redirectWithMessage(req, res, back || homeOf(screen, id), `${name} restored.`);
    })
  );

  router.post(
    '/trash/:type/:id/purge',
    asyncHandler((req, res) => {
      const { id, screen, service } = target(req);
      const back = safeLocalPath(req.body.returnTo) || '/trash';
      authorize.requireRecordAccess(req.ctx, P.RECORD_PURGE, req.params.type);
      const name = screen.nameOf(service.getAny(id, req.ctx));
      try {
        service.purge(id, req.ctx);
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err;
        return redirectWithMessage(req, res, back, `${name} was not deleted. ${err.message}`, 'error');
      }
      return redirectWithMessage(req, res, back, `${name} deleted permanently.`);
    })
  );

  return router;
}

module.exports = { createTrashController };
