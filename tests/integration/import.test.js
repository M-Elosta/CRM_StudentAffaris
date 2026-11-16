'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const { buildApp, loginAs, post, ORIGIN, binaryParser, XLSX_CONTENT_TYPE } = require('../helpers/app');

const ENTITIES = [
  'Company',
  'Contact',
  'Outreach',
  'Recruitment',
  'Career Event',
  'Student-Led Event',
  'Academic Engagement',
  'Hiring Feedback',
  'Potential Collaboration',
];

const COMPANY_MAPPING = {
  'Company Name': 'CompanyName',
  Industry: 'Industry',
  Sector: 'Sector',
  Country: 'Country',
  Website: 'Website',
  Notes: '__ignore__',
};

const CONTACT_MAPPING = {
  Employer: 'CompanyID',
  'First Name': 'FirstName',
  'Last Name': 'LastName',
  Email: 'EmailAddress',
  Status: 'Status',
};

async function readWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets[0];
}

/** Validate rows, then confirm every row with the given action (or per-status actions). */
async function validateAndConfirm(agent, entity, rows, mapping, actionFor = () => 'import') {
  const validation = await post(agent, '/api/import/validate', { entity, rows, mapping });
  assert.equal(validation.status, 200, JSON.stringify(validation.body));
  const confirm = await post(agent, '/api/import/confirm', {
    entity,
    rows: validation.body.map((result) => ({ row: result.row, action: actionFor(result) })),
  });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  return { validation: validation.body, confirm: confirm.body };
}

describe('Import', () => {
  let ctx;
  let admin;

  before(async () => {
    ctx = await buildApp();
    admin = await loginAs(ctx, 'admin');
  });

  after(() => ctx.close());

  const count = (table) => ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

  describe('templates', () => {
    for (const entity of ENTITIES) {
      it(`downloads an xlsx template for ${entity}`, async () => {
        const res = await admin
          .get(`/api/import/template/${encodeURIComponent(entity)}`)
          .buffer(true)
          .parse(binaryParser);
        assert.equal(res.status, 200);
        assert.equal(res.headers['content-type'], XLSX_CONTENT_TYPE);
        assert.match(res.headers['content-disposition'], /^attachment; filename="template-[A-Za-z-]+\.xlsx"$/);
        const sheet = await readWorkbook(res.body);
        const headers = sheet.getRow(1).values.filter(Boolean);
        assert.ok(headers.length > 0);
        if (entity === 'Company') {
          assert.deepEqual(headers.slice(0, 4), ['CompanyName', 'Industry', 'Sector', 'Country']);
        }
        if (entity !== 'Company' && entity !== 'Contact') assert.ok(headers.includes('CompanyID'));
      });
    }

    it('returns 404 for an unknown entity', async () => {
      assert.equal((await admin.get('/api/import/template/Spaceship')).status, 404);
    });

    it('returns 404 for an entity name inherited from Object.prototype', async () => {
      assert.equal((await admin.get('/api/import/template/constructor')).status, 404);
    });

    it('lets only roles that may import download a template', async () => {
      const expected = { admin: 200, staff: 200, readonly: 403, student_worker: 403 };
      for (const [role, status] of Object.entries(expected)) {
        const agent = await loginAs(ctx, role);
        assert.equal((await agent.get('/api/import/template/Company')).status, status, role);
      }
    });
  });

  describe('parse', () => {
    it('reads the headers and rows of an uploaded workbook', async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.addRow(['Company Name', 'Industry', 'Sector', 'Country']);
      sheet.addRow(['Parsed Co', 'Retail', 'Private', 'Qatar']);
      sheet.addRow(['شركة مقروءة', 'Retail', 'NGO', 'قطر']);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const res = await admin
        .post('/api/import/parse')
        .set('Origin', ORIGIN)
        .attach('file', buffer, { filename: 'companies.xlsx', contentType: XLSX_CONTENT_TYPE });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.headers, ['Company Name', 'Industry', 'Sector', 'Country']);
      assert.equal(res.body.totalRows, 2);
      assert.equal(res.body.allRows[1]['Company Name'], 'شركة مقروءة');
    });

    it('rejects a file that is not an xlsx workbook with 400', async () => {
      const res = await admin
        .post('/api/import/parse')
        .set('Origin', ORIGIN)
        .attach('file', Buffer.from('a,b\n1,2\n'), { filename: 'data.csv', contentType: 'text/csv' });
      assert.equal(res.status, 400);
    });

    it('rejects a request without a file with 400', async () => {
      const res = await post(admin, '/api/import/parse', {});
      assert.equal(res.status, 400);
    });
  });

  describe('Company import', () => {
    it('validates and imports new companies, which then exist', async () => {
      const rows = [
        {
          'Company Name': 'Imported Energy',
          Industry: 'Energy',
          Sector: 'semi-government',
          Country: 'Qatar',
          Website: 'https://energy.example',
          Notes: 'ignored',
        },
        { 'Company Name': 'Imported Startup', Industry: 'Software', Sector: 'STARTUP', Country: 'UAE' },
      ];
      const { validation, confirm } = await validateAndConfirm(admin, 'Company', rows, COMPANY_MAPPING);

      assert.deepEqual(
        validation.map((result) => result.status),
        ['valid', 'valid']
      );
      assert.equal(validation[0].row.Sector, 'Semi-government', 'enum values are normalised');
      assert.equal(validation[1].row.Sector, 'Startup');
      assert.equal(validation[0].row.Notes, undefined, 'ignored columns are dropped');
      assert.deepEqual(validation[0].errors, []);

      assert.equal(confirm.imported, 2);
      assert.equal(confirm.failed, 0);
      assert.equal(confirm.errorFileBase64, null);

      const listed = (await admin.get('/api/companies').query({ search: 'Imported' })).body;
      assert.deepEqual(listed.map((row) => row.CompanyName).sort(), ['Imported Energy', 'Imported Startup']);
      const energy = listed.find((row) => row.CompanyName === 'Imported Energy');
      assert.equal(energy.Sector, 'Semi-government');
      assert.equal(energy.Website, 'https://energy.example/');
      assert.ok(energy.UpdatedAt);
    });

    it('flags a company that already exists as a duplicate, case-insensitively', async () => {
      await post(admin, '/api/companies', {
        CompanyName: 'Existing Bank',
        Industry: 'Banking',
        Sector: 'Private',
        Country: 'Qatar',
      });
      const res = await post(admin, '/api/import/validate', {
        entity: 'Company',
        mapping: COMPANY_MAPPING,
        rows: [{ 'Company Name': '  existing BANK ', Industry: 'Banking', Sector: 'Private', Country: 'Qatar' }],
      });
      assert.equal(res.status, 200);
      assert.equal(res.body[0].status, 'duplicate');
      assert.equal(res.body[0].duplicate, true);
      assert.match(res.body[0].dupReason, /already exists/);
      assert.ok(res.body[0].row.__existingId > 0);
    });

    it('flags the second of two identical rows in the same file as a duplicate', async () => {
      const row = { 'Company Name': 'Twin Co', Industry: 'Retail', Sector: 'Private', Country: 'Qatar' };
      const res = await post(admin, '/api/import/validate', {
        entity: 'Company',
        mapping: COMPANY_MAPPING,
        rows: [row, { ...row, 'Company Name': 'twin co' }],
      });
      assert.deepEqual(
        res.body.map((result) => result.status),
        ['valid', 'duplicate']
      );
      assert.match(res.body[1].dupReason, /row 1/);
    });

    it('skips duplicates marked skip and overwrites duplicates marked overwrite', async () => {
      await post(admin, '/api/companies', {
        CompanyName: 'Skip Me',
        Industry: 'Old',
        Sector: 'Private',
        Country: 'Qatar',
      });
      await post(admin, '/api/companies', {
        CompanyName: 'Overwrite Me',
        Industry: 'Old',
        Sector: 'Private',
        Country: 'Qatar',
      });
      const before = count('Company');
      const { confirm } = await validateAndConfirm(
        admin,
        'Company',
        [
          { 'Company Name': 'Skip Me', Industry: 'New', Sector: 'NGO', Country: 'Qatar' },
          { 'Company Name': 'Overwrite Me', Industry: 'New', Sector: 'NGO', Country: 'Qatar' },
        ],
        COMPANY_MAPPING,
        (result) => (result.row.CompanyName === 'Skip Me' ? 'skip' : 'overwrite')
      );
      assert.equal(confirm.skipped, 1);
      assert.equal(confirm.updated, 1);
      assert.equal(confirm.imported, 0);
      assert.equal(count('Company'), before);
      const rows = ctx.db
        .prepare("SELECT CompanyName, Industry FROM Company WHERE CompanyName IN ('Skip Me','Overwrite Me')")
        .all();
      assert.deepEqual(rows.find((row) => row.CompanyName === 'Skip Me').Industry, 'Old');
      assert.deepEqual(rows.find((row) => row.CompanyName === 'Overwrite Me').Industry, 'New');
    });

    it('reports every problem with an invalid row', async () => {
      const res = await post(admin, '/api/import/validate', {
        entity: 'Company',
        mapping: COMPANY_MAPPING,
        rows: [{ 'Company Name': '', Industry: 'X', Sector: 'Conglomerate', Country: 'Qatar', Website: 'ftp://x' }],
      });
      assert.equal(res.status, 200);
      const [result] = res.body;
      assert.equal(result.status, 'error');
      assert.ok(result.errors.some((error) => /CompanyName is required/.test(error)));
      assert.ok(result.errors.some((error) => /Sector must be one of/.test(error)));
      assert.ok(result.errors.some((error) => /Website/.test(error)));
    });
  });

  describe('Contact import', () => {
    let companyId;

    before(async () => {
      companyId = (
        await post(admin, '/api/companies', {
          CompanyName: 'Contact Import Employer',
          Industry: 'Health',
          Sector: 'Government',
          Country: 'Qatar',
        })
      ).body.CompanyID;
    });

    it('resolves the company by name and imports the contacts', async () => {
      const rows = [
        {
          Employer: 'contact import employer',
          'First Name': 'Fatima',
          'Last Name': 'Al-Kuwari',
          Email: 'fatima@example.qa',
          Status: 'mailable',
        },
        { Employer: String(companyId), 'First Name': 'Yousef', 'Last Name': 'Nasser', Email: 'yousef@example.qa' },
      ];
      const { validation, confirm } = await validateAndConfirm(admin, 'Contact', rows, CONTACT_MAPPING);
      assert.deepEqual(
        validation.map((result) => result.status),
        ['valid', 'valid']
      );
      assert.equal(validation[0].row.CompanyID, companyId);
      assert.equal(validation[0].row.Status, 'Mailable');
      assert.equal(confirm.imported, 2);

      const contacts = (await admin.get('/api/contacts').query({ companyId })).body;
      assert.deepEqual(contacts.map((row) => row.EmailAddress).sort(), ['fatima@example.qa', 'yousef@example.qa']);
      assert.ok(contacts.every((row) => row.CompanyName === 'Contact Import Employer'));
    });

    it('splits a full name given in the first-name column', async () => {
      const res = await post(admin, '/api/import/validate', {
        entity: 'Contact',
        mapping: { Employer: 'CompanyID', Name: 'FirstName', Email: 'EmailAddress' },
        rows: [{ Employer: String(companyId), Name: 'Mariam Bint Ali', Email: 'mariam@example.qa' }],
      });
      assert.equal(res.body[0].status, 'valid');
      assert.equal(res.body[0].row.FirstName, 'Mariam Bint');
      assert.equal(res.body[0].row.LastName, 'Ali');
    });

    it('flags a contact whose email already exists at the company as a duplicate', async () => {
      await post(admin, '/api/contacts', {
        CompanyID: companyId,
        FirstName: 'Existing',
        LastName: 'Person',
        EmailAddress: 'existing@example.qa',
      });
      const res = await post(admin, '/api/import/validate', {
        entity: 'Contact',
        mapping: CONTACT_MAPPING,
        rows: [{ Employer: String(companyId), 'First Name': 'E', 'Last Name': 'P', Email: 'EXISTING@example.qa' }],
      });
      assert.equal(res.body[0].status, 'duplicate');
      assert.match(res.body[0].dupReason, /existing@example\.qa|EXISTING@example\.qa/i);
    });

    it('reports an unknown company and missing fields as errors', async () => {
      const res = await post(admin, '/api/import/validate', {
        entity: 'Contact',
        mapping: CONTACT_MAPPING,
        rows: [{ Employer: 'No Such Employer', 'First Name': 'A', 'Last Name': '', Email: '', Status: 'Unsubscribed' }],
      });
      const [result] = res.body;
      assert.equal(result.status, 'error');
      assert.ok(result.errors.some((error) => /No Such Employer/.test(error)));
      assert.ok(result.errors.some((error) => /EmailAddress is required/.test(error)));
      assert.ok(result.errors.some((error) => /Status must be one of/.test(error)));
    });

    it('rejects an invalid email address during validation', async () => {
      const res = await post(admin, '/api/import/validate', {
        entity: 'Contact',
        mapping: CONTACT_MAPPING,
        rows: [{ Employer: String(companyId), 'First Name': 'A', 'Last Name': 'B', Email: 'not-an-email' }],
      });
      assert.equal(res.body[0].status, 'error');
    });

    it('confirm refuses rows that would fail validation', async () => {
      const before = count('Contact');
      const res = await post(admin, '/api/import/confirm', {
        entity: 'Contact',
        rows: [
          {
            row: { CompanyID: companyId, FirstName: 'Bad', LastName: 'Email', EmailAddress: 'not-an-email' },
            action: 'import',
          },
        ],
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.imported, 0);
      assert.equal(count('Contact'), before);
    });
  });

  describe('request validation', () => {
    it('rejects validate without entity, rows or mapping with 400', async () => {
      assert.equal((await post(admin, '/api/import/validate', { rows: [{}], mapping: {} })).status, 400);
      assert.equal((await post(admin, '/api/import/validate', { entity: 'Company', mapping: {} })).status, 400);
      assert.equal((await post(admin, '/api/import/validate', { entity: 'Company', rows: [{}] })).status, 400);
    });

    it('rejects an unknown entity with 400', async () => {
      const res = await post(admin, '/api/import/validate', { entity: 'Spaceship', rows: [{}], mapping: {} });
      assert.equal(res.status, 400);
      assert.equal((await post(admin, '/api/import/confirm', { entity: 'Spaceship', rows: [{}] })).status, 400);
    });

    it('rejects an entity name inherited from Object.prototype with 400', async () => {
      const res = await post(admin, '/api/import/validate', { entity: 'constructor', rows: [{}], mapping: {} });
      assert.equal(res.status, 400);
    });

    it('rejects an empty rows array or a non-object mapping with 400', async () => {
      assert.equal(
        (await post(admin, '/api/import/validate', { entity: 'Company', rows: [], mapping: {} })).status,
        400
      );
      assert.equal(
        (await post(admin, '/api/import/validate', { entity: 'Company', rows: [{}], mapping: ['x'] })).status,
        400
      );
    });

    it('rejects more than 5000 rows with 400', async () => {
      const rows = Array.from({ length: 5001 }, () => ({}));
      const res = await post(admin, '/api/import/validate', { entity: 'Company', rows, mapping: {} });
      assert.equal(res.status, 400);
    });

    it('counts a malformed confirm row as failed without importing anything', async () => {
      const before = count('Company');
      const res = await post(admin, '/api/import/confirm', { entity: 'Company', rows: ['not an object'] });
      assert.equal(res.status, 200);
      assert.equal(res.body.failed, 1);
      assert.equal(res.body.imported, 0);
      assert.equal(count('Company'), before);
    });

    it('reports rows the database rejects as failed, with an error workbook', async () => {
      const res = await post(admin, '/api/import/confirm', {
        entity: 'Company',
        rows: [{ row: { CompanyName: 'No Sector Co', Industry: 'X', Country: 'Qatar' }, action: 'import' }],
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.failed, 1);
      assert.equal(res.body.imported, 0);
      assert.equal(typeof res.body.errorFileBase64, 'string');
      const sheet = await readWorkbook(Buffer.from(res.body.errorFileBase64, 'base64'));
      assert.ok(sheet.getRow(1).values.includes('__error'));
    });
  });
});
