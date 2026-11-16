'use strict';

const authorize = require('../security/authorize');

/** The event record types searched together, with how a hit is described. */
const EVENT_TYPES = [
  {
    type: 'career-events',
    label: 'Career event',
    idField: 'CareerEventID',
    title: (row) => row.EventName,
    date: (row) => row.EventDate,
  },
  {
    type: 'student-events',
    label: 'Student-led event',
    idField: 'StudentLedEventID',
    title: (row) => row.EventTitle || row.OrganizationName,
    date: (row) => row.EventDate || row.ProposalDate,
  },
  {
    type: 'academic',
    label: 'Academic engagement',
    idField: 'EngagementID',
    title: (row) => `${row.CourseNumber} ${row.CourseTitle}: ${row.TopicTheme}`,
    date: (row) => row.SessionDate,
  },
];

/**
 * Global search across employers, contacts and events. Each group is searched
 * only when the user may read it, through the record services, so withheld
 * values are never matched or shown.
 * @param {{ records: Map<string, { service: object }> }} deps
 */
function createSearchService({ records }) {
  const service = (type) => records.get(type).service;

  return {
    /**
     * @param {string} q  the search text (already trimmed and limited in length)
     * @param {{ user: object }} ctx
     * @param {{ limit?: number }} [options]  hits per group
     * @returns {{ employers: { rows, total } | null, contacts: { rows, total } | null,
     *   events: { rows: Array<{ type, label, id, title, date, companyName }>, total } | null }}
     *   null for a group the user may not read
     */
    search(q, ctx, { limit = 25 } = {}) {
      const query = { filters: { q }, pageSize: limit };
      const group = (type, sort) =>
        authorize.canReadRecordType(ctx, type) ? service(type).page({ ...query, sort }, ctx) : null;

      const employers = group('companies', 'name');
      const contacts = group('contacts', 'name');

      const readableEvents = EVENT_TYPES.filter((event) => authorize.canReadRecordType(ctx, event.type));
      let events = null;
      if (readableEvents.length) {
        const found = readableEvents.map((event) => ({ event, result: service(event.type).page(query, ctx) }));
        const rows = found
          .flatMap(({ event, result }) =>
            result.rows.map((row) => ({
              type: event.type,
              label: event.label,
              id: row[event.idField],
              title: event.title(row),
              date: event.date(row),
              companyName: row.CompanyName,
            }))
          )
          .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
          .slice(0, limit);
        events = { rows, total: found.reduce((sum, { result }) => sum + result.total, 0) };
      }
      return { employers, contacts, events };
    },
  };
}

module.exports = { createSearchService };
