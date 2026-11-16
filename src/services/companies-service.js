'use strict';

const { NotFoundError } = require('../lib/errors');
const { PERMISSIONS } = require('../security/permissions');
const { createAuthorizer } = require('../security/authorize');
const { createRecordService } = require('./record-service');

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
  };
}

module.exports = { createCompaniesService };
