'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');
const { addDaysToIsoDate, todayInTimeZone, isRealIsoDate } = require('../../lib/dates');
const { can, PERMISSIONS: P } = require('../../security/permissions');
const { semesterOf } = require('../../services/reports/periods');
const { quickReportQuerySchema } = require('../../validation/reports');
const { fromReportChart } = require('../charts');

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The academic year (Aug-May) a date falls in, as its key '2026-27'; June and July count with the year before. */
function academicYearKeyOf(date) {
  const year = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 8 ? year : year - 1;
  return { key: `${start}-${String(start + 1).slice(-2)}`, label: `AY${start}-${String(start + 1).slice(-2)}` };
}

/** The period presets of the report form, for today. */
function presetsFor(today) {
  const current = semesterOf(today);
  const previous = semesterOf(addDaysToIsoDate(current.from, -1));
  const year = academicYearKeyOf(today);
  return [
    { value: 'this-semester', label: `This semester (${current.label})`, query: { semester: current.key } },
    { value: 'last-semester', label: `Last semester (${previous.label})`, query: { semester: previous.key } },
    { value: 'this-year', label: `This academic year (${year.label})`, query: { academicYear: year.key } },
    { value: 'all', label: 'All time', query: {} },
    { value: 'custom', label: 'Custom dates', query: null },
  ];
}

const textOf = (value) => (typeof value === 'string' ? value : '');

/**
 * /reports: the reports the role may run; /reports/:type: one report for a
 * period, as a table with at most one chart, exportable and printable.
 * @param {{ services: object, config: object }} deps
 */
function createReportsController({ services, config }) {
  const router = express.Router();

  router.get(
    '/reports',
    asyncHandler((req, res) => {
      res.render('reports/index.njk', { groups: services.reports.catalog(req.ctx) });
    })
  );

  router.get(
    '/reports/:type',
    asyncHandler(async (req, res) => {
      const report = services.reports.reportFor(req.params.type, req.ctx);
      const presets = presetsFor(todayInTimeZone(config.timeZone));
      const from = isRealIsoDate(textOf(req.query.from)) ? req.query.from : '';
      const to = isRealIsoDate(textOf(req.query.to)) ? req.query.to : '';
      const requested = textOf(req.query.period) || (from || to ? 'custom' : 'this-year');
      const preset = presets.find((candidate) => candidate.value === requested) ?? presets[2];
      const raw = preset.query ?? { from, to };

      const parsed = quickReportQuerySchema.safeParse(report.period ? raw : {});
      const error = parsed.success ? '' : parsed.error.issues[0].message;
      const query = parsed.success ? parsed.data : null;
      const formValues = { period: preset.value, from, to };

      if (req.query.format === 'xlsx' && query) {
        const { fileName, buffer } = await services.reports.exportForUser(report.type, query, req.ctx);
        res.set('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.type(XLSX_TYPE).send(buffer);
      }

      const result = query ? services.reports.runForUser(report.type, query, req.ctx) : null;
      const columns = result?.rows.length ? Object.keys(result.rows[0]) : [];
      const exportQuery = new URLSearchParams({ ...formValues, format: 'xlsx' }).toString();
      return res.status(error ? 422 : 200).render('reports/show.njk', {
        report,
        presets,
        now: new Date(),
        form: { values: formValues, errors: error ? { from: error } : {} },
        error,
        result,
        columns,
        numeric: columns.map((column) =>
          result.rows.every((row) => row[column] == null || typeof row[column] === 'number')
        ),
        chartSpec: result ? fromReportChart(result.chartData, report.name) : null,
        exportHref: `/reports/${report.type}?${exportQuery}`,
        can: { export: can(req.user, P.EXPORT_RUN) },
      });
    })
  );

  return router;
}

module.exports = { createReportsController, presetsFor };
