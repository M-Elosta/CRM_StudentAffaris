'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');
const { todayInTimeZone } = require('../../lib/dates');
const authorize = require('../../security/authorize');
const { activityHref } = require('../forms');
const { lastMonths, monthlyChart, monthRange } = require('../charts');

/**
 * The dashboard: key figures, follow-ups due, recent activity and two charts,
 * all in the first response. Figures the role may not read are left out.
 * @param {{ services: object, config: object }} deps
 */
function createDashboardController({ services, config }) {
  const router = express.Router();
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: config.timeZone, weekday: 'long' });

  router.get(
    '/dashboard',
    asyncHandler((req, res) => {
      const ctx = req.ctx;
      const today = todayInTimeZone(config.timeZone);
      const readable = (type) => authorize.canReadRecordType(ctx, type);
      const total = (type, filters) => services.records.get(type).service.page({ filters, pageSize: 1 }, ctx).total;

      const stats = [];
      if (readable('companies')) {
        stats.push({ label: 'Active employers', value: total('companies', { status: 'active' }), href: '/employers' });
      }
      if (readable('contacts')) stats.push({ label: 'Contacts', value: total('contacts', {}), href: '/contacts' });
      let followUps = null;
      if (readable('outreach')) {
        stats.push({
          label: 'Interactions this month',
          value: total('outreach', monthRange(today)),
          href: '/interactions',
        });
        followUps = services.activity.followUpsDueSoon(ctx, 8);
        stats.push({
          label: 'Follow-ups due',
          value: followUps.total,
          note: followUps.overdue ? `${followUps.overdue} overdue` : 'None overdue',
          href: '/follow-ups',
        });
      }

      const months = lastMonths(today, 12);
      const range = { from: `${months[0]}-01`, to: monthRange(today).to };
      const charts = [];
      if (readable('outreach')) {
        charts.push({
          id: 'chart-interactions',
          title: 'Interactions per month',
          spec: monthlyChart(months, services.dashboard.outreachByMonth(range), { label: 'Interactions' }),
        });
      }
      if (readable('companies')) {
        charts.push({
          id: 'chart-employers',
          title: 'New employers per month',
          spec: monthlyChart(months, services.dashboard.companiesByMonth(range), { label: 'New employers' }),
        });
      }

      const recent = readable('companies')
        ? services.activity.recent(ctx, 8).map((item) => ({ ...item, href: activityHref(item) }))
        : [];

      res.render('dashboard/index.njk', {
        today,
        weekday: weekday.format(new Date()),
        stats,
        followUps,
        recent,
        charts,
      });
    })
  );

  return router;
}

module.exports = { createDashboardController };
