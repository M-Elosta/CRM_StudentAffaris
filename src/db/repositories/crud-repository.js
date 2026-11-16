'use strict';

/**
 * Generic data access for one record type described in
 * src/domain/record-types.js. Table and column names come only from that
 * definition; every value is a bound parameter.
 */

/** 'ct.EmailAddress' -> 'EmailAddress'. */
const bareColumn = (column) => column.slice(column.lastIndexOf('.') + 1);

/**
 * Build the WHERE clause for the definition's list filters from already
 * validated values. Columns named in `withheldColumns` are never matched
 * against: a filter left with no column matches no row, so a withheld value
 * cannot be probed through a search.
 */
function buildListFilters(definition, filters, withheldColumns = []) {
  const withheld = new Set(withheldColumns);
  const conditions = [];
  const params = [];
  for (const filter of definition.list.filters) {
    const value = filters[filter.param];
    if (value === undefined || value === null || value === '') continue;
    const columns = (filter.columns ?? [filter.column]).filter((column) => !withheld.has(bareColumn(column)));
    if (!columns.length) {
      conditions.push('0 = 1');
    } else if (filter.match === 'contains') {
      conditions.push(`(${columns.map((column) => `${column} LIKE ?`).join(' OR ')})`);
      for (let index = 0; index < columns.length; index++) params.push(`%${value}%`);
    } else if (filter.match === 'equals') {
      conditions.push(`${filter.column} = ?`);
      params.push(value);
    } else if (filter.match === 'from') {
      conditions.push(`${filter.column} >= ?`);
      params.push(value);
    } else if (filter.match === 'to') {
      conditions.push(`${filter.column} <= ?`);
      params.push(value);
    } else {
      throw new Error(`Unsupported filter match "${filter.match}" in ${definition.path}`);
    }
  }
  return { where: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '', params };
}

/**
 * Create the repository for one record type.
 * @param {import('better-sqlite3').Database} db
 * @param {object} definition  an entry of RECORD_TYPES
 */
function createCrudRepository(db, definition) {
  const { table, idColumn, columns, children, list } = definition;
  const readBase = `SELECT ${list.select} FROM ${table} ${list.alias} ${list.joins.join(' ')}`;

  const statements = {
    getById: db.prepare(`${readBase} WHERE ${list.alias}.${idColumn} = ?`),
    getStoredById: db.prepare(`SELECT * FROM ${table} WHERE ${idColumn} = ?`),
    getUpdatedAt: db.prepare(`SELECT UpdatedAt FROM ${table} WHERE ${idColumn} = ?`),
    insert: db.prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((column) => `@${column}`).join(', ')})`
    ),
    update: db.prepare(
      `UPDATE ${table} SET ${columns.map((column) => `${column} = @${column}`).join(', ')} WHERE ${idColumn} = @__id`
    ),
    remove: db.prepare(`DELETE FROM ${table} WHERE ${idColumn} = ?`),
  };

  const childStatements = children.map((child) => ({
    child,
    selectForIds: db.prepare(
      `SELECT ${idColumn} AS parentId, ${child.column} AS value FROM ${child.table}
       WHERE ${idColumn} IN (SELECT value FROM json_each(?)) ORDER BY ID`
    ),
    deleteForParent: db.prepare(`DELETE FROM ${child.table} WHERE ${idColumn} = ?`),
    insertOne: db.prepare(`INSERT INTO ${child.table} (${idColumn}, ${child.column}) VALUES (?, ?)`),
  }));

  /**
   * Load every child array for the given parent ids: one query per child
   * table, whatever the number of ids. Returns Map<id, { field: values[] }>.
   */
  function loadChildren(ids) {
    const byId = new Map(ids.map((id) => [id, Object.fromEntries(children.map((child) => [child.field, []]))]));
    if (!ids.length || !children.length) return byId;
    const idsJson = JSON.stringify(ids);
    for (const { child, selectForIds } of childStatements) {
      for (const row of selectForIds.all(idsJson)) byId.get(row.parentId)?.[child.field].push(row.value);
    }
    return byId;
  }

  function withChildren(rows) {
    if (!children.length) return rows;
    const byId = loadChildren(rows.map((row) => row[idColumn]));
    return rows.map((row) => ({ ...row, ...byId.get(row[idColumn]) }));
  }

  function withChildrenOne(row) {
    return row ? withChildren([row])[0] : undefined;
  }

  return {
    definition,

    /**
     * Rows of the list query (joins and default order) matching the validated
     * filters, with children. Filters never match the `withheldColumns`.
     * @param {object} [filters]
     * @param {{ withheldColumns?: string[] }} [options]
     */
    list(filters = {}, { withheldColumns = [] } = {}) {
      const { where, params } = buildListFilters(definition, filters, withheldColumns);
      return withChildren(db.prepare(`${readBase}${where} ORDER BY ${list.orderBy}`).all(...params));
    },

    /** One row in the list shape (with joined names and children), or undefined. */
    getById(id) {
      return withChildrenOne(statements.getById.get(id));
    },

    /** One row exactly as stored in the table, with children, or undefined. */
    getStoredById(id) {
      return withChildrenOne(statements.getStoredById.get(id));
    },

    /** The stored UpdatedAt of a record: undefined when the record does not exist, else the value (maybe null). */
    getUpdatedAt(id) {
      const row = statements.getUpdatedAt.get(id);
      return row ? row.UpdatedAt : undefined;
    },

    /** Insert the definition's columns from values and return the new id. */
    insert(values) {
      const params = Object.fromEntries(columns.map((column) => [column, values[column] ?? null]));
      return Number(statements.insert.run(params).lastInsertRowid);
    },

    /** Overwrite the definition's columns of one record; returns the number of changed rows. */
    update(id, values) {
      const params = Object.fromEntries(columns.map((column) => [column, values[column] ?? null]));
      return statements.update.run({ ...params, __id: id }).changes;
    },

    /** Delete one record (child rows cascade); returns the number of deleted rows. */
    remove(id) {
      return statements.remove.run(id).changes;
    },

    loadChildren,

    /** Replace every child array present in values with exactly the given items. */
    replaceChildren(id, values) {
      for (const { child, deleteForParent, insertOne } of childStatements) {
        if (!Array.isArray(values[child.field])) continue;
        deleteForParent.run(id);
        for (const item of values[child.field]) insertOne.run(id, item);
      }
    },
  };
}

module.exports = { createCrudRepository };
