'use strict';

const { z } = require('zod');
const v = require('./common');
const { REGISTERED_STATUSES } = require('../domain/enums');

/** Body of POST /api/career-events and PUT /api/career-events/:id. */
const bodySchema = z.object({
  CompanyID: v.positiveId('Employer'),
  ContactID: v.positiveId('Contact'),
  EventName: v.requiredText('Event name'),
  EventDate: v.isoDate('Event date'),
  RegisteredStatus: v.enumOf('Registered status', REGISTERED_STATUSES),
  CMUQAlumniAtBooth: v.booleanFlag(),
  Comment: v.optionalText('Comment', { max: 2000 }),
});

/** Query of GET /api/career-events. */
const listQuerySchema = z.object({
  eventName: v.optionalText('Event name', { max: 100 }),
  registeredStatus: v.optionalText('Registered status', { max: 100 }),
  ...v.dateRangeQuery(),
});

module.exports = { bodySchema, listQuerySchema };
