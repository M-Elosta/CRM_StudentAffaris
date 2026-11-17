'use strict';

const express = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../lib/async-handler');
const { requireAdminSession } = require('../middleware/auth');
const { parseWith } = require('../validation/common');
const { createUserSchema, roleChangeSchema, userIdSchema } = require('../validation/users');

const idParamSchema = z.object({ id: userIdSchema });

/**
 * /api/users: admin-only user administration.
 * @param {ReturnType<import('../services/users-service').createUsersService>} usersService
 */
function createUsersRouter(usersService) {
  const router = express.Router();
  router.use(requireAdminSession);

  const targetId = (req) => parseWith(idParamSchema, req.params).id;

  router.get(
    '/',
    asyncHandler((_req, res) => {
      res.json(usersService.list());
    })
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const user = await usersService.create(parseWith(createUserSchema, req.body));
      res.status(201).json(user);
    })
  );

  router.patch(
    '/:id/role',
    asyncHandler((req, res) => {
      const id = targetId(req);
      const { role } = parseWith(roleChangeSchema, req.body);
      usersService.changeRole(req.user.id, id, role);
      res.json({ success: true });
    })
  );

  router.delete(
    '/:id',
    asyncHandler((req, res) => {
      usersService.remove(req.user.id, targetId(req));
      res.json({ success: true });
    })
  );

  return router;
}

module.exports = { createUsersRouter };
