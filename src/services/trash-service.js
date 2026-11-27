'use strict';

const { RECORD_TYPES } = require('../domain/record-types');
const { PERMISSIONS: P } = require('../security/permissions');
const authorize = require('../security/authorize');

const ALL_TYPES = RECORD_TYPES.map((definition) => definition.path);

/**
 * The Trash: what was deleted, by whom and when, newest first. Restoring and
 * purging go through each record type's service, so its permission rules
 * apply. A record hidden only because its employer is in the Trash is not
 * listed: the employer's row stands for it, with how much is hidden with it.
 *
 * @param {object} deps
 * @param {ReturnType<import('../db/repositories/trash-repository').createTrashRepository>} deps.trashRepository
 * @param {Map<string, { service: object }>} deps.records  the record services, by path
 */
function createTrashService({ trashRepository, records }) {
  /** The record types this context may see in the Trash, narrowed to `type` when it is one of them. */
  function typesFor(ctx, type) {
    const readable = ALL_TYPES.filter((path) => authorize.canReadRecordType(ctx, path));
    return type ? readable.filter((path) => path === type) : readable;
  }

  return {
    /** The record type paths, in display order. */
    types: ALL_TYPES,

    /**
     * One page of the Trash. Each row carries the record as it was deleted
     * (in the list shape, redacted for the user) and, for an employer, how many
     * contacts and activities are hidden with it.
     * @param {{ type?: string, page?: number, pageSize?: number }} query  already validated
     * @param {{ user: object }} ctx
     * @returns {{ rows: object[], total: number, page: number, pageSize: number }}
     */
    page({ type, page = 1, pageSize = 25 } = {}, ctx) {
      authorize.requirePermission(ctx, P.TRASH_VIEW);
      const types = typesFor(ctx, type);
      const total = trashRepository.count(types);
      const pages = Math.max(1, Math.ceil(total / pageSize));
      const current = Math.min(Math.max(1, page), pages);
      const rows = trashRepository.page(types, { limit: pageSize, offset: (current - 1) * pageSize }).map((row) => {
        const service = records.get(row.type).service;
        const record = service.getAny(row.id, ctx);
        const hidden = row.type === 'companies' ? service.hiddenCounts(row.id, ctx) : null;
        return { ...row, record, hidden };
      });
      return { rows, total, page: current, pageSize };
    },

    /** How many records the user would see in the Trash; 0 without trash:view. */
    count(ctx) {
      if (!authorize.has(ctx, P.TRASH_VIEW)) return 0;
      return trashRepository.count(typesFor(ctx));
    },
  };
}

module.exports = { createTrashService };
