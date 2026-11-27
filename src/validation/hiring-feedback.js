'use strict';

const { z } = require('zod');
const v = require('./common');
const { FEEDBACK_PROVIDERS, FEEDBACK_HIRED_VALUES } = require('../domain/enums');

/** Body of POST /api/hiring-feedback and PUT /api/hiring-feedback/:id. */
const bodySchema = z.object({
  CompanyID: v.positiveId('Employer'),
  ContactID: v.positiveId('Contact'),
  FeedbackProvider: v.enumOf('Feedback provider', FEEDBACK_PROVIDERS),
  HiredStudentAlumni: v.enumOf('Hired student or alumni', FEEDBACK_HIRED_VALUES),
  DateReported: v.isoDate('Date reported'),
  HiredStudentName: v.optionalText('Hired student name'),
  Comment: v.optionalText('Comment', { max: 2000 }),
});

/** Query of GET /api/hiring-feedback. */
const listQuerySchema = z.object({
  feedbackProvider: v.optionalText('Feedback provider', { max: 100 }),
  hiredStudentAlumni: v.optionalText('Hired student or alumni', { max: 100 }),
  ...v.dateRangeQuery(),
});

module.exports = { bodySchema, listQuerySchema };
