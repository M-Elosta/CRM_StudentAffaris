'use strict';

const { z } = require('zod');
const v = require('./common');
const { RECRUITMENT_MODES, PAY_STATUSES, TARGET_GROUPS, RECRUITMENT_HIRED_VALUES } = require('../domain/enums');

/** Body of POST /api/recruitment and PUT /api/recruitment/:id, including the four child arrays. */
const bodySchema = z.object({
  CompanyID: v.positiveId('Employer'),
  ContactID: v.positiveId('Contact'),
  DatePosted: v.optionalIsoDate('Date posted'),
  OpportunityTitle: v.requiredText('Opportunity title'),
  Duration: v.optionalText('Duration', { max: 100 }),
  HiringStartDate: v.optionalIsoDate('Hiring start date'),
  HiringEndDate: v.optionalIsoDate('Hiring end date'),
  Country: v.optionalText('Country', { max: 100 }),
  Mode: v.enumOf('Mode', RECRUITMENT_MODES),
  Status: v.enumOf('Pay status', PAY_STATUSES),
  PayAmount: v.optionalText('Pay amount', { max: 100 }),
  TargetGroup: v.enumOf('Target group', TARGET_GROUPS),
  ArabicSpeaker: v.booleanFlag(),
  HiredStudentAlumni: v.optionalEnumOf('Hired student or alumni', RECRUITMENT_HIRED_VALUES, 'Not Reported'),
  Comment: v.optionalText('Comment', { max: 2000 }),
  OpportunityTypes: v.stringArray('Opportunity types'),
  CollectApplications: v.stringArray('Application channels'),
  TargetMajors: v.stringArray('Target majors'),
  ClassLevels: v.stringArray('Class levels'),
});

/** Query of GET /api/recruitment. */
const listQuerySchema = z.object({
  companyId: v.optionalPositiveId('Employer'),
  mode: v.optionalText('Mode', { max: 100 }),
  status: v.optionalText('Pay status', { max: 100 }),
  targetGroup: v.optionalText('Target group', { max: 100 }),
  ...v.dateRangeQuery(),
});

module.exports = { bodySchema, listQuerySchema };
