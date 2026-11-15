'use strict';

const { NotFoundError } = require('../lib/errors');
const { createRecordService } = require('./record-service');

/**
 * Companies: the generic record service plus the blacklist rule (a
 * blacklisted employer's contacts are all Non-mailable) and the counts shown
 * before an employer is deleted.
 *
 * @param {object} deps  as for createRecordService, plus
 * @param {ReturnType<import('../db/repositories/companies-repository').createCompaniesRepository>} deps.companiesRepository
 */
function createCompaniesService({ companiesRepository, ...deps }) {
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

    /** The employer's name and how many records of each kind belong to it. */
    relatedCounts(companyId) {
      const company = deps.repository.getStoredById(companyId);
      if (!company) throw new NotFoundError(deps.definition.notFoundMessage);
      return { companyName: company.CompanyName, ...companiesRepository.countRelatedRecords(companyId) };
    },
  };
}

module.exports = { createCompaniesService };
