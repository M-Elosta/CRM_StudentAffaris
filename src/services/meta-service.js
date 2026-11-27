'use strict';

/**
 * Facts about the data as a whole: when each record type last changed, and
 * whether the database answers at all.
 * @param {object} deps
 * @param {ReturnType<import('../db/repositories/meta-repository').createMetaRepository>} deps.metaRepository
 */
function createMetaService({ metaRepository }) {
  return {
    /** { companies, contacts, ..., collaboration }: latest UpdatedAt/CreatedAt per record type, or null. */
    lastUpdated() {
      return metaRepository.lastUpdated();
    },

    /** Throws when the database cannot answer a trivial query. */
    checkDatabase() {
      metaRepository.ping();
    },
  };
}

module.exports = { createMetaService };
