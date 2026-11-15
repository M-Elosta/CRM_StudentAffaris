'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ExcelJS = require('exceljs');

const { buildApp, loginAs, binaryParser, XLSX_CONTENT_TYPE } = require('../helpers/app');
const { seedEverything } = require('../helpers/records');

/**
 * The quick report types, read from the keys of QUICK_REPORTS in the route
 * source (the object is not exported). Reading the source means a newly added
 * report is tested automatically.
 */
function quickReportTypes() {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'routes', 'reports.js'), 'utf8');
  const start = source.indexOf('const QUICK_REPORTS = {');
  const end = source.indexOf('\n};', start);
  assert.ok(start > -1 && end > start, 'QUICK_REPORTS object not found in src/routes/reports.js');
  const body = source.slice(start, end);
  return [...body.matchAll(/^ {2}'([a-z0-9-]+)':\s*\(/gm)].map((match) => match[1]);
}

const QUICK_REPORT_TYPES = quickReportTypes();

describe('Reports', () => {
  it('finds the quick report types in the route source', () => {
    assert.ok(QUICK_REPORT_TYPES.length >= 30, `found only ${QUICK_REPORT_TYPES.length} quick report types`);
    assert.ok(QUICK_REPORT_TYPES.includes('mailable-contacts'));
    assert.ok(QUICK_REPORT_TYPES.includes('semester-comparison'));
  });

  for (const state of ['empty', 'populated']) {
    describe(`quick reports on ${state === 'empty' ? 'an empty' : 'a populated'} database`, () => {
      let ctx;
      let viewer;

      before(async () => {
        ctx = await buildApp();
        viewer = await loginAs(ctx, 'viewer');
        if (state === 'populated') await seedEverything(await loginAs(ctx, 'admin'));
      });

      after(() => ctx.close());

      for (const type of QUICK_REPORT_TYPES) {
        it(`${type} returns rows, count, chartData and meta`, async () => {
          const res = await viewer.get(`/api/reports/quick/${type}`);
          assert.equal(res.status, 200, JSON.stringify(res.body));
          assert.ok(Array.isArray(res.body.rows));
          assert.equal(res.body.count, res.body.rows.length);
          assert.ok('chartData' in res.body);
          assert.equal(typeof res.body.meta, 'object');
          assert.ok(res.body.meta !== null);
        });
      }

      it('periods lists semesters and academic years with defaults', async () => {
        const res = await viewer.get('/api/reports/periods');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.body.semesters) && res.body.semesters.length > 0);
        assert.ok(Array.isArray(res.body.academicYears) && res.body.academicYears.length > 0);
        assert.equal(typeof res.body.defaults.semester, 'string');
        assert.equal(typeof res.body.defaults.academicYear, 'string');
        for (const semester of res.body.semesters) {
          assert.match(semester.key, /^\d{4}-(fall|spring|summer)$/);
        }
      });
    });
  }

  describe('quick report options', () => {
    let ctx;
    let viewer;

    before(async () => {
      ctx = await buildApp();
      viewer = await loginAs(ctx, 'viewer');
      await seedEverything(await loginAs(ctx, 'admin'));
    });

    after(() => ctx.close());

    it('returns 404 for an unknown report type', async () => {
      const res = await viewer.get('/api/reports/quick/not-a-report');
      assert.equal(res.status, 404);
    });

    it(
      'does not treat inherited object properties as report types',
      { todo: 'QUICK_REPORTS[type] is a plain-object lookup, so /quick/constructor runs Object() and fails with 500' },
      async () => {
        assert.equal((await viewer.get('/api/reports/quick/constructor')).status, 404);
        assert.equal((await viewer.get('/api/reports/quick/toString')).status, 404);
      }
    );

    it('lists the mailable contacts in the populated database', async () => {
      const res = await viewer.get('/api/reports/quick/mailable-contacts');
      assert.equal(res.body.count, 2);
      assert.ok(res.body.rows.every((row) => typeof row.Email === 'string'));
    });

    it('exports a quick report as an xlsx attachment', async () => {
      const res = await viewer
        .get('/api/reports/quick/all-companies')
        .query({ export: '1' })
        .buffer(true)
        .parse(binaryParser);
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], XLSX_CONTENT_TYPE);
      assert.match(res.headers['content-disposition'], /^attachment; filename="report-all-companies-\d+\.xlsx"$/);
      assert.equal(res.body.subarray(0, 2).toString(), 'PK');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body);
      const sheet = workbook.worksheets[0];
      assert.equal(sheet.rowCount, 1 + 2, 'header plus the two non-blacklisted companies');
    });

    it('exports an empty report as a valid xlsx', async () => {
      const res = await viewer
        .get('/api/reports/quick/blacklisted-companies')
        .query({ export: '1', from: '1990-01-01', to: '1990-01-02' })
        .buffer(true)
        .parse(binaryParser);
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], XLSX_CONTENT_TYPE);
    });

    it('accepts a semester filter and reports it in meta', async () => {
      const res = await viewer.get('/api/reports/quick/new-companies').query({ semester: '2024-fall' });
      assert.equal(res.status, 200);
      assert.equal(res.body.meta.periodMode, 'semester');
      assert.equal(res.body.meta.from, '2024-08-01');
      assert.equal(res.body.meta.to, '2024-12-31');
    });

    it('rejects a malformed semester with 400', async () => {
      assert.equal((await viewer.get('/api/reports/quick/new-companies').query({ semester: 'autumn' })).status, 400);
    });

    it('rejects from after to with 400', async () => {
      const res = await viewer.get('/api/reports/quick/new-companies').query({ from: '2025-01-02', to: '2025-01-01' });
      assert.equal(res.status, 400);
    });

    it('rejects mixing custom dates with a semester with 400', async () => {
      const res = await viewer
        .get('/api/reports/quick/new-companies')
        .query({ from: '2024-01-01', semester: '2024-fall' });
      assert.equal(res.status, 400);
    });

    it('rejects a malformed date with 400', async () => {
      assert.equal((await viewer.get('/api/reports/quick/new-companies').query({ from: 'last week' })).status, 400);
    });
  });
});
