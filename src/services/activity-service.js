'use strict';

const { ACTIVITY_SOURCES, DORMANT_AFTER_DAYS } = require('../domain/activity');
const { PERMISSIONS: P } = require('../security/permissions');
const authorize = require('../security/authorize');
const { addDaysToIsoDate, todayInTimeZone } = require('../lib/dates');

const LABELS = new Map(ACTIVITY_SOURCES.map((source) => [source.type, source.label]));

/**
 * Activity across record types (employer timelines, recent activity) and
 * follow-ups. Only the record types the user may read are included; a type
 * the user may not read is never queried.
 *
 * @param {object} deps
 * @param {ReturnType<import('../db/repositories/activity-repository').createActivityRepository>} deps.activityRepository
 * @param {Map<string, { service: object }>} deps.records  the record services, by path
 * @param {string} deps.timeZone
 * @param {() => Date} [deps.now]
 */
function createActivityService({ activityRepository, records, timeZone, now = () => new Date() }) {
  const today = () => todayInTimeZone(timeZone, now());

  /** The activity types this context may read. */
  const readableTypes = (ctx) =>
    ACTIVITY_SOURCES.map((source) => source.type).filter((type) => authorize.canReadRecordType(ctx, type));

  const withLabels = (items) => items.map((item) => ({ ...item, typeLabel: LABELS.get(item.type) }));

  /** A follow-up item with how it relates to today: overdue, this week (next 7 days) or later. */
  function classify(item, currentDay) {
    const weekEnd = addDaysToIsoDate(currentDay, 6);
    let group = 'later';
    if (item.followUpDate < currentDay) group = 'overdue';
    else if (item.followUpDate <= weekEnd) group = 'week';
    return { ...item, group };
  }

  return {
    /**
     * An employer's activity of every type the user may read, newest first.
     * @param {number} companyId
     * @param {{ user: object }} ctx
     */
    forCompany(companyId, ctx) {
      authorize.requireRecordAccess(ctx, P.RECORD_READ, 'companies');
      return withLabels(activityRepository.forCompany(companyId, readableTypes(ctx)));
    },

    /** The latest activity (up to today) the user may read. */
    recent(ctx, limit = 8) {
      authorize.requireRecordAccess(ctx, P.RECORD_READ, 'companies');
      return withLabels(activityRepository.recent(readableTypes(ctx), today(), limit));
    },

    /**
     * Open follow-ups grouped as overdue, due this week (today and the next six days) and later.
     * @returns {{ overdue: object[], week: object[], later: object[], today: string }}
     */
    followUps(ctx) {
      authorize.requireRecordAccess(ctx, P.RECORD_READ, 'outreach');
      const currentDay = today();
      const groups = { overdue: [], week: [], later: [], today: currentDay };
      for (const item of activityRepository.openFollowUps()) {
        const classified = classify(item, currentDay);
        groups[classified.group].push(classified);
      }
      return groups;
    },

    /** Open follow-ups that are overdue or due within the next seven days, overdue first. */
    followUpsDueSoon(ctx, limit = 8) {
      authorize.requireRecordAccess(ctx, P.RECORD_READ, 'outreach');
      const currentDay = today();
      const dueBy = addDaysToIsoDate(currentDay, 6);
      return {
        items: activityRepository.followUpsDueBy(dueBy, limit).map((item) => classify(item, currentDay)),
        total: activityRepository.countDueBy(dueBy),
        overdue: activityRepository.countOverdue(currentDay),
      };
    },

    /** An employer's next open follow-ups (overdue ones first); [] for a user who may not read interactions. */
    followUpsForCompany(companyId, ctx) {
      authorize.requireRecordAccess(ctx, P.RECORD_READ, 'companies');
      if (!authorize.canReadRecordType(ctx, 'outreach')) return [];
      const currentDay = today();
      return activityRepository.followUpsForCompany(companyId).map((item) => classify(item, currentDay));
    },

    /**
     * When an employer was last in contact (any activity type, up to today) and
     * whether that makes it dormant (DORMANT_AFTER_DAYS without activity,
     * counted from the date added when there has been none).
     * @param {{ CompanyID: number, DateAdded?: string, Blacklisted?: number }} company
     */
    contactSummary(company, ctx) {
      authorize.requireRecordAccess(ctx, P.RECORD_READ, 'companies');
      const currentDay = today();
      const lastContactAt = activityRepository.lastContact(company.CompanyID, currentDay);
      const cutoff = addDaysToIsoDate(currentDay, -DORMANT_AFTER_DAYS);
      const isDormant = !company.Blacklisted && String(lastContactAt ?? company.DateAdded ?? '') < cutoff;
      return { lastContactAt, isDormant };
    },

    /** Number of overdue follow-ups; 0 for a user who may not read interactions. */
    overdueCount(ctx) {
      if (!authorize.canReadRecordType(ctx, 'outreach')) return 0;
      return activityRepository.countOverdue(today());
    },

    /**
     * Mark an interaction's follow-up as done (its status becomes Complete),
     * through the interaction service so its permission and validation rules apply.
     * @param {number} id  OutreachEngagementID
     * @returns {object} the saved interaction
     */
    completeFollowUp(id, ctx) {
      const outreach = records.get('outreach').service;
      const stored = outreach.get(id, ctx);
      return outreach.update(id, { ...stored, InteractionStatus: 'Complete' }, ctx);
    },
  };
}

module.exports = { createActivityService };
