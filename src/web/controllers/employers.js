'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');
const { workbookBufferFromJson } = require('../../lib/excel');
const { SECTORS } = require('../../domain/enums');
const { canAccessRecord, can, PERMISSIONS: P } = require('../../security/permissions');
const authorize = require('../../security/authorize');
const { parseListQuery, buildList, PAGE_SIZE } = require('../list');
const { activityHref } = require('../forms');
const { screenFor } = require('../screens');
const { createRecordController } = require('./records');

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EVENT_TYPES = ['career-events', 'student-events', 'academic'];

const REGIONS = [
  { value: 'qatar', label: 'Qatar' },
  { value: 'gcc', label: 'GCC' },
  { value: 'international', label: 'International' },
];
const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'dormant', label: 'Dormant (no activity in 180 days)' },
  { value: 'do-not-engage', label: 'Do not engage' },
  { value: 'key-partner', label: 'Key partner' },
  { value: 'mou', label: 'Signed MoU' },
];
const VIEWS = [
  { value: '', label: 'All' },
  { value: 'key-partner', label: 'Key partners' },
  { value: 'dormant', label: 'Dormant' },
  { value: 'do-not-engage', label: 'Do not engage' },
];

const LIST_SPEC = {
  filters: [
    { param: 'sector', options: SECTORS },
    { param: 'region', options: REGIONS },
    { param: 'status', options: STATUSES },
    { param: 'view', options: VIEWS.filter((view) => view.value) },
  ],
  sorts: screenFor('companies').sorts,
  defaultSort: screenFor('companies').defaultSort,
};

const PROFILE_TABS = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'contacts', label: 'Contacts', type: 'contacts' },
  { key: 'postings', label: 'Postings', type: 'recruitment' },
  { key: 'events', label: 'Events' },
  { key: 'notes', label: 'Notes' },
];

/** The status words of an employer list row, for the spreadsheet. */
function statusText(row) {
  const parts = [row.Blacklisted ? 'Do not engage' : row.isDormant ? 'Dormant' : 'Active'];
  if (row.FavoriteEmployer) parts.push('Key partner');
  if (row.SignedMoU) parts.push('MoU');
  return parts.join(', ');
}

/**
 * Employers: the reference list, the profile, and (through the generic
 * record controller) the form, create, update and delete.
 * @param {{ services: object }} deps
 */
function createEmployersController({ services }) {
  const router = express.Router();
  const companies = services.records.get('companies').service;
  const screen = screenFor('companies');

  router.get(
    '/employers',
    asyncHandler(async (req, res) => {
      const params = parseListQuery(req.query, LIST_SPEC);
      const query = { filters: { q: params.q, ...params.filters }, sort: params.sort, dir: params.dir };

      if (req.query.format === 'xlsx') {
        authorize.requirePermission(req.ctx, P.EXPORT_RUN);
        const { rows } = companies.page({ ...query, page: 1, pageSize: 10000 }, req.ctx);
        const sheet = rows.map((row) => ({
          Employer: row.CompanyName,
          Industry: row.Industry,
          Sector: row.Sector,
          Country: row.Country,
          'Last contact': row.lastContactAt ?? '',
          Contacts: row.contactCount,
          Status: statusText(row),
          Website: row.Website ?? '',
          'Date added': row.DateAdded ?? '',
        }));
        const buffer = await workbookBufferFromJson('Employers', sheet);
        res.set('Content-Disposition', 'attachment; filename="employers.xlsx"');
        return res.type(XLSX_TYPE).send(buffer);
      }

      const result = companies.page({ ...query, page: params.page, pageSize: PAGE_SIZE }, req.ctx);
      const list = buildList({ basePath: '/employers', params, result, sorts: screen.sorts });
      list.activeView = params.filters.view ?? '';
      return res.render('employers/list.njk', {
        list,
        views: VIEWS.map((view) => ({
          label: view.label,
          href: view.value ? `/employers?view=${view.value}` : '/employers',
          current: (params.filters.view ?? '') === view.value,
        })),
        options: { sectors: SECTORS, regions: REGIONS, statuses: STATUSES },
        can: {
          create: canAccessRecord(req.user, P.RECORD_CREATE, 'companies'),
          export: can(req.user, P.EXPORT_RUN),
          import: false,
        },
      });
    })
  );

  router.get(
    '/employers/:id',
    asyncHandler((req, res, next) => {
      // Not an id (e.g. /employers/new): the record controller below handles it.
      if (!/^[1-9]\d{0,9}$/.test(req.params.id)) return next();
      const id = Number(req.params.id);
      const employer = companies.get(id, req.ctx);
      const counts = companies.relatedCounts(id, req.ctx);
      const summary = services.activity.contactSummary(employer, req.ctx);
      const readable = (type) => authorize.canReadRecordType(req.ctx, type);

      const tabs = PROFILE_TABS.filter((tab) => !tab.type || readable(tab.type));
      const requested = typeof req.query.tab === 'string' ? req.query.tab : 'timeline';
      const tab = tabs.find((candidate) => candidate.key === requested) ?? tabs[0];
      const activity = services.activity.forCompany(id, req.ctx).map((item) => ({ ...item, href: activityHref(item) }));
      const tabCounts = {
        timeline: activity.length,
        contacts: counts.contacts,
        postings: counts.recruitment,
        events: activity.filter((item) => EVENT_TYPES.includes(item.type)).length,
      };

      const panel = { key: tab.key };
      if (tab.key === 'timeline') panel.items = activity;
      if (tab.key === 'events') panel.items = activity.filter((item) => EVENT_TYPES.includes(item.type));
      if (tab.key === 'contacts' || tab.key === 'postings') {
        const type = tab.key === 'contacts' ? 'contacts' : 'recruitment';
        const tabScreen = screenFor(type);
        panel.screen = tabScreen;
        panel.columns = tabScreen.columns.filter((column) => column.field !== 'CompanyName');
        panel.rows = services.records
          .get(type)
          .service.page({ filters: { companyId: String(id) }, pageSize: 500 }, req.ctx).rows;
      }

      const here = `/employers/${id}`;
      res.render('employers/profile.njk', {
        employer,
        summary,
        tabs: tabs.map((candidate) => ({
          ...candidate,
          href: candidate.key === 'timeline' ? here : `${here}?tab=${candidate.key}`,
          count: tabCounts[candidate.key],
          current: candidate === tab,
        })),
        panel,
        followUps: services.activity.followUpsForCompany(id, req.ctx),
        returnTo: encodeURIComponent(here),
        deleteText: deleteTextFor(employer, counts),
        can: {
          update: canAccessRecord(req.user, P.RECORD_UPDATE, 'companies'),
          delete: canAccessRecord(req.user, P.RECORD_DELETE, 'companies'),
          logInteraction: canAccessRecord(req.user, P.RECORD_CREATE, 'outreach'),
          addContact: canAccessRecord(req.user, P.RECORD_CREATE, 'contacts'),
          readInteractions: readable('outreach'),
        },
      });
    })
  );

  /** What deleting an employer removes with it. */
  function deleteTextFor(employer, counts) {
    const parts = [
      [counts.contacts, 'contact'],
      [counts.outreach, 'interaction'],
      [counts.recruitment, 'posting'],
      [counts.events, 'career event'],
    ]
      .filter(([count]) => count > 0)
      .map(([count, noun]) => `${count} ${noun}${count === 1 ? '' : 's'}`);
    const related = parts.length ? ` together with its ${parts.join(', ')}` : '';
    return `This permanently deletes ${employer.CompanyName}${related}. It cannot be undone.`;
  }

  router.use(
    createRecordController({
      services,
      screen,
      list: false,
      detail: false,
      deleteText: (record, ctx) => deleteTextFor(record, companies.relatedCounts(record.CompanyID, ctx)),
    })
  );

  return router;
}

module.exports = { createEmployersController };
