'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');
const { NotFoundError } = require('../../lib/errors');
const { canAccessRecord, can, sensitiveFieldsFor, PERMISSIONS: P } = require('../../security/permissions');
const authorize = require('../../security/authorize');
const { parseListQuery, buildList, PAGE_SIZE } = require('../list');
const { formState, redirectWithMessage, safeLocalPath } = require('../render');
const { valuesFromRecord, bodyFromForm, formFromError } = require('../forms');
const { EVENT_SCREENS, screenFor } = require('../screens');
const { renderErrorPage } = require('../errors');

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const ID_RE = /^[1-9]\d{0,9}$/;

/** The id route parameter as a number; a 404 for anything else. */
function idOf(req) {
  if (!ID_RE.test(req.params.id)) throw new NotFoundError();
  return Number(req.params.id);
}

/**
 * The employers and contacts the record forms offer.
 * @param {object} services
 * @param {object} ctx
 * @param {string|number} [companyId]  the chosen employer, whose contacts are listed
 */
function formChoices(services, ctx, companyId) {
  const companies = services.records.get('companies').service;
  const employers = companies
    .page({ sort: 'name', dir: 'asc', pageSize: 10000 }, ctx)
    .rows.map((row) => ({ value: row.CompanyID, label: row.CompanyName }));
  let contacts = [];
  if (companyId && ID_RE.test(String(companyId)) && authorize.canReadRecordType(ctx, 'contacts')) {
    contacts = services.records
      .get('contacts')
      .service.page({ filters: { companyId: String(companyId) }, sort: 'name', dir: 'asc', pageSize: 1000 }, ctx)
      .rows.map((row) => ({ value: row.ContactID, label: `${row.FirstName} ${row.LastName}` }));
  }
  return { employers, contacts };
}

/** The list query spec of a screen (filters, sorts) for parseListQuery. */
const listSpec = (screen) => ({ filters: screen.filters, sorts: screen.sorts, defaultSort: screen.defaultSort });

/** Where the list of a screen lives, e.g. /events?tab=academic. */
const listHrefOf = (screen) => (screen.tab ? `${screen.listPath}?tab=${screen.tab}` : screen.base);

/**
 * Render one page of a screen's list.
 * @param {object} extra  more locals (tabs)
 */
function renderList(req, res, services, screen, extra = {}) {
  const service = services.records.get(screen.recordType).service;
  const params = parseListQuery(req.query, listSpec(screen));
  const result = service.page(
    {
      filters: { q: params.q, ...params.filters },
      sort: params.sort,
      dir: params.dir,
      page: params.page,
      pageSize: PAGE_SIZE,
    },
    req.ctx
  );
  const list = buildList({
    basePath: screen.listPath ?? screen.base,
    params,
    result,
    sorts: screen.sorts,
    fixed: screen.tab ? { tab: screen.tab } : {},
  });
  res.render('records/list.njk', {
    screen,
    list,
    listHref: listHrefOf(screen),
    can: { create: canAccessRecord(req.user, P.RECORD_CREATE, screen.recordType) },
    ...extra,
  });
}

/**
 * The pages of one record type: list (unless the screen has its own), new,
 * create, detail (unless it has its own), edit, update and delete.
 *
 * @param {object} deps
 * @param {object} deps.services
 * @param {object} deps.screen  an entry of SCREENS
 * @param {boolean} [deps.list]  serve the generic list at screen.base
 * @param {boolean} [deps.detail]  serve the generic detail page
 * @param {(record: object, ctx: object) => string} [deps.deleteText]  what deleting removes
 */
function createRecordController({ services, screen, list = true, detail = true, deleteText }) {
  const router = express.Router();
  const type = screen.recordType;
  const service = services.records.get(type).service;
  const hasContact = screen.fields.some((field) => field.control === 'contact');
  const Singular = capitalize(screen.singular);

  const withheldFor = (user) => (can(user, P.SENSITIVE_READ) ? [] : sensitiveFieldsFor(type));

  function renderForm(req, res, { status = 200, form, record = null }) {
    const id = record ? record[screen.idField] : null;
    const name = record ? screen.nameOf(record) : '';
    const returnTo = safeLocalPath(req.body?.returnTo) || safeLocalPath(req.query.returnTo) || '';
    const formTitle = record ? `Edit ${name}` : type === 'outreach' ? 'Log interaction' : `Add ${screen.singular}`;
    res.status(status).render('records/form.njk', {
      screen,
      form,
      formTitle,
      action: record ? `${screen.base}/${id}` : screen.base,
      submitLabel: record ? 'Save changes' : `Save ${screen.singular}`,
      cancelHref: returnTo || (record ? `${screen.base}/${id}` : listHrefOf(screen)),
      options: formChoices(services, req.ctx, form.values.CompanyID),
      withheld: withheldFor(req.user),
      hasContact,
      returnTo,
      breadcrumb: [
        { label: screen.tab ? screen.tabLabel : screen.title, href: listHrefOf(screen) },
        ...(record ? [{ label: name, href: `${screen.base}/${id}` }] : []),
        { label: record ? 'Edit' : 'New' },
      ],
    });
  }

  /** After a save: back to where the form was opened from, else the record. */
  const destinationAfterSave = (req, saved) =>
    safeLocalPath(req.body.returnTo) || `${screen.base}/${saved[screen.idField]}`;

  if (list) {
    router.get(
      screen.base,
      asyncHandler((req, res) => renderList(req, res, services, screen))
    );
  }

  router.get(
    `${screen.base}/new`,
    asyncHandler((req, res) => {
      authorize.requireRecordAccess(req.ctx, P.RECORD_CREATE, type);
      const values = valuesFromRecord(screen, {});
      delete values.UpdatedAt;
      for (const key of ['CompanyID', 'ContactID']) {
        if (typeof req.query[key] === 'string' && ID_RE.test(req.query[key])) values[key] = req.query[key];
      }
      renderForm(req, res, { form: formState(values) });
    })
  );

  router.post(
    screen.base,
    asyncHandler((req, res) => {
      const body = bodyFromForm(screen, req.body);
      try {
        const saved = service.create(body, req.ctx);
        return redirectWithMessage(req, res, destinationAfterSave(req, saved), `${Singular} saved`);
      } catch (err) {
        const failed = formFromError(err, body);
        if (!failed) throw err;
        return renderForm(req, res, failed);
      }
    })
  );

  if (detail) {
    router.get(
      `${screen.base}/:id`,
      asyncHandler((req, res) => {
        const record = service.get(idOf(req), req.ctx);
        const name = screen.nameOf(record);
        let timeline = null;
        if (type === 'contacts' && authorize.canReadRecordType(req.ctx, 'outreach')) {
          timeline = services.records
            .get('outreach')
            .service.page({ filters: { contactId: String(record.ContactID) }, pageSize: 100 }, req.ctx)
            .rows.map((row) => ({
              title: row.InteractionType,
              date: row.InteractionDate,
              summary: row.DiscussionItems,
              href: `/interactions/${row.OutreachEngagementID}`,
            }));
        }
        res.render('records/detail.njk', {
          screen,
          record,
          name,
          timeline,
          deleteText: deleteText
            ? deleteText(record, req.ctx)
            : `This permanently deletes the ${screen.singular}. It cannot be undone.`,
          breadcrumb: [
            { label: screen.tab ? screen.tabLabel : screen.title, href: listHrefOf(screen) },
            { label: name },
          ],
          can: {
            update: canAccessRecord(req.user, P.RECORD_UPDATE, type),
            delete: canAccessRecord(req.user, P.RECORD_DELETE, type),
            logInteraction: type === 'contacts' && canAccessRecord(req.user, P.RECORD_CREATE, 'outreach'),
          },
        });
      })
    );
  }

  router.get(
    `${screen.base}/:id/edit`,
    asyncHandler((req, res) => {
      authorize.requireRecordAccess(req.ctx, P.RECORD_UPDATE, type);
      const record = service.get(idOf(req), req.ctx);
      renderForm(req, res, { form: formState(valuesFromRecord(screen, record)), record });
    })
  );

  router.post(
    `${screen.base}/:id`,
    asyncHandler((req, res) => {
      const id = idOf(req);
      const record = service.get(id, req.ctx);
      const body = bodyFromForm(screen, req.body);
      try {
        const saved = service.update(id, body, req.ctx);
        return redirectWithMessage(req, res, destinationAfterSave(req, saved), `${Singular} saved`);
      } catch (err) {
        const failed = formFromError(err, body);
        if (!failed) throw err;
        return renderForm(req, res, { ...failed, record });
      }
    })
  );

  router.post(
    `${screen.base}/:id/delete`,
    asyncHandler((req, res) => {
      const id = idOf(req);
      const record = service.get(id, req.ctx);
      service.remove(id, req.ctx);
      return redirectWithMessage(req, res, listHrefOf(screen), `${screen.nameOf(record)} deleted`);
    })
  );

  return router;
}

/**
 * /events: one page, three tabs (career events, student-led, academic), each
 * the generic list of its record type. Only the tabs the role may read appear.
 */
function createEventsController({ services }) {
  const router = express.Router();
  router.get(
    '/events',
    asyncHandler((req, res) => {
      const readable = EVENT_SCREENS.filter((screen) => authorize.canReadRecordType(req.ctx, screen.recordType));
      if (!readable.length) return renderErrorPage(req, res, 403);
      const requested = typeof req.query.tab === 'string' ? req.query.tab : '';
      const screen = readable.find((candidate) => candidate.tab === requested) ?? readable[0];
      const tabs = readable.map((candidate) => ({
        label: candidate.tabLabel,
        href: listHrefOf(candidate),
        current: candidate === screen,
      }));
      return renderList(req, res, services, screen, { tabs });
    })
  );
  return router;
}

/**
 * GET /options/contacts?CompanyID=: the contact select of a record form,
 * narrowed to the chosen employer's contacts. htmx swaps it into the form.
 */
function createOptionsController({ services }) {
  const router = express.Router();
  router.get(
    '/options/contacts',
    asyncHandler((req, res, next) => {
      authorize.requireRecordAccess(req.ctx, P.RECORD_READ, 'contacts');
      const companyId = typeof req.query.CompanyID === 'string' ? req.query.CompanyID : '';
      const { contacts } = formChoices(services, req.ctx, companyId);
      const field = screenFor('outreach').fields.find((candidate) => candidate.control === 'contact');
      // app.render, not res.render: a fragment must not use up the page's one-time messages.
      req.app.render(
        'records/_contact-select.njk',
        { field, options: { contacts }, form: formState({ CompanyID: companyId, ContactID: '' }) },
        (err, html) => (err ? next(err) : res.type('html').send(html))
      );
    })
  );
  return router;
}

module.exports = { createRecordController, createEventsController, createOptionsController, formChoices };
