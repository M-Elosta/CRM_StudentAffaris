'use strict';

/**
 * Quick reports: the registry of report definitions and the service that
 * runs them. Each definition is (context) => { rows, chartData, meta? } where
 * context = { queries, from, to, period, today, semesters(), academicYears() }.
 */

const { NotFoundError } = require('../../lib/errors');
const { todayInTimeZone } = require('../../lib/dates');
const {
  formatDateOutput,
  resolveQuickReportPeriod,
  buildReportPeriods,
  reportSemesterSeries,
  reportAcademicYearSeries,
} = require('./periods');
const { reportWorkbook } = require('./export');
const { REPORT_CATALOG, REPORT_BY_TYPE } = require('./catalog');
const authorize = require('../../security/authorize');
const { PERMISSIONS: P } = require('../../security/permissions');

const ISO_DATEISH_RE = /^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/;

/** Every quick report, by type. A Map, so only real report names match a request. */
const QUICK_REPORTS = new Map(
  Object.entries({
    ...require('./contact-reports'),
    ...require('./company-reports'),
    ...require('./engagement-reports'),
    ...require('./recruitment-reports'),
    ...require('./academic-reports'),
    ...require('./trend-reports'),
  })
);

/** Show every date-like string value as DD/MM/YY. */
function formatRowsForOutput(rows) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === 'string' && ISO_DATEISH_RE.test(value) ? formatDateOutput(value) : value,
      ])
    )
  );
}

/**
 * Run one quick report.
 * @param {string} type  a key of QUICK_REPORTS
 * @param {object} query  the validated quick report query
 * @param {{ queries: object, today: string, formatDates?: boolean }} deps  the reports repository and
 *   today's date; formatDates: false keeps dates as stored (YYYY-MM-DD) for the pages to format
 * @returns {{ rows: object[], count: number, chartData: object, meta: object }}
 */
function runQuickReport(type, query, { queries, today, formatDates = true }) {
  const report = QUICK_REPORTS.get(type);
  if (!report) throw new NotFoundError(`Unknown report type: ${type}`);
  const period = resolveQuickReportPeriod(query);

  let bounds;
  const dateBounds = () => (bounds ??= queries.dateBounds());
  const result = report({
    queries,
    from: period.from,
    to: period.to,
    period,
    today,
    semesters: () => reportSemesterSeries(dateBounds(), period.from, period.to, today),
    academicYears: () => reportAcademicYearSeries(dateBounds(), period.from, period.to, today),
  });

  const rows = formatDates ? formatRowsForOutput(result.rows) : result.rows;
  const meta = {
    periodMode: period.mode,
    periodLabel: result.meta?.periodLabel || period.label,
    from: period.from,
    to: period.to,
    ...(result.meta || {}),
  };
  return { rows, count: rows.length, chartData: result.chartData, meta };
}

/**
 * @param {object} deps
 * @param {ReturnType<import('../../db/repositories/reports-repository').createReportsRepository>} deps.reportsRepository
 * @param {string} deps.timeZone  the office time zone, for "today"
 */
function createReportsService({ reportsRepository, timeZone }) {
  const today = () => todayInTimeZone(timeZone);

  return {
    /** Throw NotFoundError unless type names a quick report. */
    ensureQuickReport(type) {
      if (!QUICK_REPORTS.has(type)) throw new NotFoundError(`Unknown report type: ${type}`);
    },

    /** The semesters and academic years the period picker offers. */
    periods() {
      return buildReportPeriods(reportsRepository.dateBounds(), today());
    },

    /** Run a quick report for a validated query. */
    runQuickReport(type, query) {
      return runQuickReport(type, query, { queries: reportsRepository, today: today() });
    },

    /** Run a quick report and return it as an xlsx workbook: { fileName, buffer }. */
    async exportQuickReport(type, query) {
      const { rows } = runQuickReport(type, query, { queries: reportsRepository, today: today() });
      return reportWorkbook(rows, `report-${type}`);
    },

    /**
     * The reports this user may run, grouped: [{ group, reports: [{ type, name, description, period }] }].
     * @param {{ user: object }} ctx
     */
    catalog(ctx) {
      authorize.requirePermission(ctx, P.REPORTS_VIEW);
      const seesSensitive = authorize.has(ctx, P.SENSITIVE_READ);
      return REPORT_CATALOG.map((group) => ({
        group: group.group,
        reports: group.reports
          .filter((report) => seesSensitive || !report.sensitive)
          .map((report) => REPORT_BY_TYPE.get(report.type)),
      })).filter((group) => group.reports.length);
    },

    /**
     * One report of the catalog for this user: its description, or an error when
     * it does not exist (404) or the user may not run it (403).
     */
    reportFor(type, ctx) {
      authorize.requirePermission(ctx, P.REPORTS_VIEW);
      const report = REPORT_BY_TYPE.get(type);
      if (!report || !QUICK_REPORTS.has(type)) throw new NotFoundError(`Unknown report type: ${type}`);
      if (report.sensitive) authorize.requirePermission(ctx, P.SENSITIVE_READ);
      return report;
    },

    /** Run a report of the catalog for this user, with dates kept as YYYY-MM-DD for display. */
    runForUser(type, query, ctx) {
      this.reportFor(type, ctx);
      return runQuickReport(type, query, { queries: reportsRepository, today: today(), formatDates: false });
    },

    /** Export a report of the catalog for this user (needs export:run). */
    async exportForUser(type, query, ctx) {
      this.reportFor(type, ctx);
      authorize.requirePermission(ctx, P.EXPORT_RUN);
      return this.exportQuickReport(type, query);
    },
  };
}

module.exports = { QUICK_REPORTS, runQuickReport, createReportsService };
