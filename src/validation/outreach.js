'use strict';

const { z } = require('zod');
const v = require('./common');
const { INTERACTION_TYPES, INTERACTION_STATUSES } = require('../domain/enums');

/** Body of POST /api/outreach and PUT /api/outreach/:id. */
const bodySchema = z.object({
  CompanyID: v.positiveId('Employer'),
  ContactID: v.positiveId('Contact'),
  InteractionType: v.enumOf('Interaction type', INTERACTION_TYPES),
  InteractionDate: v.isoDate('Interaction date'),
  DiscussionItems: v.requiredText('Discussion items', { max: 2000 }),
  ActionPlan: v.optionalText('Action plan', { max: 2000 }),
  FollowUpDate: v.optionalIsoDate('Follow-up date'),
  InteractionStatus: v.optionalEnumOf('Interaction status', INTERACTION_STATUSES, 'In-progress'),
});

/** Query of GET /api/outreach. */
const listQuerySchema = z.object({
  companyId: v.optionalPositiveId('Employer'),
  contactId: v.optionalPositiveId('Contact'),
  interactionType: v.optionalEnumOf('Interaction type', INTERACTION_TYPES),
  interactionStatus: v.optionalEnumOf('Interaction status', INTERACTION_STATUSES),
  ...v.dateRangeQuery(),
});

module.exports = { bodySchema, listQuerySchema };
