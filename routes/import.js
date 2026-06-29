const express = require('express');
const path    = require('path');
const router  = express.Router();
const multer  = require('multer');
const {
  optionalHttpUrl,
} = require('./_validation');
const {
  excelSerialDateToISO,
  readFirstWorksheet,
  workbookBase64FromJson,
  workbookBufferFromColumns,
} = require('../lib/excel');

const MAX_IMPORT_ROWS = 5000;
const ALLOWED_IMPORT_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (extension !== '.xlsx' || !ALLOWED_IMPORT_MIME_TYPES.has(file.mimetype)) {
      const err = new Error('Only .xlsx files are supported for import');
      err.statusCode = 400;
      return cb(err);
    }
    return cb(null, true);
  },
});

const COLLAB_OPPS = [
  'Intern/Graduate Hiring','Career Events','Mentorship Programs','Mock Interviews',
  'Guest Speakers/Panelists','Workshops/Training Sessions','Company/Site Visits',
  'Community Project Partnership','Student-Led Events','Case Studies',
  'Research Partnership','Competition/Hackathon Sponsorship','Student Sponsorship',
  'MoU Signing','Other',
];

// ── Entity field definitions ────────────────────────────────────────────────────
const ENTITY_FIELDS = {
  Company: {
    required: ['CompanyName','Industry','Sector','Country'],
    optional: ['DateAdded','Address','Website','LinkedInURL','HandshakeURL','SignedMoU','FavoriteEmployer','Blacklisted','Comment'],
    enums: { Sector: ['Government','NGO','Private','Semi-government','Startup'] },
    dateFields: ['DateAdded'],
  },
  Contact: {
    required: ['CompanyID','FirstName','LastName','EmailAddress'],
    optional: ['DateAdded','JobTitle','Address','Country','WorkPhone','Mobile','LinkedInURL','HandshakeURL','CMUQGraduate','Major','GraduationYear','PrimaryContact','Status','ResumeBook','EventInvitation','ExcludeFromMailing'],
    enums: {
      Status: ['Mailable','Non-mailable'],
      Major: ['Computer Science','Information Systems','Biological Sciences','Business Administration','Artificial Intelligence','Computational Biology'],
    },
    dateFields: ['DateAdded'],
  },
  Outreach: {
    required: ['CompanyID','ContactID','InteractionType','InteractionDate','DiscussionItems'],
    optional: ['ActionPlan','FollowUpDate','InteractionStatus'],
    enums: { InteractionType: ['Call','Meeting','Company Visit'], InteractionStatus: ['Complete','In-progress'] },
    dateFields: ['InteractionDate','FollowUpDate'],
  },
  Recruitment: {
    required: ['CompanyID','ContactID','OpportunityTitle','Mode','Status','TargetGroup'],
    optional: ['DatePosted','Duration','HiringStartDate','HiringEndDate','Country','PayAmount','ArabicSpeaker','HiredStudentAlumni','Comment'],
    enums: { Mode: ['Onsite','Hybrid','Remote'], Status: ['Paid','Unpaid'], TargetGroup: ['Qatari only','Open to all'] },
    dateFields: ['DatePosted','HiringStartDate','HiringEndDate'],
  },
  'Career Event': {
    required: ['CompanyID','ContactID','EventName','EventDate','RegisteredStatus'],
    optional: ['CMUQAlumniAtBooth','Comment'],
    enums: { RegisteredStatus: ['Attended','No-Show','Cancelled'] },
    dateFields: ['EventDate'],
  },
  'Student-Led Event': {
    required: ['CompanyID','ContactID','ProposalDate','OrganizationName','StudentName','StudentEmail','StudentPhoneNumber'],
    optional: ['CollaborationOutcome','EventDate','EventTitle','Comment'],
    enums: { CollaborationOutcome: ['Completed','Pending'] },
    dateFields: ['ProposalDate','EventDate'],
  },
  'Academic Engagement': {
    required: ['CompanyID','ContactID','EngagementType','GuestSpeakerName','GuestTitle','FacultyName','CourseNumber','CourseTitle','TopicTheme','SessionDate','SessionTime'],
    optional: ['Email','PhoneNumber','Comment'],
    enums: { EngagementType: ['Guest Lecture','Panel Discussion','Community Project Partnership','Mock Interviews','Research Collaboration','Competition/Hackathon Sponsorship','Other'] },
    dateFields: ['SessionDate'],
  },
  'Hiring Feedback': {
    required: ['CompanyID','ContactID','FeedbackProvider','HiredStudentAlumni','DateReported'],
    optional: ['HiredStudentName','Comment'],
    enums: { FeedbackProvider: ['Company','Student/Alumni','Other'], HiredStudentAlumni: ['Yes','No'] },
    dateFields: ['DateReported'],
  },
  'Potential Collaboration': {
    required: ['CompanyID'],
    optional: ['Comment', ...COLLAB_OPPS],
    enums: {},
    dateFields: [],
  },
};

// ── Date parsing ────────────────────────────────────────────────────────────────
function parseDate(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    return excelSerialDateToISO(val);
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) {
    const [year, month, day] = s.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const month = first > 12 && second <= 12 ? second : first;
    const day = first > 12 && second <= 12 ? first : second;
    return `${slash[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const dash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dash) {
    const first = Number(dash[1]);
    const second = Number(dash[2]);
    const month = first > 12 && second <= 12 ? second : first;
    const day = first > 12 && second <= 12 ? first : second;
    return `${dash[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const mon = s.match(/^(\d{1,2})-([a-zA-Z]{3})-(\d{4})$/);
  if (mon) return `${mon[3]}-${months[mon[2].toLowerCase()]||'01'}-${mon[1].padStart(2,'0')}`;
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0,10);
  return null;
}

function looksLikePlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeImportPayload(entity, rows, mapping) {
  if (!ENTITY_FIELDS[entity]) {
    const err = new Error('Unknown entity');
    err.statusCode = 400;
    throw err;
  }
  if (!Array.isArray(rows) || !rows.length) {
    const err = new Error('rows must be a non-empty array');
    err.statusCode = 400;
    throw err;
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    const err = new Error(`rows must contain at most ${MAX_IMPORT_ROWS} entries`);
    err.statusCode = 400;
    throw err;
  }
  if (!looksLikePlainObject(mapping)) {
    const err = new Error('mapping must be an object');
    err.statusCode = 400;
    throw err;
  }
}

// ── Enum canonical lookup (case-insensitive + space/hyphen-insensitive) ─────────
function findCanonical(value, allowed) {
  const norm = s => s.toLowerCase().replace(/[\s\-]/g, '');
  const v = String(value);
  return allowed.find(a => a === v) ||
         allowed.find(a => a.toLowerCase() === v.toLowerCase()) ||
         allowed.find(a => norm(a) === norm(v)) ||
         null;
}

// ── Duplicate detection ─────────────────────────────────────────────────────────
// Returns { id, reason } when a matching record already exists in the database.
async function findExistingDuplicate(db, entity, row) {
  const lc = v => String(v ?? '').trim().toLowerCase();
  try {
    switch (entity) {
      case 'Company':
        if (!row.CompanyName) return null;
        { const r = (await db.prepare('SELECT CompanyID AS id FROM Company WHERE LOWER(TRIM(CompanyName))=?').get(lc(row.CompanyName)));
          if (r) return { id: r.id, reason: `Company "${row.CompanyName}" already exists` }; }
        return null;
      case 'Contact':
        if (!row.EmailAddress || !row.CompanyID) return null;
        { const r = (await db.prepare('SELECT ContactID AS id FROM Contact WHERE LOWER(TRIM(EmailAddress))=? AND CompanyID=?').get(lc(row.EmailAddress), row.CompanyID));
          if (r) return { id: r.id, reason: `Contact with email "${row.EmailAddress}" already exists at this company` }; }
        return null;
      case 'Outreach':
        if (!row.CompanyID || !row.ContactID || !row.InteractionDate) return null;
        { const r = await db.prepare('SELECT OutreachEngagementID AS id FROM OutreachEngagement WHERE CompanyID=? AND ContactID=? AND InteractionDate=? AND InteractionType=?')
            .get(row.CompanyID, row.ContactID, row.InteractionDate, row.InteractionType || '');
          if (r) return { id: r.id, reason: `Same contact, date and interaction type already recorded` }; }
        return null;
      case 'Recruitment':
        if (!row.CompanyID || !row.OpportunityTitle) return null;
        { const r = row.DatePosted
            ? (await db.prepare('SELECT RecruitmentID AS id FROM Recruitment WHERE CompanyID=? AND LOWER(TRIM(OpportunityTitle))=? AND DatePosted=?').get(row.CompanyID, lc(row.OpportunityTitle), row.DatePosted))
            : (await db.prepare('SELECT RecruitmentID AS id FROM Recruitment WHERE CompanyID=? AND LOWER(TRIM(OpportunityTitle))=?').get(row.CompanyID, lc(row.OpportunityTitle)));
          if (r) return { id: r.id, reason: `Posting "${row.OpportunityTitle}" already exists for this company` }; }
        return null;
      case 'Career Event':
        if (!row.CompanyID || !row.EventName || !row.EventDate) return null;
        { const r = (await db.prepare('SELECT CareerEventID AS id FROM CareerEvent WHERE CompanyID=? AND LOWER(TRIM(EventName))=? AND EventDate=?').get(row.CompanyID, lc(row.EventName), row.EventDate));
          if (r) return { id: r.id, reason: `This company is already registered for "${row.EventName}" on ${row.EventDate}` }; }
        return null;
      case 'Student-Led Event':
        if (!row.CompanyID || !row.ProposalDate || !row.StudentEmail) return null;
        { const r = (await db.prepare('SELECT StudentLedEventID AS id FROM StudentLedEvent WHERE CompanyID=? AND ProposalDate=? AND LOWER(TRIM(StudentEmail))=?').get(row.CompanyID, row.ProposalDate, lc(row.StudentEmail)));
          if (r) return { id: r.id, reason: `Same student proposal for this company on ${row.ProposalDate} already exists` }; }
        return null;
      case 'Academic Engagement':
        if (!row.CompanyID || !row.SessionDate || !row.GuestSpeakerName) return null;
        { const r = (await db.prepare('SELECT EngagementID AS id FROM AcademicClassroomEngagement WHERE CompanyID=? AND SessionDate=? AND LOWER(TRIM(GuestSpeakerName))=?').get(row.CompanyID, row.SessionDate, lc(row.GuestSpeakerName)));
          if (r) return { id: r.id, reason: `${row.GuestSpeakerName} already has a session on ${row.SessionDate}` }; }
        return null;
      case 'Hiring Feedback':
        if (!row.CompanyID || !row.ContactID || !row.DateReported) return null;
        { const r = (await db.prepare('SELECT HiringFeedbackID AS id FROM HiringFeedback WHERE CompanyID=? AND ContactID=? AND DateReported=?').get(row.CompanyID, row.ContactID, row.DateReported));
          if (r) return { id: r.id, reason: `Feedback from this contact on ${row.DateReported} already exists` }; }
        return null;
      case 'Potential Collaboration':
        if (!row.CompanyID) return null;
        { const r = (await db.prepare('SELECT PotentialCollaborationID AS id FROM PotentialCollaboration WHERE CompanyID=?').get(row.CompanyID));
          if (r) return { id: r.id, reason: `A collaboration record already exists for this company` }; }
        return null;
      default: return null;
    }
  } catch (_) { return null; }
}

// Key used to spot duplicate rows *within the same uploaded file*
function inFileDupKey(entity, row) {
  const lc = v => String(v ?? '').trim().toLowerCase();
  switch (entity) {
    case 'Company':                 return row.CompanyName ? `c|${lc(row.CompanyName)}` : null;
    case 'Contact':                 return row.EmailAddress && row.CompanyID ? `ct|${row.CompanyID}|${lc(row.EmailAddress)}` : null;
    case 'Outreach':                return row.CompanyID && row.ContactID && row.InteractionDate ? `o|${row.CompanyID}|${row.ContactID}|${row.InteractionDate}|${lc(row.InteractionType)}` : null;
    case 'Recruitment':             return row.CompanyID && row.OpportunityTitle ? `r|${row.CompanyID}|${lc(row.OpportunityTitle)}|${row.DatePosted || ''}` : null;
    case 'Career Event':            return row.CompanyID && row.EventName && row.EventDate ? `ce|${row.CompanyID}|${lc(row.EventName)}|${row.EventDate}` : null;
    case 'Student-Led Event':       return row.CompanyID && row.ProposalDate && row.StudentEmail ? `se|${row.CompanyID}|${row.ProposalDate}|${lc(row.StudentEmail)}` : null;
    case 'Academic Engagement':     return row.CompanyID && row.SessionDate && row.GuestSpeakerName ? `ae|${row.CompanyID}|${row.SessionDate}|${lc(row.GuestSpeakerName)}` : null;
    case 'Hiring Feedback':         return row.CompanyID && row.ContactID && row.DateReported ? `hf|${row.CompanyID}|${row.ContactID}|${row.DateReported}` : null;
    case 'Potential Collaboration': return row.CompanyID ? `pc|${row.CompanyID}` : null;
    default: return null;
  }
}

// GET /api/import/template/:entity
router.get('/template/:entity', async (req, res) => {
  const entity = decodeURIComponent(req.params.entity);
  const def = ENTITY_FIELDS[entity];
  if (!def) return res.status(404).json({ error: 'Unknown entity' });

  try {
    const cols = [...def.required, ...def.optional];
    const buf = await workbookBufferFromColumns(entity, cols);

    res.setHeader('Content-Disposition', `attachment; filename="template-${entity.replace(/ /g,'-')}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    req.app.locals.respondServerError(req, res, err);
  }
});

// POST /api/import/parse
router.post('/parse', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { headers, rows } = await readFirstWorksheet(req.file.buffer, { maxRows: MAX_IMPORT_ROWS });
    res.json({ headers, preview: rows.slice(0, 10), totalRows: rows.length, allRows: rows });
  } catch (err) {
    res.status(400).json({ error: `Could not parse file: ${err.message}` });
  }
});

// POST /api/import/validate
router.post('/validate', async (req, res) => {
  const db = req.app.locals.db;
  const { entity, rows, mapping } = req.body;
  if (!entity || !rows || !mapping) return res.status(400).json({ error: 'entity, rows, mapping required' });

  try {
    normalizeImportPayload(entity, rows, mapping);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }

  const def = ENTITY_FIELDS[entity];
  const seenKeys = new Map(); // in-file duplicate tracking: key → first row number

  const result = [];
  for (const [idx, raw] of rows.entries()) {
    // Apply mapping
    const row = Object.create(null);
    const errors = [];
    for (const [fileCol, dbCol] of Object.entries(mapping)) {
      if (dbCol && dbCol !== '__ignore__') {
        let val = looksLikePlainObject(raw) ? raw[fileCol] : undefined;
        if (typeof val === 'string') val = val.trim();
        row[dbCol] = val;
      }
    }

    // Handle virtual __full_name__ → split into FirstName + LastName
    if (row.__full_name__ !== undefined && row.__full_name__ !== '') {
      const parts = String(row.__full_name__).trim().split(/\s+/);
      if (parts.length >= 2) {
        row.LastName  = parts.pop();
        row.FirstName = parts.join(' ');
      } else {
        row.FirstName = parts[0] || '';
      }
      delete row.__full_name__;
    }

    // Auto-split FirstName if it contains a space and LastName is absent
    if (row.FirstName && String(row.FirstName).includes(' ') && !row.LastName) {
      const parts = String(row.FirstName).trim().split(/\s+/);
      row.LastName  = parts.pop();
      row.FirstName = parts.join(' ');
    }

    // Normalize boolean fields
    const BOOL_FIELDS = ['CMUQGraduate','PrimaryContact','ResumeBook','EventInvitation',
      'ExcludeFromMailing','SignedMoU','FavoriteEmployer','Blacklisted','CMUQAlumniAtBooth',
      'ArabicSpeaker', ...COLLAB_OPPS];
    for (const field of BOOL_FIELDS) {
      if (row[field] !== undefined && row[field] !== '') {
        const v = String(row[field]).trim().toLowerCase();
        if      (['true', 'yes', 'y', '1', 'on'].includes(v)) row[field] = 1;
        else if (['false', 'no', 'n', '0', 'off'].includes(v)) row[field] = 0;
      }
    }

    // Convert date fields
    for (const field of (def.dateFields || [])) {
      if (row[field] !== undefined && row[field] !== '') {
        row[field] = parseDate(row[field]) || row[field];
      }
    }

    for (const field of ['Website', 'LinkedInURL', 'HandshakeURL']) {
      if (row[field] !== undefined && row[field] !== '') {
        try {
          row[field] = optionalHttpUrl(row[field], field, 255);
        } catch (err) {
          errors.push(err.message);
        }
      }
    }

    // Resolve CompanyID: numeric → use as-is; string → lookup by CompanyName
    if (row.CompanyID !== undefined && row.CompanyID !== '' && isNaN(Number(row.CompanyID))) {
      try {
        const company = (await db.prepare(
          'SELECT CompanyID FROM Company WHERE LOWER(TRIM(CompanyName))=LOWER(TRIM(?))'
        ).get(String(row.CompanyID)));
        if (company) {
          row.CompanyID = company.CompanyID;
        } else {
          row.__companyLookupFailed = row.CompanyID;
          row.CompanyID = null;
        }
      } catch (_) {}
    }

    // Resolve ContactID: numeric → use as-is; string → lookup by email, then by full name
    if (row.ContactID !== undefined && row.ContactID !== '' && isNaN(Number(row.ContactID))) {
      try {
        const val = String(row.ContactID).trim();
        let contact = (await db.prepare(
          'SELECT ContactID FROM Contact WHERE LOWER(TRIM(EmailAddress))=LOWER(TRIM(?))'
        ).get(val));

        if (!contact) {
          // Try "FirstName LastName" full-name match
          const parts = val.split(/\s+/);
          if (parts.length >= 2) {
            const lastName  = parts[parts.length - 1];
            const firstName = parts.slice(0, -1).join(' ');
            contact = (await db.prepare(
              'SELECT ContactID FROM Contact WHERE LOWER(TRIM(FirstName))=LOWER(?) AND LOWER(TRIM(LastName))=LOWER(?)'
            ).get(firstName.toLowerCase(), lastName.toLowerCase()));
          }
        }

        if (!contact) {
          // Try "LastName, FirstName" format
          const commaIdx = val.indexOf(',');
          if (commaIdx > -1) {
            const ln = val.slice(0, commaIdx).trim();
            const fn = val.slice(commaIdx + 1).trim();
            contact = (await db.prepare(
              'SELECT ContactID FROM Contact WHERE LOWER(TRIM(FirstName))=LOWER(?) AND LOWER(TRIM(LastName))=LOWER(?)'
            ).get(fn.toLowerCase(), ln.toLowerCase()));
          }
        }

        if (contact) {
          row.ContactID = contact.ContactID;
        } else {
          row.__contactLookupFailed = val;
          row.ContactID = null;
        }
      } catch (_) {}
    }

    if (row.__companyLookupFailed) {
      errors.push(`Company "${row.__companyLookupFailed}" not found in database`);
      delete row.__companyLookupFailed;
    }
    if (row.__contactLookupFailed) {
      errors.push(`Contact "${row.__contactLookupFailed}" not found in database`);
      delete row.__contactLookupFailed;
    }

    // Required fields
    for (const f of def.required) {
      if (!row[f] && row[f] !== 0) errors.push(`${f} is required`);
    }

    // Enum validation — case-insensitive + fuzzy (space/hyphen-insensitive) with auto-correction
    for (const [field, allowed] of Object.entries(def.enums || {})) {
      if (row[field] !== undefined && row[field] !== '') {
        const canonical = findCanonical(row[field], allowed);
        if (canonical) {
          row[field] = canonical;
        } else {
          errors.push(`${field} must be one of: ${allowed.join(', ')}`);
        }
      }
    }

    // Duplicate detection — against the database (all entities)
    let duplicate = false, dupReason = null;
    const existing = await findExistingDuplicate(db, entity, row);
    if (existing) {
      duplicate = true;
      row.__existingId = existing.id;
      dupReason = existing.reason;
    }

    // Duplicate detection — within the uploaded file itself
    const key = inFileDupKey(entity, row);
    if (key) {
      if (seenKeys.has(key) && !duplicate) {
        duplicate = true;
        dupReason = `Duplicate of row ${seenKeys.get(key)} in this file`;
      } else if (!seenKeys.has(key)) {
        seenKeys.set(key, idx + 1);
      }
    }

    result.push({ rowIndex: idx, row, errors, duplicate, dupReason, status: errors.length > 0 ? 'error' : (duplicate ? 'duplicate' : 'valid') });
  }

  res.json(result);
});

// POST /api/import/confirm
router.post('/confirm', async (req, res) => {
  const db = req.app.locals.db;
  const { entity, rows } = req.body;
  if (!entity || !rows) return res.status(400).json({ error: 'entity and rows required' });

  try {
    normalizeImportPayload(entity, rows, { ok: true });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }

  let imported = 0, updated = 0, skipped = 0, failed = 0;
  const failedRows = [];

  const insertFns = {
    Company: async (db, r) => db.prepare(
      `INSERT INTO Company (CompanyName,DateAdded,Industry,Sector,Country,Address,Website,LinkedInURL,HandshakeURL,SignedMoU,FavoriteEmployer,Blacklisted,Comment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.CompanyName,r.DateAdded||new Date().toISOString().slice(0,10),r.Industry,r.Sector,r.Country,r.Address||null,r.Website||null,r.LinkedInURL||null,r.HandshakeURL||null,r.SignedMoU?1:0,r.FavoriteEmployer?1:0,r.Blacklisted?1:0,r.Comment||null),

    Contact: async (db, r) => db.prepare(
      `INSERT INTO Contact (CompanyID,FirstName,LastName,DateAdded,JobTitle,EmailAddress,Address,Country,WorkPhone,Mobile,Status,CMUQGraduate,Major,GraduationYear,PrimaryContact,ResumeBook,EventInvitation,ExcludeFromMailing) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.CompanyID,r.FirstName,r.LastName,r.DateAdded||new Date().toISOString().slice(0,10),r.JobTitle||null,r.EmailAddress,r.Address||null,r.Country||null,r.WorkPhone||null,r.Mobile||null,r.Status||'Mailable',r.CMUQGraduate?1:0,r.Major||null,r.GraduationYear||null,r.PrimaryContact?1:0,r.ResumeBook?1:0,r.EventInvitation?1:0,r.ExcludeFromMailing?1:0),

    Outreach: async (db, r) => db.prepare(
      `INSERT INTO OutreachEngagement (CompanyID,ContactID,InteractionType,InteractionDate,DiscussionItems,ActionPlan,FollowUpDate,InteractionStatus) VALUES (?,?,?,?,?,?,?,?)`
    ).run(r.CompanyID,r.ContactID,r.InteractionType,r.InteractionDate,r.DiscussionItems,r.ActionPlan||null,r.FollowUpDate||null,r.InteractionStatus||'In-progress'),

    Recruitment: async (db, r) => db.prepare(
      `INSERT INTO Recruitment (CompanyID,ContactID,DatePosted,OpportunityTitle,Duration,HiringStartDate,HiringEndDate,Country,Mode,Status,PayAmount,TargetGroup,ArabicSpeaker,HiredStudentAlumni,Comment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.CompanyID,r.ContactID,r.DatePosted||new Date().toISOString().slice(0,10),r.OpportunityTitle,r.Duration||null,r.HiringStartDate||null,r.HiringEndDate||null,r.Country||null,r.Mode,r.Status,r.PayAmount||null,r.TargetGroup,r.ArabicSpeaker?1:0,r.HiredStudentAlumni||'Not Reported',r.Comment||null),

    'Career Event': async (db, r) => db.prepare(
      `INSERT INTO CareerEvent (CompanyID,ContactID,EventName,EventDate,RegisteredStatus,CMUQAlumniAtBooth,Comment) VALUES (?,?,?,?,?,?,?)`
    ).run(r.CompanyID,r.ContactID,r.EventName,r.EventDate,r.RegisteredStatus,r.CMUQAlumniAtBooth?1:0,r.Comment||null),

    'Student-Led Event': async (db, r) => db.prepare(
      `INSERT INTO StudentLedEvent (CompanyID,ContactID,ProposalDate,OrganizationName,StudentName,StudentEmail,StudentPhoneNumber,CollaborationOutcome,EventDate,EventTitle,Comment) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.CompanyID,r.ContactID,r.ProposalDate,r.OrganizationName,r.StudentName,r.StudentEmail,r.StudentPhoneNumber,r.CollaborationOutcome||'Pending',r.EventDate||null,r.EventTitle||null,r.Comment||null),

    'Academic Engagement': async (db, r) => db.prepare(
      `INSERT INTO AcademicClassroomEngagement (CompanyID,ContactID,EngagementType,GuestSpeakerName,GuestTitle,Email,PhoneNumber,FacultyName,CourseNumber,CourseTitle,TopicTheme,SessionDate,SessionTime,Comment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.CompanyID,r.ContactID,r.EngagementType,r.GuestSpeakerName,r.GuestTitle,r.Email||null,r.PhoneNumber||null,r.FacultyName,r.CourseNumber,r.CourseTitle,r.TopicTheme,r.SessionDate,r.SessionTime,r.Comment||null),

    'Hiring Feedback': async (db, r) => db.prepare(
      `INSERT INTO HiringFeedback (CompanyID,ContactID,FeedbackProvider,HiredStudentAlumni,DateReported,HiredStudentName,Comment) VALUES (?,?,?,?,?,?,?)`
    ).run(r.CompanyID,r.ContactID,r.FeedbackProvider,r.HiredStudentAlumni,r.DateReported,r.HiredStudentName||null,r.Comment||null),

    'Potential Collaboration': async (db, r) => {
      const info = await db.prepare(
        'INSERT INTO PotentialCollaboration (CompanyID,Comment) VALUES (?,?)'
      ).run(r.CompanyID, r.Comment||null);
      const ins = db.prepare(
        'INSERT INTO PotentialCollaboration_Opportunities (PotentialCollaborationID,OpportunityType) VALUES (?,?)'
      );
      for (const opp of COLLAB_OPPS) {
        if (r[opp] && r[opp] !== 0) await ins.run(info.lastInsertRowid, opp);
      }
    },
  };

  // Overwrite for non-Company/Contact entities = delete existing + insert fresh
  // (child rows cascade via ON DELETE CASCADE)
  const DELETE_BY_PK = {
    Outreach:                  'DELETE FROM OutreachEngagement WHERE OutreachEngagementID=?',
    Recruitment:               'DELETE FROM Recruitment WHERE RecruitmentID=?',
    'Career Event':            'DELETE FROM CareerEvent WHERE CareerEventID=?',
    'Student-Led Event':       'DELETE FROM StudentLedEvent WHERE StudentLedEventID=?',
    'Academic Engagement':     'DELETE FROM AcademicClassroomEngagement WHERE EngagementID=?',
    'Hiring Feedback':         'DELETE FROM HiringFeedback WHERE HiringFeedbackID=?',
    'Potential Collaboration': 'DELETE FROM PotentialCollaboration WHERE PotentialCollaborationID=?',
  };

  for (const item of rows) {
    const row = looksLikePlainObject(item?.row) ? item.row : null;
    const action = typeof item?.action === 'string' ? item.action : 'skip';
    if (!row) {
      failed++;
      failedRows.push({ row: { __row: 'Invalid payload' }, error: 'Invalid import row payload' });
      continue;
    }
    if (action === 'skip') { skipped++; continue; }
    try {
      await db.withTransaction(async (tx) => {
        if (action === 'overwrite' && row.__existingId) {
          if (entity === 'Company') {
            await tx.prepare(`UPDATE Company SET CompanyName=?,Industry=?,Sector=?,Country=?,Address=?,Website=?,Comment=? WHERE CompanyID=?`).run(row.CompanyName,row.Industry,row.Sector,row.Country,row.Address||null,row.Website||null,row.Comment||null,row.__existingId);
          } else if (entity === 'Contact') {
            await tx.prepare(`UPDATE Contact SET FirstName=?,LastName=?,JobTitle=?,WorkPhone=?,Mobile=?,Status=? WHERE ContactID=?`).run(row.FirstName,row.LastName,row.JobTitle||null,row.WorkPhone||null,row.Mobile||null,row.Status||'Mailable',row.__existingId);
          } else if (DELETE_BY_PK[entity]) {
            await tx.prepare(DELETE_BY_PK[entity]).run(row.__existingId);
            await insertFns[entity](tx, row);
          }
          updated++;
          return;
        }

        const fn = insertFns[entity];
        if (!fn) throw new Error(`Import not supported for entity "${entity}"`);
        await fn(tx, row);
        imported++;
      });
    } catch (err) {
      failed++;
      failedRows.push({ row, error: err.message });
    }
  }

  let errorFileBase64 = null;
  if (failedRows.length > 0) {
    const data = failedRows.map(f => ({ ...f.row, __error: f.error }));
    errorFileBase64 = await workbookBase64FromJson('Errors', data);
  }

  res.json({
    imported, updated, skipped, failed, errorFileBase64,
    failedDetails: failedRows.slice(0, 10).map((f, i) => ({ row: i + 1, error: f.error })),
  });
});

module.exports = router;
