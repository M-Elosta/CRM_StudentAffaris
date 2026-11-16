'use strict';

const { RECORD_TYPES } = require('../domain/record-types');
const { createCrudRepository } = require('../db/repositories/crud-repository');
const { createCompaniesRepository } = require('../db/repositories/companies-repository');
const { createRecordService } = require('./record-service');
const { createCompaniesService } = require('./companies-service');
const { createContactsService } = require('./contacts-service');
const { createUsersRepository } = require('../db/repositories/users-repository');
const { createSessionsRepository } = require('../db/repositories/sessions-repository');
const { createUsersService } = require('./users-service');
const { createAuthService } = require('./auth-service');
const { createDashboardRepository } = require('../db/repositories/dashboard-repository');
const { createDashboardService } = require('./dashboard-service');
const { createMetaRepository } = require('../db/repositories/meta-repository');
const { createMetaService } = require('./meta-service');
const { createImportRepository } = require('../db/repositories/import-repository');
const { createImportService } = require('./import-service');
const { createReportsRepository } = require('../db/repositories/reports-repository');
const { createReportsService } = require('./reports');
const { createActivityRepository } = require('../db/repositories/activity-repository');
const { createActivityService } = require('./activity-service');

/** The zod schema module of each record type, by API path. */
const RECORD_SCHEMAS = {
  companies: require('../validation/companies'),
  contacts: require('../validation/contacts'),
  outreach: require('../validation/outreach'),
  recruitment: require('../validation/recruitment'),
  'career-events': require('../validation/career-events'),
  collaboration: require('../validation/collaboration'),
  academic: require('../validation/academic'),
  'student-events': require('../validation/student-events'),
  'hiring-feedback': require('../validation/hiring-feedback'),
};

const SPECIAL_RECORD_SERVICES = {
  companies: createCompaniesService,
  contacts: createContactsService,
};

/** Build the repository and service of every record type. Returns Map<path, { service, schema }>. */
function createRecordServices({ db, timeZone }) {
  const repositories = new Map(
    RECORD_TYPES.map((definition) => [definition.path, createCrudRepository(db, definition)])
  );
  const lookups = {
    findCompany: (id) => repositories.get('companies').getStoredById(id),
    findContact: (id) => repositories.get('contacts').getStoredById(id),
  };
  const companiesRepository = createCompaniesRepository(db);

  const services = new Map();
  for (const definition of RECORD_TYPES) {
    const schema = RECORD_SCHEMAS[definition.path];
    const factory = SPECIAL_RECORD_SERVICES[definition.path] || createRecordService;
    const service = factory({
      db,
      repository: repositories.get(definition.path),
      definition,
      schema,
      lookups,
      timeZone,
      companiesRepository,
    });
    services.set(definition.path, { service, schema });
  }
  return services;
}

/**
 * Build every service once, around one database connection.
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {object} deps.config  result of loadConfig()
 * @param {{ info: Function, warn: Function, error: Function }} [deps.logger]
 */
function createServices({ db, config, logger = console }) {
  const records = createRecordServices({ db, timeZone: config.timeZone });
  const usersRepository = createUsersRepository(db);
  const sessionsRepository = createSessionsRepository(db);
  return {
    records,
    users: createUsersService({ db, usersRepository, sessionsRepository }),
    auth: createAuthService({ db, usersRepository, sessionsRepository }),
    dashboard: createDashboardService({
      dashboardRepository: createDashboardRepository(db),
      timeZone: config.timeZone,
    }),
    meta: createMetaService({ metaRepository: createMetaRepository(db) }),
    import: createImportService({
      db,
      recordServices: records,
      importRepository: createImportRepository(db),
      logger,
    }),
    activity: createActivityService({
      activityRepository: createActivityRepository(db),
      records,
      timeZone: config.timeZone,
    }),
    reports: createReportsService({ reportsRepository: createReportsRepository(db), timeZone: config.timeZone }),
  };
}

module.exports = { createServices };
