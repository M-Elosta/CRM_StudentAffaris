'use strict';

const { NotFoundError } = require('../lib/errors');
const { PERMISSIONS } = require('../security/permissions');
const { createAuthorizer } = require('../security/authorize');
const { createRecordService } = require('./record-service');
const { DORMANT_AFTER_DAYS } = require('../domain/activity');
const { addDaysToIsoDate, todayInTimeZone } = require('../lib/dates');

/** Keys of the related counts → the record type each one counts. */
const RELATED_RECORD_TYPES = Object.freeze({
  contacts: 'contacts',
  outreach: 'outreach',
  recruitment: 'recruitment',
  events: 'career-events',
  academic: 'academic',
  studentEvents: 'student-events',
});

/**
 * Companies: the generic record service plus the blacklist rule (a
 * blacklisted employer's contacts are all Non-mailable) and the counts shown
 * before an employer is deleted.
 *
 * @param {object} deps  as for createRecordService, plus
 * @param {ReturnType<import('../db/repositories/companies-repository').createCompaniesRepository>} deps.companiesRepository
 */
function createCompaniesService({ companiesRepository, ...deps }) {
  const authorize = createAuthorizer(deps.permissions);
  const service = createRecordService({
    ...deps,
    hooks: {
      afterWrite(companyId, values) {
        if (values.Blacklisted) companiesRepository.markContactsNonMailable(companyId);
      },
      describeRemoval(company) {
        const { contacts, outreach, recruitment, events } = companiesRepository.countRelatedRecords(company.CompanyID);
        return { message: 'Company deleted', deleted: { contacts, outreach, recruitment, events } };
      },
    },
  });

  return {
    ...service,

    /**
     * One page of the employer list. Each row also says whether the employer
     * is dormant: no activity of any type for DORMANT_AFTER_DAYS (counted from
     * the date added when there has never been any).
     */
    page(query, ctx) {
      const result = service.page(query, ctx);
      const cutoff = addDaysToIsoDate(todayInTimeZone(deps.timeZone), -DORMANT_AFTER_DAYS);
      const isDormant = (row) => !row.Blacklisted && String(row.lastContactAt ?? row.DateAdded ?? '') < cutoff;
      return { ...result, rows: result.rows.map((row) => ({ ...row, isDormant: isDormant(row) })) };
    },

    /**
     * The employer's name and how many records of each kind belong to it.
     * Kinds the user may not read are reported as 0.
     */
    relatedCounts(companyId, ctx) {
      authorize.requireRecordAccess(ctx, PERMISSIONS.RECORD_READ, 'companies');
      const company = deps.repository.getStoredById(companyId);
      if (!company) throw new NotFoundError(deps.definition.notFoundMessage);
      const counts = companiesRepository.countRelatedRecords(companyId);
      for (const [key, recordType] of Object.entries(RELATED_RECORD_TYPES)) {
        if (!authorize.canReadRecordType(ctx, recordType)) counts[key] = 0;
      }
      return { companyName: company.CompanyName, ...counts };
    },

    /**
     * How many contacts and activities are hidden together with the employer
     * when it is in the Trash (or would be, when it is deleted).
     * @returns {{ contacts: number, activities: number }}
     */
    hiddenCounts(companyId, ctx) {
      authorize.requireRecordAccess(ctx, PERMISSIONS.RECORD_READ, 'companies');
      return companiesRepository.countHiddenWith(companyId);
    },
  };
}

module.exports = { createCompaniesService };
