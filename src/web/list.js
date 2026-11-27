'use strict';

/**
 * List screens: reading the query string (search, filters, sort, page) and
 * building the `list` object the list templates expect.
 *
 * Nothing from the query reaches SQL directly: the search text is a bound
 * parameter, every filter value must be one of the declared options (or a
 * positive id / real date), and sort keys must be declared sortable.
 */

const { isRealIsoDate } = require('../lib/dates');

const PAGE_SIZE = 25;
const MAX_SEARCH_LENGTH = 100;

const firstString = (value) => {
  if (Array.isArray(value)) return firstString(value[0]);
  return typeof value === 'string' ? value : '';
};

/** The value of one filter if it is acceptable, else ''. */
function acceptFilter(filter, raw) {
  const value = firstString(raw).trim();
  if (!value) return '';
  if (filter.type === 'id') return /^[1-9]\d{0,9}$/.test(value) ? value : '';
  if (filter.type === 'date') return isRealIsoDate(value) ? value : '';
  const options = filter.options ?? [];
  return options.some((option) => String(option.value ?? option) === value) ? value : '';
}

/**
 * Read and validate the list parameters of a request.
 * @param {object} query  req.query
 * @param {{ filters?: Array<{ param: string, type?: string, options?: Array }>, sorts: Record<string, string>,
 *   defaultSort: [string, 'asc'|'desc'] }} spec
 * @returns {{ q: string, filters: Record<string, string>, sort: string, dir: 'asc'|'desc', page: number }}
 */
function parseListQuery(query, spec) {
  const q = firstString(query.q).trim().slice(0, MAX_SEARCH_LENGTH);
  const filters = {};
  for (const filter of spec.filters ?? []) {
    const value = acceptFilter(filter, query[filter.param]);
    if (value) filters[filter.param] = value;
  }
  const [defaultSort, defaultDir] = spec.defaultSort;
  const requestedSort = firstString(query.sort);
  const sort = Object.hasOwn(spec.sorts, requestedSort) ? requestedSort : defaultSort;
  const requestedDir = firstString(query.dir);
  let dir = sort === defaultSort ? defaultDir : 'asc';
  if (requestedDir === 'asc' || requestedDir === 'desc') dir = requestedDir;
  const pageNumber = Number.parseInt(firstString(query.page), 10);
  const page = Number.isInteger(pageNumber) && pageNumber > 0 && pageNumber < 100000 ? pageNumber : 1;
  return { q, filters, sort, dir, page };
}

/**
 * The `list` object of the list templates.
 * @param {object} args
 * @param {string} args.basePath  e.g. '/employers'
 * @param {ReturnType<typeof parseListQuery>} args.params
 * @param {{ rows: object[], total: number, page: number, pageSize: number, sort: string, dir: string }} args.result
 * @param {Record<string, string>} args.sorts  sort key -> label
 * @param {Record<string, string>} [args.fixed]  parameters always kept in URLs (e.g. a tab)
 */
function buildList({ basePath, params, result, sorts, fixed = {} }) {
  const state = {
    ...fixed,
    q: params.q,
    ...params.filters,
    sort: result.sort,
    dir: result.dir,
    page: result.page,
  };

  /** This list's URL with some parameters changed; null or undefined removes one. */
  function url(overrides = {}) {
    const merged = { ...state, ...overrides };
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value === null || value === undefined || value === '') continue;
      if (key === 'page' && Number(value) === 1) continue;
      search.set(key, String(value));
    }
    const text = search.toString();
    return text ? `${basePath}?${text}` : basePath;
  }

  const queryString = new URLSearchParams(
    Object.entries({ ...fixed, q: params.q, ...params.filters }).filter(([, value]) => value)
  ).toString();

  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const from = result.total ? (result.page - 1) * result.pageSize + 1 : 0;
  return {
    rows: result.rows,
    total: result.total,
    page: result.page,
    pages,
    from,
    to: Math.min(result.total, from + result.rows.length - 1),
    sort: result.sort,
    dir: result.dir,
    sortLabel: sorts[result.sort] ?? result.sort,
    q: params.q,
    filters: params.filters,
    hasFilters: Boolean(params.q) || Object.keys(params.filters).length > 0,
    queryString,
    url,
  };
}

module.exports = { parseListQuery, buildList, PAGE_SIZE };
