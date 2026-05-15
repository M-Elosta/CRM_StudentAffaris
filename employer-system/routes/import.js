const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const XLSX    = require('xlsx');
const path    = require('path');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Entity field definitions ────────────────────────────────────────────────────
const ENTITY_FIELDS = {
  Company: {
    required: ['CompanyName','Industry','Sector','Country'],
    optional: ['DateAdded','Address','Website','LinkedInURL','HandshakeURL','SignedMoU','FavoriteEmployer','Blacklisted','Comment'],
    enums: { Sector: ['Government','NGO','Private','Semi-government','Startup'] },
  },
  Contact: {
    required: ['CompanyID','FirstName','LastName','EmailAddress'],
    optional: ['DateAdded','JobTitle','Address','Country','WorkPhone','Mobile','LinkedInURL','HandshakeURL','CMUQGraduate','Major','GraduationYear','PrimaryContact','Status','ResumeBook','EventInvitation','ExcludeFromMailing'],
    enums: { Status: ['Mailable','Non-mailable'] },
  },
  Outreach: {
    required: ['CompanyID','ContactID','InteractionType','InteractionDate','DiscussionItems'],
    optional: ['ActionPlan','FollowUpDate','InteractionStatus'],
    enums: { InteractionType: ['Call','Meeting','Company Visit'], InteractionStatus: ['Complete','In-progress'] },
  },
  Recruitment: {
    required: ['CompanyID','ContactID','OpportunityTitle','Mode','Status','TargetGroup'],
    optional: ['DatePosted','Duration','HiringStartDate','HiringEndDate','Country','PayAmount','ArabicSpeaker','HiredStudentAlumni','Comment'],
    enums: { Mode: ['Onsite','Hybrid','Remote'], Status: ['Paid','Unpaid'], TargetGroup: ['Qatari only','Open to all'] },
  },
  'Career Event': {
    required: ['CompanyID','ContactID','EventName','EventDate','RegisteredStatus'],
    optional: ['CMUQAlumniAtBooth','Comment'],
    enums: { RegisteredStatus: ['Attended','No-Show','Cancelled'] },
  },
  'Student-Led Event': {
    required: ['CompanyID','ContactID','ProposalDate','OrganizationName','StudentName','StudentEmail','StudentPhoneNumber'],
    optional: ['CollaborationOutcome','EventDate','EventTitle','Comment'],
    enums: { CollaborationOutcome: ['Completed','Pending'] },
  },
  'Academic Engagement': {
    required: ['CompanyID','ContactID','EngagementType','GuestSpeakerName','GuestTitle','FacultyName','CourseNumber','CourseTitle','TopicTheme','SessionDate','SessionTime'],
    optional: ['Email','PhoneNumber','Comment'],
    enums: { EngagementType: ['Guest Lecture','Panel Discussion','Community Project Partnership','Mock Interviews','Research Collaboration','Competition/Hackathon Sponsorship','Other'] },
  },
  'Hiring Feedback': {
    required: ['CompanyID','ContactID','FeedbackProvider','HiredStudentAlumni','DateReported'],
    optional: ['HiredStudentName','Comment'],
    enums: { FeedbackProvider: ['Company','Student/Alumni','Other'], HiredStudentAlumni: ['Yes','No'] },
  },
  'Potential Collaboration': {
    required: ['CompanyID'],
    optional: ['Comment'],
    enums: {},
  },
};

// ── Date parsing ────────────────────────────────────────────────────────────────
function parseDate(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const s = String(val).trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY or MM/DD/YYYY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[1].padStart(2,'0')}-${slash[2].padStart(2,'0')}`;
  // DD-Mon-YYYY
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const mon = s.match(/^(\d{1,2})-([a-zA-Z]{3})-(\d{4})$/);
  if (mon) return `${mon[3]}-${months[mon[2].toLowerCase()]||'01'}-${mon[1].padStart(2,'0')}`;
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0,10);
  return null;
}

// GET /api/import/template/:entity  — download blank .xlsx template
router.get('/template/:entity', (req, res) => {
  const entity = decodeURIComponent(req.params.entity);
  const def = ENTITY_FIELDS[entity];
  if (!def) return res.status(404).json({ error: 'Unknown entity' });

  const cols = [...def.required, ...def.optional];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([cols]);
  XLSX.utils.book_append_sheet(wb, ws, entity);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', `attachment; filename="template-${entity.replace(/ /g,'-')}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// POST /api/import/parse  — parse uploaded file, return headers + rows
router.post('/parse', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    res.json({ headers, preview: rows.slice(0, 10), totalRows: rows.length, allRows: rows });
  } catch (err) {
    res.status(400).json({ error: 'Could not parse file: ' + err.message });
  }
});

// POST /api/import/validate  — validate + duplicate-check
router.post('/validate', (req, res) => {
  const db = req.app.locals.db;
  const { entity, rows, mapping } = req.body;
  if (!entity || !rows || !mapping) return res.status(400).json({ error: 'entity, rows, mapping required' });

  const def = ENTITY_FIELDS[entity];
  if (!def) return res.status(400).json({ error: 'Unknown entity' });

  const result = rows.map((raw, idx) => {
    // Apply mapping
    const row = {};
    for (const [fileCol, dbCol] of Object.entries(mapping)) {
      if (dbCol && dbCol !== '__ignore__') {
        let val = raw[fileCol];
        if (typeof val === 'string') val = val.trim();
        row[dbCol] = val;
      }
    }

    const errors = [];
    // Required fields
    for (const f of def.required) {
      if (!row[f] && row[f] !== 0) errors.push(`${f} is required`);
    }
    // Enum validation
    for (const [field, allowed] of Object.entries(def.enums || {})) {
      if (row[field] && !allowed.includes(row[field])) {
        errors.push(`${field} must be one of: ${allowed.join(', ')}`);
      }
    }

    // Duplicate detection
    let duplicate = false;
    try {
      if (entity === 'Company' && row.CompanyName) {
        const existing = db.prepare('SELECT CompanyID FROM Company WHERE LOWER(TRIM(CompanyName))=LOWER(TRIM(?))').get(row.CompanyName);
        if (existing) { duplicate = true; row.__existingId = existing.CompanyID; }
      }
      if (entity === 'Contact' && row.EmailAddress && row.CompanyID) {
        const existing = db.prepare('SELECT ContactID FROM Contact WHERE LOWER(TRIM(EmailAddress))=LOWER(TRIM(?)) AND CompanyID=?').get(row.EmailAddress, row.CompanyID);
        if (existing) { duplicate = true; row.__existingId = existing.ContactID; }
      }
    } catch (_) {}

    return { rowIndex: idx, row, errors, duplicate, status: errors.length > 0 ? 'error' : (duplicate ? 'duplicate' : 'valid') };
  });

  res.json(result);
});

// POST /api/import/confirm  — insert/update rows
router.post('/confirm', (req, res) => {
  const db = req.app.locals.db;
  const { entity, rows } = req.body; // rows: [{ row, action: 'import'|'overwrite'|'skip' }]
  if (!entity || !rows) return res.status(400).json({ error: 'entity and rows required' });

  let imported = 0, updated = 0, skipped = 0, failed = 0;
  const failedRows = [];

  const insertFns = {
    Company: (db, r) => db.prepare(`INSERT INTO Company (CompanyName,DateAdded,Industry,Sector,Country,Address,Website,LinkedInURL,HandshakeURL,SignedMoU,FavoriteEmployer,Blacklisted,Comment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.CompanyName,r.DateAdded||new Date().toISOString().slice(0,10),r.Industry,r.Sector,r.Country,r.Address||null,r.Website||null,r.LinkedInURL||null,r.HandshakeURL||null,r.SignedMoU?1:0,r.FavoriteEmployer?1:0,r.Blacklisted?1:0,r.Comment||null),
    Contact: (db, r) => db.prepare(`INSERT INTO Contact (CompanyID,FirstName,LastName,DateAdded,JobTitle,EmailAddress,Address,Country,WorkPhone,Mobile,Status,CMUQGraduate,Major,GraduationYear,PrimaryContact,ResumeBook,EventInvitation,ExcludeFromMailing) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.CompanyID,r.FirstName,r.LastName,r.DateAdded||new Date().toISOString().slice(0,10),r.JobTitle||null,r.EmailAddress,r.Address||null,r.Country||null,r.WorkPhone||null,r.Mobile||null,r.Status||'Mailable',r.CMUQGraduate?1:0,r.Major||null,r.GraduationYear||null,r.PrimaryContact?1:0,r.ResumeBook?1:0,r.EventInvitation?1:0,r.ExcludeFromMailing?1:0),
  };

  for (const { row, action } of rows) {
    if (action === 'skip') { skipped++; continue; }
    try {
      if (action === 'overwrite' && row.__existingId) {
        if (entity === 'Company') {
          db.prepare(`UPDATE Company SET CompanyName=?,Industry=?,Sector=?,Country=?,Address=?,Website=?,Comment=? WHERE CompanyID=?`).run(row.CompanyName,row.Industry,row.Sector,row.Country,row.Address||null,row.Website||null,row.Comment||null,row.__existingId);
        } else if (entity === 'Contact') {
          db.prepare(`UPDATE Contact SET FirstName=?,LastName=?,JobTitle=?,WorkPhone=?,Mobile=?,Status=? WHERE ContactID=?`).run(row.FirstName,row.LastName,row.JobTitle||null,row.WorkPhone||null,row.Mobile||null,row.Status||'Mailable',row.__existingId);
        }
        updated++;
      } else {
        const fn = insertFns[entity];
        if (fn) fn(db, row);
        imported++;
      }
    } catch (err) {
      failed++;
      failedRows.push({ row, error: err.message });
    }
  }

  // Generate error file if needed
  let errorFileBase64 = null;
  if (failedRows.length > 0) {
    const wb = XLSX.utils.book_new();
    const data = failedRows.map(f => ({ ...f.row, __error: f.error }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Errors');
    const buf = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    errorFileBase64 = buf;
  }

  res.json({ imported, updated, skipped, failed, errorFileBase64 });
});

module.exports = router;
