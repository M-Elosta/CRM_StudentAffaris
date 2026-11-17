'use strict';

/**
 * Generic data access for one record type described in
 * src/domain/record-types.js. Table and column names come only from that
 * definition; every value is a bound parameter.
 */

const permissions = require('../../security/permissions');

/** 'ct.EmailAddress' -> 'EmailAddress'. */
const bareColumn = (column) => column.slice(column.lastIndexOf('.') + 1);

/**
 * Build the WHERE clause for the definition's list filters from already
 * validated values. Columns named in `withheldColumns` are never matched
 * against: a filter left with no column matches no row, so a withheld value
 * cannot be probed through a search. The definition's live conditions come
 * first, so records in the Trash never match, unless `options.includeDeleted`.
 */
function buildListFilters(definition, filters, withheldColumns = [], options = {}) {
  const withheld = new Set(withheldColumns);
  const conditions = options.includeDeleted ? [] : [...definition.list.live];
  const params = [];
  for (const filter of definition.list.filters) {
    const value = filters[filter.param];
    if (value === undefined || value === null || value === '') continue;
    if (filter.match === 'choice') {
      // Only a declared choice applies; its condition is fixed text from the definition.
      if (typeof value !== 'string' || !Object.hasOwn(filter.choices, value)) continue;
      const choice = filter.choices[value];
      conditions.push(choice.sql);
      params.push(...(choice.args ? choice.args(options) : []));
      continue;
    }
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

/** The columns a user may not match against: the type's sensitive fields and withheld joined columns. */
function withheldColumnsFor(definition, user) {
  if (permissions.can(user, permissions.PERMISSIONS.SENSITIVE_READ)) return [];
  return [...permissions.sensitiveFieldsFor(definition.path), ...(definition.list.withheldColumns ?? [])];
}

/**
 * ORDER BY for a sort key and direction. Only keys declared in the
 * definition's page.sorts are used; anything else falls back to the default
 * sort. The record id breaks ties so paging is stable.
 * @returns {{ sql: string, sort: string, dir: 'asc'|'desc' }}
 */
function buildOrder(definition, sort, dir) {
  const page = definition.list.page;
  const [defaultKey, defaultDir] = page.defaultSort;
  const known = typeof sort === 'string' && Object.hasOwn(page.sorts, sort);
  const key = known ? sort : defaultKey;
  let direction = defaultDir;
  if (known && (dir === 'asc' || dir === 'desc')) direction = dir;
  const { columns, text } = page.sorts[key];
  const keyword = direction === 'asc' ? 'ASC' : 'DESC';
  const parts = columns.map((column) => `${column}${text ? ' COLLATE NOCASE' : ''} ${keyword}`);
  parts.push(`${definition.list.alias}.${definition.idColumn} ${keyword}`);
  return { sql: parts.join(', '), sort: key, dir: direction };
}

/**
 * Create the repository for one record type.
 * @param {import('better-sqlite3').Database} db
 * @param {object} definition  an entry of RECORD_TYPES
 */
function createCrudRepository(db, definition) {
  const { table, idColumn, columns, children, list } = definition;
  const readBase = `SELECT ${list.select} FROM ${table} ${list.alias} ${list.joins.join(' ')}`;
  const page = list.page ?? { sorts: {}, defaultSort: [] };
  const pageFrom = `FROM ${table} ${list.alias} ${[...list.joins, ...(page.joins ?? [])].join(' ')}`;
  const pageWith = page.with ? `WITH ${page.with} ` : '';
  const pageBase = `${pageWith}SELECT ${list.select}${page.select ?? ''} ${pageFrom}`;
  const countBase = `${pageWith}SELECT COUNT(*) AS n ${pageFrom}`;
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const withArgs = (today) => (page.withArgs ? page.withArgs({ today }) : []);

  // A stored row is live when it is not in the Trash and neither is its employer.
  const storedLive = list.live.length > 1 ? 't.DeletedAt IS NULL AND c.DeletedAt IS NULL' : 't.DeletedAt IS NULL';
  const storedFrom = `${table} t${list.live.length > 1 ? ' JOIN Company c ON c.CompanyID = t.CompanyID' : ''}`;
  const live = list.live.join(' AND ');
  // CreatedBy, UpdatedBy and DeletedBy refer to Users: an id with no account is stored as NULL.
  const knownUser = (param) => `(SELECT UserID FROM Users WHERE UserID = ${param})`;

  const statements = {
    getById: db.prepare(`${readBase} WHERE ${list.alias}.${idColumn} = ? AND ${live}`),
    getByIdAny: db.prepare(`${readBase} WHERE ${list.alias}.${idColumn} = ?`),
    getStoredById: db.prepare(`SELECT t.* FROM ${storedFrom} WHERE t.${idColumn} = ? AND ${storedLive}`),
    getStoredByIdAny: db.prepare(`SELECT * FROM ${table} WHERE ${idColumn} = ?`),
    getUpdatedAt: db.prepare(`SELECT t.UpdatedAt FROM ${storedFrom} WHERE t.${idColumn} = ? AND ${storedLive}`),
    insert: db.prepare(
      `INSERT INTO ${table} (${columns.join(', ')}, CreatedBy)
       VALUES (${columns.map((column) => `@${column}`).join(', ')}, ${knownUser('@__userId')})`
    ),
    update: db.prepare(
      `UPDATE ${table} SET ${columns.map((column) => `${column} = @${column}`).join(', ')}, UpdatedBy = ${knownUser('@__userId')}
       WHERE ${idColumn} = @__id AND DeletedAt IS NULL`
    ),
    softDelete: db.prepare(
      `UPDATE ${table} SET DeletedAt = ?, DeletedBy = ${knownUser('?')} WHERE ${idColumn} = ? AND DeletedAt IS NULL`
    ),
    restore: db.prepare(
      `UPDATE ${table} SET DeletedAt = NULL, DeletedBy = NULL WHERE ${idColumn} = ? AND DeletedAt IS NOT NULL`
    ),
    purge: db.prepare(`DELETE FROM ${table} WHERE ${idColumn} = ? AND DeletedAt IS NOT NULL`),
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
     * Records in the Trash are left out unless `includeDeleted`.
     * @param {object} [filters]
     * @param {{ withheldColumns?: string[], includeDeleted?: boolean }} [options]
     */
    list(filters = {}, { withheldColumns = [], includeDeleted = false } = {}) {
      const { where, params } = buildListFilters(definition, filters, withheldColumns, { includeDeleted });
      return withChildren(db.prepare(`${readBase}${where} ORDER BY ${list.orderBy}`).all(...params));
    },

    /**
     * One page of the list screen: live rows matching the filters, sorted by
     * a whitelisted key, with children. A user without sensitive:read never
     * matches against withheld columns.
     * @param {object} [filters]  validated filter values, by param
     * @param {{ sort?: string, dir?: string, limit?: number, offset?: number, user?: object, today?: string }} [options]
     * @returns {{ rows: object[], sort: string, dir: 'asc'|'desc' }}
     */
    page(filters = {}, { sort, dir, limit = 25, offset = 0, user, today = todayIso() } = {}) {
      const order = buildOrder(definition, sort, dir);
      const { where, params } = buildListFilters(definition, filters, withheldColumnsFor(definition, user), { today });
      const safeLimit = Math.min(Math.max(Math.trunc(Number(limit)) || 25, 1), 10000);
      const safeOffset = Math.max(Math.trunc(Number(offset)) || 0, 0);
      const rows = db
        .prepare(`${pageBase}${where} ORDER BY ${order.sql} LIMIT ? OFFSET ?`)
        .all(...withArgs(today), ...params, safeLimit, safeOffset);
      return { rows: withChildren(rows), sort: order.sort, dir: order.dir };
    },

    /**
     * How many live rows match the filters (the same rules as page()).
     * @param {object} [filters]
     * @param {{ user?: object, today?: string }} [options]
     */
    count(filters = {}, { user, today = todayIso() } = {}) {
      const { where, params } = buildListFilters(definition, filters, withheldColumnsFor(definition, user), { today });
      return db.prepare(`${countBase}${where}`).get(...withArgs(today), ...params).n;
    },

    /**
     * One live row in the list shape (with joined names and children), or undefined.
     * With `includeDeleted` (the Trash), a record in the Trash or under a deleted employer too.
     */
    getById(id, { includeDeleted = false } = {}) {
      return withChildrenOne((includeDeleted ? statements.getByIdAny : statements.getById).get(id));
    },

    /** One live row exactly as stored in the table, with children, or undefined; `includeDeleted` as for getById. */
    getStoredById(id, { includeDeleted = false } = {}) {
      return withChildrenOne((includeDeleted ? statements.getStoredByIdAny : statements.getStoredById).get(id));
    },

    /** The stored UpdatedAt of a live record: undefined when there is no such record, else the value (maybe null). */
    getUpdatedAt(id) {
      const row = statements.getUpdatedAt.get(id);
      return row ? row.UpdatedAt : undefined;
    },

    /** Insert the definition's columns from values, recording who created it; returns the new id. */
    insert(values, { userId = null } = {}) {
      const params = Object.fromEntries(columns.map((column) => [column, values[column] ?? null]));
      return Number(statements.insert.run({ ...params, __userId: userId }).lastInsertRowid);
    },

    /** Overwrite the definition's columns of one live record, recording who changed it; returns the changed rows. */
    update(id, values, { userId = null } = {}) {
      const params = Object.fromEntries(columns.map((column) => [column, values[column] ?? null]));
      return statements.update.run({ ...params, __id: id, __userId: userId }).changes;
    },

    /**
     * Move one record to the Trash: set DeletedAt (UTC, YYYY-MM-DD HH:MM:SS) and
     * DeletedBy. Nothing else is changed and no row is removed. Returns the changed rows.
     */
    softDelete(id, { userId = null, deletedAt }) {
      return statements.softDelete.run(deletedAt, userId, id).changes;
    },

    /** Take one record out of the Trash; returns the changed rows (0 when it was not in the Trash). */
    restore(id) {
      return statements.restore.run(id).changes;
    },

    /** Permanently delete one record that is in the Trash (child rows cascade); returns the deleted rows. */
    purge(id) {
      return statements.purge.run(id).changes;
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
