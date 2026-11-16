'use strict';

const { AppError, NotFoundError, ValidationError } = require('../lib/errors');
const { isoDateFromUtcDate } = require('../lib/dates');
const {
  excelSerialDateToISO,
  readFirstWorksheet,
  workbookBase64FromJson,
  workbookBufferFromColumns,
} = require('../lib/excel');
const { recordTypeByImportEntity } = require('../domain/record-types');
const { PERMISSIONS } = require('../security/permissions');
const { requirePermission } = require('../security/authorize');
const enums = require('../domain/enums');
const { MAX_IMPORT_ROWS, isPlainObject } = require('../validation/import');

const { COLLABORATION_OPPORTUNITIES } = enums;

/**
 * Per import entity: the template columns (required first), the fields that
 * must be filled, the enumerated fields whose values are matched loosely and
 * corrected, and the date fields that accept spreadsheet date formats.
 */
const IMPORT_FIELDS = new Map([
  [
    'Company',
    {
      required: ['CompanyName', 'Industry', 'Sector', 'Country'],
      optional: [
        'DateAdded',
        'Address',
        'Website',
        'LinkedInURL',
        'HandshakeURL',
        'SignedMoU',
        'FavoriteEmployer',
        'Blacklisted',
        'Comment',
      ],
      enums: { Sector: enums.SECTORS },
      dateFields: ['DateAdded'],
    },
  ],
  [
    'Contact',
    {
      required: ['CompanyID', 'FirstName', 'LastName', 'EmailAddress'],
      optional: [
        'DateAdded',
        'JobTitle',
        'Address',
        'Country',
        'WorkPhone',
        'Mobile',
        'LinkedInURL',
        'HandshakeURL',
        'CMUQGraduate',
        'Major',
        'GraduationYear',
        'PrimaryContact',
        'Status',
        'ResumeBook',
        'EventInvitation',
        'ExcludeFromMailing',
      ],
      enums: { Status: enums.CONTACT_STATUSES, Major: enums.CONTACT_MAJORS },
      dateFields: ['DateAdded'],
    },
  ],
  [
    'Outreach',
    {
      required: ['CompanyID', 'ContactID', 'InteractionType', 'InteractionDate', 'DiscussionItems'],
      optional: ['ActionPlan', 'FollowUpDate', 'InteractionStatus'],
      enums: { InteractionType: enums.INTERACTION_TYPES, InteractionStatus: enums.INTERACTION_STATUSES },
      dateFields: ['InteractionDate', 'FollowUpDate'],
    },
  ],
  [
    'Recruitment',
    {
      required: ['CompanyID', 'ContactID', 'OpportunityTitle', 'Mode', 'Status', 'TargetGroup'],
      optional: [
        'DatePosted',
        'Duration',
        'HiringStartDate',
        'HiringEndDate',
        'Country',
        'PayAmount',
        'ArabicSpeaker',
        'HiredStudentAlumni',
        'Comment',
      ],
      enums: {
        Mode: enums.RECRUITMENT_MODES,
        Status: enums.PAY_STATUSES,
        TargetGroup: enums.TARGET_GROUPS,
        HiredStudentAlumni: enums.RECRUITMENT_HIRED_VALUES,
      },
      dateFields: ['DatePosted', 'HiringStartDate', 'HiringEndDate'],
    },
  ],
  [
    'Career Event',
    {
      required: ['CompanyID', 'ContactID', 'EventName', 'EventDate', 'RegisteredStatus'],
      optional: ['CMUQAlumniAtBooth', 'Comment'],
      enums: { RegisteredStatus: enums.REGISTERED_STATUSES },
      dateFields: ['EventDate'],
    },
  ],
  [
    'Student-Led Event',
    {
      required: [
        'CompanyID',
        'ContactID',
        'ProposalDate',
        'OrganizationName',
        'StudentName',
        'StudentEmail',
        'StudentPhoneNumber',
      ],
      optional: ['CollaborationOutcome', 'EventDate', 'EventTitle', 'Comment'],
      enums: { CollaborationOutcome: enums.COLLABORATION_OUTCOMES },
      dateFields: ['ProposalDate', 'EventDate'],
    },
  ],
  [
    'Academic Engagement',
    {
      required: [
        'CompanyID',
        'ContactID',
        'EngagementType',
        'GuestSpeakerName',
        'GuestTitle',
        'FacultyName',
        'CourseNumber',
        'CourseTitle',
        'TopicTheme',
        'SessionDate',
        'SessionTime',
      ],
      optional: ['Email', 'PhoneNumber', 'Comment'],
      enums: { EngagementType: enums.ENGAGEMENT_TYPES },
      dateFields: ['SessionDate'],
    },
  ],
  [
    'Hiring Feedback',
    {
      required: ['CompanyID', 'ContactID', 'FeedbackProvider', 'HiredStudentAlumni', 'DateReported'],
      optional: ['HiredStudentName', 'Comment'],
      enums: { FeedbackProvider: enums.FEEDBACK_PROVIDERS, HiredStudentAlumni: enums.FEEDBACK_HIRED_VALUES },
      dateFields: ['DateReported'],
    },
  ],
  [
    'Potential Collaboration',
    {
      required: ['CompanyID'],
      optional: ['Comment', ...COLLABORATION_OPPORTUNITIES],
      enums: {},
      dateFields: [],
    },
  ],
]);

const BOOLEAN_FIELDS = new Set([
  'CMUQGraduate',
  'PrimaryContact',
  'ResumeBook',
  'EventInvitation',
  'ExcludeFromMailing',
  'SignedMoU',
  'FavoriteEmployer',
  'Blacklisted',
  'CMUQAlumniAtBooth',
  'ArabicSpeaker',
  ...COLLABORATION_OPPORTUNITIES,
]);

const MONTHS = new Map(
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((name, index) => [
    name,
    String(index + 1).padStart(2, '0'),
  ])
);

const lower = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();
const isFilled = (value) => value !== undefined && value !== null && value !== '';
const isBindable = (value) => typeof value === 'string' || typeof value === 'number';

/** Import entity → in-file duplicate key and the reason shown for a duplicate already in the database. */
const DUPLICATE_RULES = new Map([
  [
    'Company',
    {
      fields: ['CompanyName'],
      key: (row) => `c|${lower(row.CompanyName)}`,
      reason: (row) => `Company "${row.CompanyName}" already exists`,
    },
  ],
  [
    'Contact',
    {
      fields: ['EmailAddress', 'CompanyID'],
      key: (row) => `ct|${row.CompanyID}|${lower(row.EmailAddress)}`,
      reason: (row) => `Contact with email "${row.EmailAddress}" already exists at this company`,
    },
  ],
  [
    'Outreach',
    {
      fields: ['CompanyID', 'ContactID', 'InteractionDate'],
      key: (row) => `o|${row.CompanyID}|${row.ContactID}|${row.InteractionDate}|${lower(row.InteractionType)}`,
      reason: () => 'Same contact, date and interaction type already recorded',
    },
  ],
  [
    'Recruitment',
    {
      fields: ['CompanyID', 'OpportunityTitle'],
      key: (row) => `r|${row.CompanyID}|${lower(row.OpportunityTitle)}|${row.DatePosted || ''}`,
      reason: (row) => `Posting "${row.OpportunityTitle}" already exists for this company`,
    },
  ],
  [
    'Career Event',
    {
      fields: ['CompanyID', 'EventName', 'EventDate'],
      key: (row) => `ce|${row.CompanyID}|${lower(row.EventName)}|${row.EventDate}`,
      reason: (row) => `This company is already registered for "${row.EventName}" on ${row.EventDate}`,
    },
  ],
  [
    'Student-Led Event',
    {
      fields: ['CompanyID', 'ProposalDate', 'StudentEmail'],
      key: (row) => `se|${row.CompanyID}|${row.ProposalDate}|${lower(row.StudentEmail)}`,
      reason: (row) => `Same student proposal for this company on ${row.ProposalDate} already exists`,
    },
  ],
  [
    'Academic Engagement',
    {
      fields: ['CompanyID', 'SessionDate', 'GuestSpeakerName'],
      key: (row) => `ae|${row.CompanyID}|${row.SessionDate}|${lower(row.GuestSpeakerName)}`,
      reason: (row) => `${row.GuestSpeakerName} already has a session on ${row.SessionDate}`,
    },
  ],
  [
    'Hiring Feedback',
    {
      fields: ['CompanyID', 'ContactID', 'DateReported'],
      key: (row) => `hf|${row.CompanyID}|${row.ContactID}|${row.DateReported}`,
      reason: (row) => `Feedback from this contact on ${row.DateReported} already exists`,
    },
  ],
  [
    'Potential Collaboration',
    {
      fields: ['CompanyID'],
      key: (row) => `pc|${row.CompanyID}`,
      reason: () => 'A collaboration record already exists for this company',
    },
  ],
]);

/** Turn the date formats spreadsheets produce into YYYY-MM-DD, or null when unrecognised. */
function parseSpreadsheetDate(value) {
  if (!value) return null;
  if (typeof value === 'number') return excelSerialDateToISO(value);
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  const named = text.match(/^(\d{1,2})-([a-zA-Z]{3})-(\d{4})$/);
  if (named) return `${named[3]}-${MONTHS.get(named[2].toLowerCase()) || '01'}-${named[1].padStart(2, '0')}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : isoDateFromUtcDate(parsed);
}

/** The allowed value matching the input exactly, then ignoring case, then ignoring spaces and hyphens. */
function findCanonical(value, allowed) {
  const squash = (text) => text.toLowerCase().replace(/[\s-]/g, '');
  const text = String(value);
  return (
    allowed.find((option) => option === text) ||
    allowed.find((option) => option.toLowerCase() === text.toLowerCase()) ||
    allowed.find((option) => squash(option) === squash(text)) ||
    null
  );
}

/**
 * The API request body an import row stands for. Collaboration opportunities
 * arrive as one yes/no column each and become the Opportunities array. Only
 * fields the row actually has are included, so an overwrite keeps the rest.
 */
function toRecordBody(entity, row) {
  const body = {};
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith('__') && !COLLABORATION_OPPORTUNITIES.includes(key)) body[key] = value;
  }
  if (entity === 'Potential Collaboration' && COLLABORATION_OPPORTUNITIES.some((name) => Object.hasOwn(row, name))) {
    body.Opportunities = COLLABORATION_OPPORTUNITIES.filter((name) => row[name] && row[name] !== 0);
  }
  return body;
}

/**
 * Spreadsheet import: templates, parsing, row validation (with the same zod
 * schemas as the API) and the confirmed save, which runs in one transaction.
 * Every method needs IMPORT_RUN; saving also needs the record permission of
 * the imported type. Each takes the request context as its last argument.
 *
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {Map<string, { service: object, schema: object }>} deps.recordServices  by API path
 * @param {ReturnType<import('../db/repositories/import-repository').createImportRepository>} deps.importRepository
 * @param {{ error: Function }} deps.logger
 */
function createImportService({ db, recordServices, importRepository, logger }) {
  function entityConfig(entity) {
    const fields = IMPORT_FIELDS.get(entity);
    const definition = recordTypeByImportEntity(entity);
    if (!fields || !definition) throw new ValidationError('Unknown entity');
    return { fields, ...recordServices.get(definition.path) };
  }

  function resolveCompany(row, errors) {
    if (!isFilled(row.CompanyID) || !Number.isNaN(Number(row.CompanyID))) return;
    const companyId = importRepository.findCompanyIdByName(String(row.CompanyID));
    if (companyId) {
      row.CompanyID = companyId;
    } else {
      errors.push(`Company "${row.CompanyID}" not found in database`);
      row.CompanyID = null;
    }
  }

  function resolveContact(row, errors) {
    if (!isFilled(row.ContactID) || !Number.isNaN(Number(row.ContactID))) return;
    const text = String(row.ContactID).trim();
    let contactId = importRepository.findContactIdByEmail(text);
    const parts = text.split(/\s+/);
    if (!contactId && parts.length >= 2) {
      contactId = importRepository.findContactIdByName(parts.slice(0, -1).join(' '), parts[parts.length - 1]);
    }
    const comma = text.indexOf(',');
    if (!contactId && comma > -1) {
      contactId = importRepository.findContactIdByName(text.slice(comma + 1), text.slice(0, comma));
    }
    if (contactId) {
      row.ContactID = contactId;
    } else {
      errors.push(`Contact "${text}" not found in database`);
      row.ContactID = null;
    }
  }

  /** Apply the column mapping and the spreadsheet conveniences (names, yes/no, dates). */
  function mapRow(raw, mapping, fields, errors) {
    const row = {};
    for (const [fileColumn, field] of Object.entries(mapping)) {
      if (typeof field !== 'string' || !field || field === '__ignore__') continue;
      let value = isPlainObject(raw) && Object.hasOwn(raw, fileColumn) ? raw[fileColumn] : undefined;
      if (value !== null && typeof value === 'object') {
        errors.push(`${field} must be a single value`);
        value = undefined;
      }
      row[field] = typeof value === 'string' ? value.trim() : value;
    }

    // A virtual "full name" column is split into first and last name.
    if (isFilled(row.__full_name__)) {
      const parts = String(row.__full_name__).trim().split(/\s+/);
      if (parts.length >= 2) {
        row.LastName = parts.pop();
        row.FirstName = parts.join(' ');
      } else {
        row.FirstName = parts[0] || '';
      }
    }
    delete row.__full_name__;

    // A full name in the first-name column with no last name is split too.
    if (row.FirstName && String(row.FirstName).includes(' ') && !row.LastName) {
      const parts = String(row.FirstName).trim().split(/\s+/);
      row.LastName = parts.pop();
      row.FirstName = parts.join(' ');
    }

    for (const field of BOOLEAN_FIELDS) {
      if (!isFilled(row[field])) continue;
      const text = lower(row[field]);
      if (text === 'true' || text === 'yes' || text === '1') row[field] = 1;
      else if (text === 'false' || text === 'no' || text === '0') row[field] = 0;
    }

    for (const field of fields.dateFields) {
      if (isFilled(row[field])) row[field] = parseSpreadsheetDate(row[field]) || row[field];
    }
    return row;
  }

  /** Check one mapped row; fills `errors` and corrects values in place. */
  function checkRow(entity, row, { fields, service, schema }, errors) {
    resolveCompany(row, errors);
    resolveContact(row, errors);

    const reported = new Set();
    for (const field of fields.required) {
      if (!row[field] && row[field] !== 0) {
        errors.push(`${field} is required`);
        reported.add(field);
      }
    }
    for (const [field, allowed] of Object.entries(fields.enums)) {
      if (!isFilled(row[field])) continue;
      const canonical = findCanonical(row[field], allowed);
      if (canonical) {
        row[field] = canonical;
      } else {
        errors.push(`${field} must be one of: ${allowed.join(', ')}`);
        reported.add(field);
      }
    }

    // The same schema the API uses decides everything else (formats, lengths, real dates).
    const body = toRecordBody(entity, row);
    const parsed = schema.bodySchema.safeParse(body);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? '');
        if (reported.has(field)) continue;
        reported.add(field);
        errors.push(issue.message);
      }
      return;
    }
    for (const key of Object.keys(body)) {
      if (Object.hasOwn(row, key)) row[key] = parsed.data[key];
    }
    if (errors.length) return;
    try {
      service.checkReferences(parsed.data);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      errors.push(err.message);
    }
  }

  function findDuplicate(entity, row) {
    const rule = DUPLICATE_RULES.get(entity);
    if (!rule.fields.every((field) => isFilled(row[field]) && isBindable(row[field]))) return null;
    const id = importRepository.findDuplicateId(entity, row);
    return id ? { id, reason: rule.reason(row) } : null;
  }

  function inFileKey(entity, row) {
    const rule = DUPLICATE_RULES.get(entity);
    return rule.fields.every((field) => isFilled(row[field])) ? rule.key(row) : null;
  }

  /** Save one confirmed row. Returns 'imported' or 'updated'; throws an AppError for a row that cannot be saved. */
  function saveRow(entity, row, action, service, ctx) {
    const body = toRecordBody(entity, row);
    if (action === 'overwrite' && isFilled(row.__existingId)) {
      const existingId = Number(row.__existingId);
      let existing;
      try {
        existing = Number.isInteger(existingId) && existingId > 0 ? service.get(existingId, ctx) : undefined;
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
      }
      if (!existing) throw new ValidationError('The record to overwrite does not exist');
      service.overwrite(existingId, { ...existing, ...body }, ctx);
      return 'updated';
    }
    service.create(body, ctx);
    return 'imported';
  }

  return {
    /** The template workbook for an entity: { fileName, buffer }. NotFoundError for an unknown entity. */
    async template(entity, ctx) {
      requirePermission(ctx, PERMISSIONS.IMPORT_RUN);
      const fields = IMPORT_FIELDS.get(entity);
      if (!fields) throw new NotFoundError('Unknown entity');
      const buffer = await workbookBufferFromColumns(entity, [...fields.required, ...fields.optional]);
      return { fileName: `template-${entity.replace(/ /g, '-')}.xlsx`, buffer };
    },

    /**
     * The template columns of an entity: { required, optional }. NotFoundError for an unknown entity.
     * The import screen matches a file's headers to these.
     */
    columns(entity, ctx) {
      requirePermission(ctx, PERMISSIONS.IMPORT_RUN);
      const fields = IMPORT_FIELDS.get(entity);
      if (!fields) throw new NotFoundError('Unknown entity');
      return { required: [...fields.required], optional: [...fields.optional] };
    },

    /** Read an uploaded workbook: headers, a ten-row preview, the row count and every row. */
    async parse(buffer, ctx) {
      requirePermission(ctx, PERMISSIONS.IMPORT_RUN);
      try {
        const { headers, rows } = await readFirstWorksheet(buffer, { maxRows: MAX_IMPORT_ROWS });
        return { headers, preview: rows.slice(0, 10), totalRows: rows.length, allRows: rows };
      } catch (err) {
        throw new ValidationError(`Could not parse file: ${err.message}`);
      }
    },

    /**
     * Map and check every row without saving anything.
     * @param {{ entity: string, rows: unknown[], mapping: Record<string, unknown> }} request  already validated
     */
    validate({ entity, rows, mapping }, ctx) {
      requirePermission(ctx, PERMISSIONS.IMPORT_RUN);
      const config = entityConfig(entity);
      const seenKeys = new Map();
      return rows.map((raw, index) => {
        const errors = [];
        const row = mapRow(raw, mapping, config.fields, errors);
        checkRow(entity, row, config, errors);

        let duplicate = false;
        let dupReason = null;
        const existing = findDuplicate(entity, row);
        if (existing) {
          duplicate = true;
          row.__existingId = existing.id;
          dupReason = existing.reason;
        }
        const key = inFileKey(entity, row);
        if (key && seenKeys.has(key) && !duplicate) {
          duplicate = true;
          dupReason = `Duplicate of row ${seenKeys.get(key)} in this file`;
        } else if (key && !seenKeys.has(key)) {
          seenKeys.set(key, index + 1);
        }

        const status = errors.length > 0 ? 'error' : duplicate ? 'duplicate' : 'valid';
        return { rowIndex: index, row, errors, duplicate, dupReason, status };
      });
    },

    /**
     * Save the confirmed rows in one transaction. Each row is validated again
     * with the API schemas; invalid rows are reported and skipped, valid rows
     * are saved. "overwrite" updates the existing record in place.
     * @param {{ entity: string, rows: unknown[] }} request  already validated
     */
    async confirm({ entity, rows }, ctx) {
      requirePermission(ctx, PERMISSIONS.IMPORT_RUN);
      const { service } = entityConfig(entity);
      const counts = { imported: 0, updated: 0, skipped: 0, failed: 0 };
      const failedRows = [];

      db.transaction(() => {
        for (const item of rows) {
          const row = isPlainObject(item?.row) ? item.row : null;
          const action = typeof item?.action === 'string' ? item.action : 'skip';
          if (!row) {
            counts.failed++;
            failedRows.push({ row: { __row: 'Invalid payload' }, error: 'Invalid import row payload' });
            continue;
          }
          if (action === 'skip') {
            counts.skipped++;
            continue;
          }
          try {
            counts[saveRow(entity, row, action, service, ctx)]++;
          } catch (err) {
            if (!(err instanceof AppError)) logger.error('[import confirm] row could not be saved', err?.stack || err);
            counts.failed++;
            failedRows.push({
              row,
              error: err instanceof AppError ? err.message : 'This row could not be saved.',
            });
          }
        }
      })();

      const errorFileBase64 = failedRows.length
        ? await workbookBase64FromJson(
            'Errors',
            failedRows.map((failure) => ({ ...failure.row, __error: failure.error }))
          )
        : null;

      return {
        ...counts,
        errorFileBase64,
        failedDetails: failedRows.slice(0, 10).map((failure, index) => ({ row: index + 1, error: failure.error })),
      };
    },
  };
}

module.exports = { createImportService };
