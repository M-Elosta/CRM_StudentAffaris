'use strict';

const { z } = require('zod');
const v = require('./common');

/** Body of POST /api/collaboration and PUT /api/collaboration/:id, including the opportunities. */
const bodySchema = z.object({
  CompanyID: v.positiveId('Employer'),
  Comment: v.optionalText('Comment', { max: 2000 }),
  Opportunities: v.stringArray('Opportunities'),
});

/** GET /api/collaboration takes no filters. */
const listQuerySchema = z.object({});

module.exports = { bodySchema, listQuerySchema };
