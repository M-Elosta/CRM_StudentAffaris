const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const XLSX    = require('xlsx');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[1].padStart(2,'0')}-${slash[2].padStart(2,'0')}`;
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const mon = s.match(/^(\d{1,2})-([a-zA-Z]{3})-(\d{4})$/);
  if (mon) return `${mon[3]}-${months[mon[2].toLowerCase()]||'01'}-${mon[1].padStart(2,'0')}`;
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0,10);
  return null;
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

// GET /api/import/template/:entity
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

// POST /api/import/parse
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

// POST /api/import/validate
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
        if      (v === 'true' || v === 'yes' || v === '1') row[field] = 1;
        else if (v === 'false' || v === 'no'  || v === '0') row[field] = 0;
      }
    }

    // Convert date fields
    for (const field of (def.dateFields || [])) {
      if (row[field] !== undefined && row[field] !== '') {
        row[field] = parseDate(row[field]) || row[field];
      }
    }

    // Resolve CompanyID: numeric → use as-is; string → lookup by CompanyName
    if (row.CompanyID !== undefined && row.CompanyID !== '' && isNaN(Number(row.CompanyID))) {
      try {
        const company = db.prepare(
          'SELECT CompanyID FROM Company WHERE LOWER(TRIM(CompanyName))=LOWER(TRIM(?))'
        ).get(String(row.CompanyID));
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
        let contact = db.prepare(
          'SELECT ContactID FROM Contact WHERE LOWER(TRIM(EmailAddress))=LOWER(TRIM(?))'
        ).get(val);

        if (!contact) {
          // Try "FirstName LastName" full-name match
          const parts = val.split(/\s+/);
          if (parts.length >= 2) {
            const lastName  = parts[parts.length - 1];
            const firstName = parts.slice(0, -1).join(' ');
            contact = db.prepare(
              'SELECT ContactID FROM Contact WHERE LOWER(TRIM(FirstName))=LOWER(?) AND LOWER(TRIM(LastName))=LOWER(?)'
            ).get(firstName.toLowerCase(), lastName.toLowerCase());
          }
        }

        if (!contact) {
          // Try "LastName, FirstName" format
          const commaIdx = val.indexOf(',');
          if (commaIdx > -1) {
            const ln = val.slice(0, commaIdx).trim();
            const fn = val.slice(commaIdx + 1).trim();
            contact = db.prepare(
              'SELECT ContactID FROM Contact WHERE LOWER(TRIM(FirstName))=LOWER(?) AND LOWER(TRIM(LastName))=LOWER(?)'
            ).get(fn.toLowerCase(), ln.toLowerCase());
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

    const errors = [];

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

// POST /api/import/confirm
router.post('/confirm', (req, res) => {
  const db = req.app.locals.db;
  const { entity, rows } = req.body;
  if (!entity || !rows) return res.status(400).json({ error: 'entity and rows required' });

  let imported = 0, updated = 0, skipped = 0, failed = 0;
  const failedRows = [];

  const insertFns = {
    Company: (db, r) => db.prepare(
      `INSERT INTO Company (CompanyName,DateAdded,Industry,Sector,Country,Address,Website,LinkedInURL,HandshakeURL,SignedMoU,FavoriteEmployer,Blacklisted,Comment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.CompanyName,r.DateAdded||new Date().toISOString().slice(0,10),r.Industry,r.Sector,r.Country,r.Address||null,r.Website||null,r.LinkedInURL||null,r.HandshakeURL||null,r.SignedMoU?1:0,r.FavoriteEmployer?1:0,r.Blacklisted?1:0,r.Comment||null),

    Contact: (db, r) => db.prepare(
      `INSERT INTO Contact (CompanyID,FirstName,LastName,DateAdded,JobTitle,EmailAddress,Address,Country,WorkPhone,Mobile,Status,CMUQGraduate,Major,GraduationYear,PrimaryContact,ResumeBook,EventInvitation,ExcludeFromMailing) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.CompanyID,r.FirstName,r.LastName,r.DateAdded||new Date().toISOString().slice(0,10),r.JobTitle||null,r.EmailAddress,r.Address||null,r.Country||null,r.WorkPhone||null,r.Mobile||null,r.Status||'Mailable',r.CMUQGraduate?1:0,r.Major||null,r.GraduationYear||null,r.PrimaryContact?1:0,r.ResumeBook?1:0,r.EventInvitation?1:0,r.ExcludeFromMailing?1:0),

    Outreach: (db, r) => db.prepare(
      `INSERT INTO OutreachEngagement (CompanyID,ContactID,InteractionType,InteractionDate,DiscussionItems,ActionPlan,FollowUpDate,InteractionStatus) VALUES (?,?,?,?,?,?,?,?)`
    ).run(r.CompanyID,r.ContactID,r.InteractionType,r.InteractionDate,r.DiscussionItems,r.ActionPlan||null,r.FollowUpDate||null,r.InteractionStatus||'In-progress'),

    Recruitment: (db, r) => db.prepare(
      `INSERT INTO Recruitment (CompanyID,ContactID,DatePosted,OpportunityTitle,Duration,HiringStartDate,HiringEndDate,Country,Mode,Status,PayAmount,TargetGroup,ArabicSpeaker,HiredStudentAlumni,Comment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.CompanyID,r.ContactID,r.DatePosted||new Date().toISOString().slice(0,10),r.OpportunityTitle,r.Duration||null,r.HiringStartDate||null,r.HiringEndDate||null,r.Country||null,r.Mode,r.Status,r.PayAmount||null,r.TargetGroup,r.ArabicSpeaker?1:0,r.HiredStudentAlumni||'Not Reported',r.Comment||null),

    'Career Event': (db, r) => db.prepare(
      `INSERT INTO CareerEvent (CompanyID,ContactID,EventName,EventDate,RegisteredStatus,CMUQAlumniAtBooth,Comment) VALUES (?,?,?,?,?,?,?)`
    ).run(r.CompanyID,r.ContactID,r.EventName,r.EventDate,r.RegisteredStatus,r.CMUQAlumniAtBooth?1:0,r.Comment||null),

    'Student-Led Event': (db, r) => db.prepare(
      `INSERT INTO StudentLedEvent (CompanyID,ContactID,ProposalDate,OrganizationName,StudentName,StudentEmail,StudentPhoneNumber,CollaborationOutcome,EventDate,EventTitle,Comment) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.CompanyID,r.ContactID,r.ProposalDate,r.OrganizationName,r.StudentName,r.StudentEmail,r.StudentPhoneNumber,r.CollaborationOutcome||'Pending',r.EventDate||null,r.EventTitle||null,r.Comment||null),

    'Academic Engagement': (db, r) => db.prepare(
      `INSERT INTO AcademicClassroomEngagement (CompanyID,ContactID,EngagementType,GuestSpeakerName,GuestTitle,Email,PhoneNumber,FacultyName,CourseNumber,CourseTitle,TopicTheme,SessionDate,SessionTime,Comment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.CompanyID,r.ContactID,r.EngagementType,r.GuestSpeakerName,r.GuestTitle,r.Email||null,r.PhoneNumber||null,r.FacultyName,r.CourseNumber,r.CourseTitle,r.TopicTheme,r.SessionDate,r.SessionTime,r.Comment||null),

    'Hiring Feedback': (db, r) => db.prepare(
      `INSERT INTO HiringFeedback (CompanyID,ContactID,FeedbackProvider,HiredStudentAlumni,DateReported,HiredStudentName,Comment) VALUES (?,?,?,?,?,?,?)`
    ).run(r.CompanyID,r.ContactID,r.FeedbackProvider,r.HiredStudentAlumni,r.DateReported,r.HiredStudentName||null,r.Comment||null),

    'Potential Collaboration': (db, r) => {
      const info = db.prepare(
        'INSERT INTO PotentialCollaboration (CompanyID,Comment) VALUES (?,?)'
      ).run(r.CompanyID, r.Comment||null);
      const ins = db.prepare(
        'INSERT INTO PotentialCollaboration_Opportunities (PotentialCollaborationID,OpportunityType) VALUES (?,?)'
      );
      for (const opp of COLLAB_OPPS) {
        if (r[opp] && r[opp] !== 0) ins.run(info.lastInsertRowid, opp);
      }
    },
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
        if (!fn) throw new Error(`Import not supported for entity "${entity}"`);
        fn(db, row);
        imported++;
      }
    } catch (err) {
      failed++;
      failedRows.push({ row, error: err.message });
    }
  }

  let errorFileBase64 = null;
  if (failedRows.length > 0) {
    const wb = XLSX.utils.book_new();
    const data = failedRows.map(f => ({ ...f.row, __error: f.error }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Errors');
    errorFileBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  }

  res.json({
    imported, updated, skipped, failed, errorFileBase64,
    failedDetails: failedRows.slice(0, 10).map((f, i) => ({ row: i + 1, error: f.error })),
  });
});

module.exports = router;
