'use strict';

const { ACTIVITY_SOURCES } = require('../../domain/activity');

/** One SELECT of the activity union for a source; every fragment is fixed text. */
function sourceSelect(source, where) {
  return `SELECT '${source.type}' AS type, x.${source.idColumn} AS id, x.${source.dateColumn} AS date,
      ${source.title} AS title, ${source.summary} AS summary,
      x.CompanyID AS companyId, c.CompanyName AS companyName,
      x.ContactID AS contactId, co.FirstName || ' ' || co.LastName AS contactName
    FROM ${source.table} x
    JOIN Company c ON c.CompanyID = x.CompanyID
    LEFT JOIN Contact co ON co.ContactID = x.ContactID
    WHERE ${where}`;
}

/**
 * Activity across the record types that count as contact with an employer:
 * timelines, recent activity and follow-ups. The caller decides which types
 * the user may read; only those are queried.
 * @param {import('better-sqlite3').Database} db
 */
function createActivityRepository(db) {
  const cache = new Map();
  const prepared = (sql) => {
    if (!cache.has(sql)) cache.set(sql, db.prepare(sql));
    return cache.get(sql);
  };
  const sourcesFor = (types) => ACTIVITY_SOURCES.filter((source) => types.includes(source.type));

  const followUpSelect = `SELECT o.OutreachEngagementID AS id, o.CompanyID AS companyId, c.CompanyName AS companyName,
      o.ContactID AS contactId, co.FirstName || ' ' || co.LastName AS contactName,
      o.InteractionType AS interactionType, o.InteractionDate AS interactionDate,
      o.FollowUpDate AS followUpDate, o.ActionPlan AS actionPlan, o.DiscussionItems AS discussionItems,
      o.UpdatedAt AS updatedAt
    FROM OutreachEngagement o
    JOIN Company c ON c.CompanyID = o.CompanyID
    LEFT JOIN Contact co ON co.ContactID = o.ContactID
    WHERE o.InteractionStatus = 'In-progress' AND o.FollowUpDate IS NOT NULL`;

  return {
    /**
     * An employer's activity of the given types, newest first.
     * @param {number} companyId
     * @param {string[]} types  activity types to include
     * @param {number} [limit]
     */
    forCompany(companyId, types, limit = 200) {
      const sources = sourcesFor(types);
      if (!sources.length) return [];
      const sql = `${sources.map((source) => sourceSelect(source, 'x.CompanyID = ?')).join(' UNION ALL ')}
        ORDER BY date DESC, id DESC LIMIT ?`;
      return prepared(sql).all(...sources.map(() => companyId), limit);
    },

    /**
     * The most recent activity of the given types up to and including `today`.
     * @param {string[]} types
     * @param {string} today  YYYY-MM-DD
     * @param {number} [limit]
     */
    recent(types, today, limit = 8) {
      const sources = sourcesFor(types);
      if (!sources.length) return [];
      const sql = `${sources
        .map((source) => sourceSelect(source, `x.${source.dateColumn} <= ?`))
        .join(' UNION ALL ')} ORDER BY date DESC, id DESC LIMIT ?`;
      return prepared(sql).all(...sources.map(() => today), limit);
    },

    /** Open follow-ups (In-progress interactions with a follow-up date), earliest first. */
    openFollowUps(limit = 500) {
      return prepared(`${followUpSelect} ORDER BY o.FollowUpDate ASC, o.OutreachEngagementID ASC LIMIT ?`).all(limit);
    },

    /** Open follow-ups due on or before a date, earliest first. */
    followUpsDueBy(date, limit = 50) {
      return prepared(
        `${followUpSelect} AND o.FollowUpDate <= ? ORDER BY o.FollowUpDate ASC, o.OutreachEngagementID ASC LIMIT ?`
      ).all(date, limit);
    },

    /** Number of open follow-ups due before `today`. */
    countOverdue(today) {
      return prepared(
        `SELECT COUNT(*) AS n FROM OutreachEngagement
         WHERE InteractionStatus = 'In-progress' AND FollowUpDate IS NOT NULL AND FollowUpDate < ?`
      ).get(today).n;
    },

    /** Number of open follow-ups due on or before a date. */
    countDueBy(date) {
      return prepared(
        `SELECT COUNT(*) AS n FROM OutreachEngagement
         WHERE InteractionStatus = 'In-progress' AND FollowUpDate IS NOT NULL AND FollowUpDate <= ?`
      ).get(date).n;
    },
  };
}

module.exports = { createActivityRepository };
