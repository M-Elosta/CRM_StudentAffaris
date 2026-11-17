'use strict';

const { z } = require('zod');
const v = require('./common');
const { COLLABORATION_OUTCOMES } = require('../domain/enums');

/** Body of POST /api/student-events and PUT /api/student-events/:id. */
const bodySchema = z.object({
  CompanyID: v.positiveId('Employer'),
  ContactID: v.positiveId('Contact'),
  ProposalDate: v.isoDate('Proposal date'),
  OrganizationName: v.requiredText('Organization name'),
  StudentName: v.requiredText('Student name'),
  StudentEmail: v.email('Student email address'),
  StudentPhoneNumber: v.requiredText('Student phone number', { max: 50 }),
  CollaborationOutcome: v.optionalEnumOf('Collaboration outcome', COLLABORATION_OUTCOMES, 'Pending'),
  EventDate: v.optionalIsoDate('Event date'),
  EventTitle: v.optionalText('Event title'),
  Comment: v.optionalText('Comment', { max: 2000 }),
});

/** Query of GET /api/student-events. */
const listQuerySchema = z.object({
  collaborationOutcome: v.optionalText('Collaboration outcome', { max: 100 }),
  ...v.dateRangeQuery(),
});

module.exports = { bodySchema, listQuerySchema };
