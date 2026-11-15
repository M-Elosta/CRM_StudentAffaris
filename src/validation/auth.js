'use strict';

const { z } = require('zod');
const v = require('./common');

/** Body of POST /api/auth/login. */
const loginSchema = z.object({
  username: v.requiredText('Username', { max: 64 }),
  password: v.exactText('Password'),
});

/** Body of POST /api/auth/change-password. */
const changePasswordSchema = z.object({
  currentPassword: v.exactText('Current password'),
  newPassword: v.newPassword('New password'),
});

module.exports = { loginSchema, changePasswordSchema };
