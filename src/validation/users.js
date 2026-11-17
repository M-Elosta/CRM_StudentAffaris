'use strict';

const { z } = require('zod');
const v = require('./common');
const { USER_ROLES } = require('../domain/enums');

/** Body of POST /api/users. */
const createUserSchema = z.object({
  username: v.username('Username'),
  password: v.newPassword('Password'),
  role: v.enumOf('Role', USER_ROLES),
});

/** Body of PATCH /api/users/:id/role. */
const roleChangeSchema = z.object({
  role: v.enumOf('Role', USER_ROLES),
});

/** The :id route parameter. */
const userIdSchema = v.positiveId('User ID');

module.exports = { createUserSchema, roleChangeSchema, userIdSchema };
