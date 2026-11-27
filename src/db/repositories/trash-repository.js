'use strict';

const { RECORD_TYPES } = require('../../domain/record-types');

/**
 * One SELECT of the Trash union for a record type: its records that are in
 * the Trash themselves. A record of an employer that is in the Trash too is
 * left out: the employer's row stands for everything hidden with it.
 */
function trashedSelect(definition) {
  const { path, table, idColumn } = definition;
  if (table === 'Company') {
    return `SELECT '${path}' AS type, t.CompanyID AS id, t.DeletedAt AS deletedAt, t.DeletedBy AS deletedBy
      FROM Company t WHERE t.DeletedAt IS NOT NULL`;
  }
  return `SELECT '${path}' AS type, t.${idColumn} AS id, t.DeletedAt AS deletedAt, t.DeletedBy AS deletedBy
    FROM ${table} t JOIN Company c ON c.CompanyID = t.CompanyID
    WHERE t.DeletedAt IS NOT NULL AND c.DeletedAt IS NULL`;
}

/**
 * The Trash: every record that was deleted, across the record types, newest
 * first. Table and column names come only from the record type definitions.
 * @param {import('better-sqlite3').Database} db
 */
function createTrashRepository(db) {
  const cache = new Map();
  const prepared = (sql) => {
    if (!cache.has(sql)) cache.set(sql, db.prepare(sql));
    return cache.get(sql);
  };
  /** The union of the given types, in definition order; unknown paths are ignored. */
  const unionOf = (types) =>
    RECORD_TYPES.filter((definition) => types.includes(definition.path))
      .map(trashedSelect)
      .join(' UNION ALL ');

  return {
    /**
     * One page of the Trash: [{ type, id, deletedAt, deletedBy, deletedByName }], newest first.
     * @param {string[]} types  record type paths to include
     * @param {{ limit: number, offset: number }} page
     */
    page(types, { limit, offset }) {
      const union = unionOf(types);
      if (!union) return [];
      return prepared(
        `SELECT x.type, x.id, x.deletedAt, x.deletedBy, COALESCE(u.DisplayName, u.Username) AS deletedByName
         FROM (${union}) x LEFT JOIN Users u ON u.UserID = x.deletedBy
         ORDER BY x.deletedAt DESC, x.type ASC, x.id DESC LIMIT ? OFFSET ?`
      ).all(limit, offset);
    },

    /** How many records of the given types are listed in the Trash. */
    count(types) {
      const union = unionOf(types);
      return union ? prepared(`SELECT COUNT(*) AS n FROM (${union})`).get().n : 0;
    },
  };
}

module.exports = { createTrashRepository };
