'use strict';

const { z } = require('zod');
const v = require('./common');

/** Query of every /api/dashboard/* endpoint: an optional date range. */
const dateRangeQuerySchema = z.object(v.dateRangeQuery());

module.exports = { dateRangeQuerySchema };
