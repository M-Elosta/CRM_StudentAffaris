'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');
const { NotFoundError } = require('../../lib/errors');
const { canAccessRecord, PERMISSIONS: P } = require('../../security/permissions');
const { isHtmx, redirectWithMessage } = require('../render');
const { toastHeader } = require('../flash');

const GROUPS = [
  { key: 'overdue', title: 'Overdue', empty: 'Nothing is overdue.' },
  { key: 'week', title: 'This week', empty: 'Nothing is due in the next seven days.' },
  { key: 'later', title: 'Later', empty: 'Nothing is planned further ahead.' },
];

/**
 * /follow-ups: open follow-ups (In-progress interactions with a follow-up
 * date) grouped as overdue, this week and later, each with "Mark complete".
 * @param {{ services: object }} deps
 */
function createFollowUpsController({ services }) {
  const router = express.Router();

  router.get(
    '/follow-ups',
    asyncHandler((req, res) => {
      const groups = services.activity.followUps(req.ctx);
      res.render('follow-ups/index.njk', {
        groups: GROUPS.map((group) => ({ ...group, items: groups[group.key] })),
        total: groups.overdue.length + groups.week.length + groups.later.length,
        can: { complete: canAccessRecord(req.user, P.RECORD_UPDATE, 'outreach') },
      });
    })
  );

  router.post(
    '/follow-ups/:id/complete',
    asyncHandler((req, res) => {
      if (!/^[1-9]\d{0,9}$/.test(req.params.id)) throw new NotFoundError();
      const saved = services.activity.completeFollowUp(Number(req.params.id), req.ctx);
      const message = `Follow-up with ${saved.CompanyName ?? 'the employer'} marked complete`;
      if (!isHtmx(req)) return redirectWithMessage(req, res, '/follow-ups', message);
      // In place: the row shows it is done, and the sidebar count goes down.
      toastHeader(res, message);
      return res.render('follow-ups/_completed.njk', { item: saved });
    })
  );

  return router;
}

module.exports = { createFollowUpsController };
