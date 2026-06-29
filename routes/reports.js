const express = require('express');
const router  = express.Router();
const {
  optionalIsoDate,
  optionalStringArray,
  optionalTrimmedString,
  requirePositiveInt,
  requireTrimmedString,
  sendValidationError,
  validationError,
} = require('./_validation');
const { workbookBufferFromJson } = require('../lib/excel');

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'viewer';
}

function requireAdminSession(req, res, next) {
  if (normalizeRole(req.session?.role) !== 'admin') {
    return res.status(403).json({ error: 'Viewers cannot make changes. Contact an admin.' });
  }
  next();
}

// ── Chart colour palette (consistent with dashboard) ───────────────────────────
const PALETTE = ['#4361ee','#f72585','#4cc9f0','#2ec4b6','#ff9f1c','#e71d36',
                 '#3a0ca3','#7209b7','#06d6a0','#118ab2','#ffd166','#ef476f'];
const ISO_DATEISH_RE = /^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/;

// ── Month label helper ─────────────────────────────────────────────────────────
function monthLabel(str) {
  if (!str) return 'Unknown';
  const d = new Date(str.slice(0, 7) + '-01');
  return isNaN(d) ? str.slice(0, 7) : d.toLocaleString('en', { month: 'short', year: 'numeric' });
}

// ── Date range WHERE clause builder ───────────────────────────────────────────
function dateClause(col, from, to) {
  const parts = [], params = [];
  if (from) { parts.push(`${col} >= ?`); params.push(from); }
  if (to)   { parts.push(`${col} <= ?`); params.push(to); }
  return { sql: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateOutput(value) {
  if (typeof value !== 'string') return value;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1].slice(-2)}`;
}

function formatRowsForOutput(rows) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value === 'string' && ISO_DATEISH_RE.test(value)) return [key, formatDateOutput(value)];
    return [key, value];
  })));
}

function academicYearKey(startYear) {
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function academicYearLabel(startYear) {
  return `AY${academicYearKey(startYear)}`;
}

function academicYearRange(startYear) {
  return {
    kind: 'academic-year',
    startYear,
    key: academicYearKey(startYear),
    label: academicYearLabel(startYear),
    from: `${startYear}-08-01`,
    to: `${startYear + 1}-05-31`,
    order: startYear,
  };
}

function academicYearStartForDate(dateStr) {
  if (!dateStr) return new Date().getFullYear();
  const month = Number(String(dateStr).slice(5, 7));
  const year = Number(String(dateStr).slice(0, 4));
  if (!month || !year) return new Date().getFullYear();
  return month >= 8 ? year : year - 1;
}

function academicYearOf(dateStr) {
  if (!dateStr) return null;
  const month = Number(String(dateStr).slice(5, 7));
  const year = Number(String(dateStr).slice(0, 4));
  if (!month || !year || (month >= 6 && month <= 7)) return null;
  return academicYearRange(month >= 8 ? year : year - 1);
}

function academicYearFromKey(key) {
  const value = optionalTrimmedString(key, 'academicYear', 16);
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2}|\d{4})$/);
  if (!match) throw validationError('academicYear must be in YYYY-YY format');
  const startYear = Number(match[1]);
  const endYear = match[2].length === 2 ? Number(`${match[1].slice(0, 2)}${match[2]}`) : Number(match[2]);
  if (endYear !== startYear + 1) throw validationError('academicYear must span consecutive years');
  return academicYearRange(startYear);
}

function semesterRange(term, year) {
  if (term === 'fall') return { kind: 'semester', term, year, key: `${year}-fall`, label: `Fall ${year}`, order: year * 3 + 2, from: `${year}-08-01`, to: `${year}-12-31` };
  if (term === 'spring') return { kind: 'semester', term, year, key: `${year}-spring`, label: `Spring ${year}`, order: year * 3 + 0, from: `${year}-01-01`, to: `${year}-05-31` };
  return { kind: 'semester', term, year, key: `${year}-summer`, label: `Summer ${year}`, order: year * 3 + 1, from: `${year}-06-01`, to: `${year}-07-31` };
}

function semesterFromKey(key) {
  const value = optionalTrimmedString(key, 'semester', 16);
  if (!value) return null;
  const match = value.match(/^(\d{4})-(fall|spring|summer)$/i);
  if (!match) throw validationError('semester must be in YYYY-fall, YYYY-spring, or YYYY-summer format');
  return semesterRange(match[2].toLowerCase(), Number(match[1]));
}

function resolveQuickReportPeriod(query) {
  const from = optionalIsoDate(query.from, 'from');
  const to = optionalIsoDate(query.to, 'to');
  const semester = semesterFromKey(query.semester || null);
  const academicYear = academicYearFromKey(query.academicYear || null);
  const requestedViewMode = ['date', 'semester', 'academic-year'].includes(query.viewMode)
    ? query.viewMode
    : null;

  if ((semester || academicYear) && (from || to)) {
    throw validationError('Use either custom dates or semester/academicYear filters, not both');
  }
  if (semester && academicYear) {
    throw validationError('Choose either a semester or an academicYear filter');
  }

  let mode = 'all';
  let label = 'All time';
  let resolvedFrom = from || null;
  let resolvedTo = to || null;

  if (semester) {
    mode = 'semester';
    label = semester.label;
    resolvedFrom = semester.from;
    resolvedTo = semester.to;
  } else if (academicYear) {
    mode = 'academic-year';
    label = academicYear.label;
    resolvedFrom = academicYear.from;
    resolvedTo = academicYear.to;
  } else if (resolvedFrom || resolvedTo) {
    mode = 'date';
    label = resolvedFrom && resolvedTo
      ? `${formatDateOutput(resolvedFrom)} - ${formatDateOutput(resolvedTo)}`
      : resolvedFrom
        ? `From ${formatDateOutput(resolvedFrom)}`
        : `To ${formatDateOutput(resolvedTo)}`;
  }

  if (resolvedFrom && resolvedTo && resolvedFrom > resolvedTo) {
    throw validationError('from must be on or before to');
  }

  return {
    mode,
    label,
    from: resolvedFrom,
    to: resolvedTo,
    semester: semester ? semester.key : null,
    academicYear: academicYear ? academicYear.key : null,
    viewMode: requestedViewMode || mode,
  };
}

async function reportDateBounds(db) {
  return (await db.prepare(`
    SELECT MIN(d) AS minDate, MAX(d) AS maxDate
    FROM (
      SELECT DateAdded AS d FROM Company
      UNION ALL SELECT DateAdded FROM Contact
      UNION ALL SELECT InteractionDate FROM OutreachEngagement
      UNION ALL SELECT DatePosted FROM Recruitment
      UNION ALL SELECT DateReported FROM HiringFeedback
      UNION ALL SELECT EventDate FROM CareerEvent
      UNION ALL SELECT ProposalDate FROM StudentLedEvent
      UNION ALL SELECT SessionDate FROM AcademicClassroomEngagement
    )
    WHERE d IS NOT NULL AND d != ''
  `).get());
}

async function buildReportPeriods(db) {
  const bounds = await reportDateBounds(db);
  const currentDate = todayIso();
  const latestDataDate = bounds.maxDate || currentDate;
  const currentSemester = semesterOf(currentDate);
  const firstSemester = semesterOf(bounds.minDate || currentDate);
  const lastSemester = semesterOf(bounds.maxDate || currentDate);
  const startSemester = firstSemester.order <= currentSemester.order ? firstSemester : currentSemester;
  const endSemester = lastSemester.order >= currentSemester.order ? lastSemester : currentSemester;
  const semesters = [];
  let cursor = startSemester;

  while (cursor && cursor.order <= endSemester.order) {
    semesters.push({ key: cursor.key, label: cursor.label, from: cursor.from, to: cursor.to });
    cursor = nextSemesterOf(cursor);
  }

  const startAcademicYear = Math.min(academicYearStartForDate(bounds.minDate || currentDate), academicYearStartForDate(currentDate));
  const endAcademicYear = Math.max(academicYearStartForDate(bounds.maxDate || currentDate), academicYearStartForDate(currentDate));
  const academicYears = [];
  for (let year = startAcademicYear; year <= endAcademicYear; year++) {
    const range = academicYearRange(year);
    academicYears.push({ key: range.key, label: range.label, from: range.from, to: range.to });
  }

  return {
    semesters,
    academicYears,
    defaults: {
      semester: semesterOf(latestDataDate).key,
      academicYear: academicYearRange(academicYearStartForDate(latestDataDate)).key,
    },
  };
}

function semesterSeries(startSemester, endSemester) {
  const semesters = [];
  let cursor = startSemester;
  while (cursor && cursor.order <= endSemester.order) {
    semesters.push(cursor);
    cursor = nextSemesterOf(cursor);
  }
  return semesters;
}

async function reportSemesterSeries(db, from, to) {
  const bounds = await reportDateBounds(db);
  const currentDate = todayIso();
  const currentSemester = semesterOf(currentDate);

  if (from || to) {
    const start = semesterOf(from || to || currentDate) || currentSemester;
    const end = semesterOf(to || from || currentDate) || currentSemester;
    return semesterSeries(start.order <= end.order ? start : end, end.order >= start.order ? end : start);
  }

  const firstSemester = semesterOf(bounds.minDate || currentDate) || currentSemester;
  const lastSemester = semesterOf(bounds.maxDate || currentDate) || currentSemester;
  const startSemester = firstSemester.order <= currentSemester.order ? firstSemester : currentSemester;
  const endSemester = lastSemester.order >= currentSemester.order ? lastSemester : currentSemester;
  return semesterSeries(startSemester, endSemester);
}

async function reportAcademicYearSeries(db, from, to) {
  const bounds = await reportDateBounds(db);
  const currentDate = todayIso();

  if (from || to) {
    const start = academicYearOf(from || to || currentDate) || academicYearRange(academicYearStartForDate(currentDate));
    const end = academicYearOf(to || from || currentDate) || academicYearRange(academicYearStartForDate(currentDate));
    const years = [];
    const lo = Math.min(start.startYear, end.startYear);
    const hi = Math.max(start.startYear, end.startYear);
    for (let year = lo; year <= hi; year++) years.push(academicYearRange(year));
    return years;
  }

  const startYear = Math.min(academicYearStartForDate(bounds.minDate || currentDate), academicYearStartForDate(currentDate));
  const endYear = Math.max(academicYearStartForDate(bounds.maxDate || currentDate), academicYearStartForDate(currentDate));
  const years = [];
  for (let year = startYear; year <= endYear; year++) years.push(academicYearRange(year));
  return years;
}

function baseComparisonPeriod(periodCtx, anchorDate) {
  if (periodCtx?.mode === 'academic-year' && periodCtx.academicYear) return academicYearFromKey(periodCtx.academicYear);
  if (periodCtx?.mode === 'semester' && periodCtx.semester) return semesterFromKey(periodCtx.semester);
  return semesterOf(anchorDate || todayIso());
}

function previousComparisonPeriod(period) {
  if (period.kind === 'academic-year') return academicYearRange(period.startYear - 1);
  return prevSemesterOf(period);
}

function academicYearForSemester(semester) {
  return academicYearRange(semester.term === 'fall' ? semester.year : semester.year - 1);
}

async function collectOpportunityEvents(db, from, to) {
  const sources = [
    { kind: 'recruitment', sql: `SELECT r.DatePosted AS d, c.Industry AS industry, c.CompanyName AS company FROM Recruitment r JOIN Company c ON r.CompanyID=c.CompanyID WHERE 1=1`, dateCol: 'DatePosted' },
    { kind: 'engagement', sql: `SELECT o.InteractionDate AS d, c.Industry AS industry, c.CompanyName AS company FROM OutreachEngagement o JOIN Company c ON o.CompanyID=c.CompanyID WHERE 1=1`, dateCol: 'InteractionDate' },
    { kind: 'engagement', sql: `SELECT e.EventDate AS d, c.Industry AS industry, c.CompanyName AS company FROM CareerEvent e JOIN Company c ON e.CompanyID=c.CompanyID WHERE e.RegisteredStatus='Attended'`, dateCol: 'EventDate' },
    { kind: 'engagement', sql: `SELECT a.SessionDate AS d, c.Industry AS industry, c.CompanyName AS company FROM AcademicClassroomEngagement a JOIN Company c ON a.CompanyID=c.CompanyID WHERE 1=1`, dateCol: 'SessionDate' },
  ];

  const events = [];
  for (const source of sources) {
    const dc = dateClause(source.dateCol, from, to);
    (await db.prepare(`${source.sql}${dc.sql}`).all(...dc.params)).forEach(row => {
      const semester = semesterOf(row.d);
      if (!semester) return;
      const academicYear = academicYearOf(row.d);
      events.push({
        semester,
        academicYear,
        chartLabel: academicYear ? `${academicYear.label} • ${semester.label}` : semester.label,
        industry: row.industry || 'Unknown',
        company: row.company || 'Unknown',
        kind: source.kind,
      });
    });
  }
  return events;
}

// ────────────────────────────────────────────────────────────────────────────
// QUICK REPORT DEFINITIONS
// Each fn(db, from, to) returns { rows, chartData: { type, labels, datasets } }
// ────────────────────────────────────────────────────────────────────────────
const QUICK_REPORTS = {

  // ── Contact Lists ──────────────────────────────────────────────────────────

  // These are current-state lists (mailing status, flags, alumni status), so
  // they intentionally ignore the global date filter and always show the live set.

  'mailable-contacts': async (db, from, to) => {
    const rows = (await db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
             co.EmailAddress AS "Email", co.JobTitle AS "Job Title",
             COALESCE(co.WorkPhone, co.Mobile) AS "Phone", COALESCE(co.Country, c.Country) AS "Country"
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.Status='Mailable' AND co.ExcludeFromMailing=0 AND c.Blacklisted=0
      ORDER BY c.CompanyName, co.LastName`).all());
    const agg = {};
    rows.forEach(r => { agg[r.Company] = (agg[r.Company] || 0) + 1; });
    const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]);
    return { rows, chartData: {
      type: 'pie', labels: sorted.map(x=>x[0]),
      datasets: [{ data: sorted.map(x=>x[1]), backgroundColor: PALETTE }]
    }, meta: { periodLabel: 'Current records', periodMode: 'snapshot' }};
  },

  'event-invitation': async (db, from, to) => {
    const rows = (await db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
             co.EmailAddress AS "Email", co.JobTitle AS "Job Title",
             COALESCE(co.WorkPhone, co.Mobile) AS "Phone", COALESCE(co.Country, c.Country) AS "Country"
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.EventInvitation=1 AND co.Status='Mailable' AND co.ExcludeFromMailing=0 AND c.Blacklisted=0
      ORDER BY c.CompanyName, co.LastName`).all());
    const agg = {};
    rows.forEach(r => { agg[r.Company] = (agg[r.Company] || 0) + 1; });
    const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]).slice(0, 20);
    return { rows, chartData: {
      type: 'bar', labels: sorted.map(x=>x[0]),
      datasets: [{ label: 'Contacts', data: sorted.map(x=>x[1]),
                   backgroundColor: '#4361ee', borderRadius: 4 }]
    }, meta: { periodLabel: 'Current records', periodMode: 'snapshot' }};
  },

  'resume-book': async (db, from, to) => {
    const rows = (await db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
             co.EmailAddress AS "Email", co.JobTitle AS "Job Title",
             COALESCE(co.WorkPhone, co.Mobile) AS "Phone", COALESCE(co.Country, c.Country) AS "Country",
             co.Major AS "Major", co.GraduationYear AS "Grad Year"
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.ResumeBook=1 AND co.Status='Mailable' AND co.ExcludeFromMailing=0 AND c.Blacklisted=0
      ORDER BY co.Major, co.LastName`).all());
    const agg = {};
    rows.forEach(r => { const k = r.Major || 'Not Set'; agg[k] = (agg[k] || 0) + 1; });
    const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]);
    return { rows, chartData: {
      type: 'bar', labels: sorted.map(x=>x[0]),
      datasets: [{ label: 'Contacts', data: sorted.map(x=>x[1]),
                   backgroundColor: '#2ec4b6', borderRadius: 4 }]
    }, meta: { periodLabel: 'Current records', periodMode: 'snapshot' }};
  },

  'non-mailable': async (db, from, to) => {
    const rows = (await db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
             co.EmailAddress AS "Email",
             CASE WHEN c.Blacklisted=1 THEN 'Blacklisted Company' ELSE 'Manually Set' END AS "Reason"
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.Status='Non-mailable'
      ORDER BY co.LastName`).all());
    const bl = rows.filter(r => r.Reason === 'Blacklisted Company').length;
    const mn = rows.length - bl;
    return { rows, chartData: {
      type: 'pie', labels: ['Blacklisted Company', 'Manually Set'],
      datasets: [{ data: [bl, mn], backgroundColor: ['#e71d36','#adb5bd'] }]
    }, meta: { periodLabel: 'Current records', periodMode: 'snapshot' }};
  },

  'primary-contacts': async (db, from, to) => {
    const rows = (await db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
             co.EmailAddress AS "Email", co.JobTitle AS "Job Title",
             COALESCE(co.WorkPhone, co.Mobile) AS "Phone"
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.PrimaryContact=1 AND co.Status='Mailable' AND co.ExcludeFromMailing=0 AND c.Blacklisted=0
      ORDER BY c.CompanyName, co.LastName`).all());
    const agg = {};
    rows.forEach(r => { agg[r.Company] = (agg[r.Company] || 0) + 1; });
    const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]).slice(0, 20);
    return { rows, chartData: {
      type: 'bar', labels: sorted.map(x=>x[0]),
      datasets: [{ label: 'Primary Contacts', data: sorted.map(x=>x[1]),
                   backgroundColor: '#f72585', borderRadius: 4 }]
    }, meta: { periodLabel: 'Current records', periodMode: 'snapshot' }};
  },

  'alumni-contacts': async (db, from, to) => {
    const rows = (await db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
             co.Major AS "Major", co.GraduationYear AS "Grad Year",
             co.EmailAddress AS "Email", co.JobTitle AS "Job Title"
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.CMUQGraduate=1 AND c.Blacklisted=0
      ORDER BY co.GraduationYear DESC, co.LastName`).all());
    const agg = {};
    rows.forEach(r => { const k = r.Major || 'Not Set'; agg[k] = (agg[k] || 0) + 1; });
    const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]);
    return { rows, chartData: {
      type: 'bar', labels: sorted.map(x=>x[0]),
      datasets: [{ label: 'Alumni', data: sorted.map(x=>x[1]),
                   backgroundColor: '#7209b7', borderRadius: 4 }]
    }, meta: { periodLabel: 'Current records', periodMode: 'snapshot' }};
  },

  // ── Company Reports ────────────────────────────────────────────────────────

  'all-companies': async (db, from, to) => {
    const dc = dateClause('c.DateAdded', from, to);
    const rows = (await db.prepare(`
      SELECT c.CompanyName AS "Name", c.Industry, c.Sector, c.Country,
             date(c.DateAdded) AS "Date Added", c.Website,
             CASE WHEN c.SignedMoU=1 THEN 'Yes' ELSE 'No' END AS "Signed MoU",
             CASE WHEN c.FavoriteEmployer=1 THEN 'Yes' ELSE 'No' END AS "Favorite"
      FROM Company c WHERE c.Blacklisted=0${dc.sql}
      ORDER BY c.CompanyName`).all(...dc.params));
    const agg = {};
    rows.forEach(r => { agg[r.Sector] = (agg[r.Sector] || 0) + 1; });
    const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]);
    return { rows, chartData: {
      type: 'pie', labels: sorted.map(x=>x[0]),
      datasets: [{ data: sorted.map(x=>x[1]), backgroundColor: PALETTE }]
    }};
  },

  'blacklisted-companies': async (db, from, to) => {
    const rows = (await db.prepare(`
      SELECT CompanyName AS "Name", Industry, Country, Comment
      FROM Company WHERE Blacklisted=1
      ORDER BY CompanyName`).all());
    const agg = {};
    rows.forEach(r => { agg[r.Industry || 'Unknown'] = (agg[r.Industry || 'Unknown'] || 0) + 1; });
    const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]);
    return { rows, chartData: {
      type: 'bar', labels: sorted.map(x=>x[0]),
      datasets: [{ label: 'Blacklisted', data: sorted.map(x=>x[1]),
                   backgroundColor: '#e71d36', borderRadius: 4 }]
    }};
  },

  'companies-by-country': async (db, from, to) => {
    const dc = dateClause('c.DateAdded', from, to);
    const rows = (await db.prepare(`
      SELECT c.Country, COUNT(DISTINCT c.CompanyID) AS "Company Count",
             COUNT(DISTINCT co.ContactID) AS "Contact Count"
      FROM Company c LEFT JOIN Contact co ON c.CompanyID=co.CompanyID
      WHERE c.Blacklisted=0${dc.sql}
      GROUP BY c.Country ORDER BY "Company Count" DESC`).all(...dc.params));
    return { rows, chartData: {
      type: 'bar', indexAxis: 'y', labels: rows.map(r=>r.Country),
      datasets: [{ label: 'Companies', data: rows.map(r=>r['Company Count']),
                   backgroundColor: '#4361ee', borderRadius: 4 }]
    }};
  },

  'companies-by-sector': async (db, from, to) => {
    const dc = dateClause('c.DateAdded', from, to);
    const total = (await db.prepare(`SELECT COUNT(*) AS n FROM Company c WHERE c.Blacklisted=0${dc.sql}`).get(...dc.params)).n;
    const rows = (await db.prepare(`
      SELECT c.Sector AS Sector, COUNT(*) AS "Company Count",
             ROUND(COUNT(*)*100.0/?, 1) AS "Percentage"
      FROM Company c WHERE c.Blacklisted=0${dc.sql}
      GROUP BY c.Sector ORDER BY "Company Count" DESC`).all(total, ...dc.params));
    return { rows, chartData: {
      type: 'doughnut', labels: rows.map(r=>r.Sector),
      datasets: [{ data: rows.map(r=>r['Company Count']), backgroundColor: PALETTE }]
    }};
  },

  'favorite-employers': async (db, from, to) => {
    const dc = dateClause('c.DateAdded', from, to);
    const rows = (await db.prepare(`
      SELECT c.CompanyName AS "Name", c.Industry, c.Sector, c.Country,
             COUNT(co.ContactID) AS "Contact Count"
      FROM Company c LEFT JOIN Contact co ON c.CompanyID=co.CompanyID
      WHERE c.FavoriteEmployer=1${dc.sql}
      GROUP BY c.CompanyID ORDER BY "Contact Count" DESC`).all(...dc.params));
    const bySector = {};
    rows.forEach(r => { bySector[r.Sector] = (bySector[r.Sector] || 0) + 1; });
    const sorted = Object.entries(bySector).sort((a,b)=>b[1]-a[1]);
    return { rows, chartData: {
      type: 'bar', labels: sorted.map(x=>x[0]),
      datasets: [{ label: 'Favorites', data: sorted.map(x=>x[1]),
                   backgroundColor: '#ff9f1c', borderRadius: 4 }]
    }};
  },

  'new-companies': async (db, from, to) => {
    const dc = dateClause('c.DateAdded', from, to);
    const rows = (await db.prepare(`
      SELECT c.CompanyName AS "Name", c.Industry, c.Sector, c.Country, date(c.DateAdded) AS "Date Added"
      FROM Company c WHERE 1=1${dc.sql}
      ORDER BY c.DateAdded DESC`).all(...dc.params));
    const agg = {};
    rows.forEach(r => {
      const m = (r['Date Added'] || '').slice(0, 7);
      if (m) agg[m] = (agg[m] || 0) + 1;
    });
    const months = Object.keys(agg).sort();
    return { rows, chartData: {
      type: 'line', labels: months.map(monthLabel),
      datasets: [{ label: 'New Companies', data: months.map(m=>agg[m]),
                   borderColor: '#4361ee', backgroundColor: 'rgba(67,97,238,0.1)',
                   fill: true, tension: 0.3 }]
    }};
  },

  'mou-partners': async (db, from, to) => {
    const rows = (await db.prepare(`
      SELECT c.CompanyName AS "Name", c.Industry, c.Sector, c.Country,
             COUNT(co.ContactID) AS "Contact Count"
      FROM Company c LEFT JOIN Contact co ON c.CompanyID=co.CompanyID
      WHERE c.SignedMoU=1
      GROUP BY c.CompanyID ORDER BY c.CompanyName`).all());
    const bySector = {};
    rows.forEach(r => { bySector[r.Sector] = (bySector[r.Sector] || 0) + 1; });
    const sorted = Object.entries(bySector).sort((a,b)=>b[1]-a[1]);
    return { rows, chartData: {
      type: 'pie', labels: sorted.map(x=>x[0]),
      datasets: [{ data: sorted.map(x=>x[1]), backgroundColor: PALETTE }]
    }};
  },

  // ── Engagement & Activity ──────────────────────────────────────────────────

  'followup-actions': async (db, from, to) => {
    const today = new Date().toISOString().slice(0,10);
    const weekEnd = new Date(Date.now() + 7*86400000).toISOString().slice(0,10);
    const rows = (await db.prepare(`
      SELECT c.CompanyName AS "Company", co.FirstName||' '||co.LastName AS "Contact",
             o.InteractionType AS "Type", date(o.InteractionDate) AS "Interaction Date",
             date(o.FollowUpDate) AS "Follow-Up Date", o.DiscussionItems AS "Discussion Items",
             o.ActionPlan AS "Action Plan",
             CAST(julianday(o.FollowUpDate) - julianday('now') AS INTEGER) AS "_days_until",
             CASE
               WHEN o.FollowUpDate < date('now') THEN 'overdue'
               WHEN o.FollowUpDate <= date('now','+7 days') THEN 'this-week'
               ELSE 'upcoming'
             END AS "_urgency"
      FROM OutreachEngagement o
      JOIN Company c  ON o.CompanyID=c.CompanyID
      JOIN Contact co ON o.ContactID=co.ContactID
      WHERE o.InteractionStatus='In-progress' AND o.FollowUpDate IS NOT NULL
      ORDER BY o.FollowUpDate ASC`).all());
    const counts = { overdue:0, 'this-week':0, upcoming:0 };
    rows.forEach(r => { counts[r._urgency] = (counts[r._urgency]||0)+1; });
    return { rows, chartData: {
      type: 'bar', labels: ['Overdue','Due This Week','Upcoming'],
      datasets: [{ label: 'Follow-ups', data: [counts.overdue, counts['this-week'], counts.upcoming],
                   backgroundColor: ['#e71d36','#ff9f1c','#4361ee'], borderRadius: 4 }]
    }};
  },

  'engagement-summary': async (db, from, to) => {
    const makeFilter = (col) => {
      const dc = dateClause(col, from, to);
      return { f: dc.sql, p: dc.params };
    };
    const o = makeFilter('InteractionDate'), r2 = makeFilter('DatePosted'),
          ce = makeFilter('EventDate'),       ac = makeFilter('SessionDate'),
          se = makeFilter('ProposalDate'),    hf = makeFilter('DateReported');
    const rows = (await db.prepare(`
      SELECT c.CompanyName AS "Company",
        (SELECT COUNT(*) FROM OutreachEngagement WHERE CompanyID=c.CompanyID${o.f}) AS "Outreach",
        (SELECT COUNT(*) FROM Recruitment WHERE CompanyID=c.CompanyID${r2.f}) AS "Recruitment",
        (SELECT COUNT(*) FROM CareerEvent WHERE CompanyID=c.CompanyID${ce.f}) AS "Career Events",
        (SELECT COUNT(*) FROM AcademicClassroomEngagement WHERE CompanyID=c.CompanyID${ac.f}) AS "Academic",
        (SELECT COUNT(*) FROM StudentLedEvent WHERE CompanyID=c.CompanyID${se.f}) AS "Student Events",
        (SELECT COUNT(*) FROM HiringFeedback WHERE CompanyID=c.CompanyID${hf.f}) AS "Hiring Feedback"
      FROM Company c WHERE c.Blacklisted=0
      ORDER BY c.CompanyName`
    ).all(...o.p,...r2.p,...ce.p,...ac.p,...se.p,...hf.p)).map(r => ({
      ...r,
      "Total": r.Outreach+r.Recruitment+r['Career Events']+r.Academic+r['Student Events']+r['Hiring Feedback']
    })).sort((a,b)=>b.Total-a.Total);
    const top15 = rows.slice(0, 15);
    return { rows, chartData: {
      type: 'bar', indexAxis: 'y', labels: top15.map(r=>r.Company),
      datasets: [{ label: 'Total Engagements', data: top15.map(r=>r.Total),
                   backgroundColor: '#4361ee', borderRadius: 4 }]
    }};
  },

  'inactive-companies': async (db, from, to) => {
    const makeFilter = (col) => {
      const dc = dateClause(col, from, to);
      return { f: dc.sql, p: dc.params };
    };
    const o = makeFilter('InteractionDate'), r2 = makeFilter('DatePosted'),
          ce = makeFilter('EventDate'),       ac = makeFilter('SessionDate'),
          se = makeFilter('ProposalDate'),    hf = makeFilter('DateReported');
    const rows = (await db.prepare(`
      SELECT c.CompanyName AS "Name", c.Sector, c.Country,
             date(c.DateAdded) AS "Date Added",
             date((SELECT MAX(o.InteractionDate) FROM OutreachEngagement o WHERE o.CompanyID=c.CompanyID)) AS "Last Outreach"
      FROM Company c WHERE c.Blacklisted=0
        AND (SELECT COUNT(*) FROM OutreachEngagement WHERE CompanyID=c.CompanyID${o.f})=0
        AND (SELECT COUNT(*) FROM Recruitment WHERE CompanyID=c.CompanyID${r2.f})=0
        AND (SELECT COUNT(*) FROM CareerEvent WHERE CompanyID=c.CompanyID${ce.f})=0
        AND (SELECT COUNT(*) FROM AcademicClassroomEngagement WHERE CompanyID=c.CompanyID${ac.f})=0
        AND (SELECT COUNT(*) FROM StudentLedEvent WHERE CompanyID=c.CompanyID${se.f})=0
        AND (SELECT COUNT(*) FROM HiringFeedback WHERE CompanyID=c.CompanyID${hf.f})=0
      ORDER BY c.CompanyName`
    ).all(...o.p,...r2.p,...ce.p,...ac.p,...se.p,...hf.p));
    const bySector = {};
    rows.forEach(r => { bySector[r.Sector||'Unknown']=(bySector[r.Sector||'Unknown']||0)+1; });
    const sorted = Object.entries(bySector).sort((a,b)=>b[1]-a[1]);
    return { rows, chartData: {
      type: 'pie', labels: sorted.map(x=>x[0]),
      datasets: [{ data: sorted.map(x=>x[1]), backgroundColor: PALETTE }]
    }};
  },

  'monthly-activity': async (db, from, to) => {
    const modules = [
      { name: 'Outreach', table: 'OutreachEngagement', dateCol: 'InteractionDate' },
      { name: 'Recruitment', table: 'Recruitment', dateCol: 'DatePosted' },
      { name: 'Career Events', table: 'CareerEvent', dateCol: 'EventDate' },
      { name: 'Academic', table: 'AcademicClassroomEngagement', dateCol: 'SessionDate' },
      { name: 'Student Events', table: 'StudentLedEvent', dateCol: 'ProposalDate' },
    ];
    const monthData = {};
    for (const mod of modules) {
      const dc = dateClause(mod.dateCol, from, to);
      const agg = (await db.prepare(
        `SELECT strftime('%Y-%m', ${mod.dateCol}) AS m, COUNT(*) AS n FROM ${mod.table} WHERE ${mod.dateCol} IS NOT NULL${dc.sql} GROUP BY m ORDER BY m`
      ).all(...dc.params));
      agg.forEach(r => {
        if (!monthData[r.m]) monthData[r.m] = {};
        monthData[r.m][mod.name] = r.n;
      });
    }
    const months = Object.keys(monthData).sort();
    const rows = months.map(m => {
      const entry = { Month: monthLabel(m + '-01') };
      modules.forEach(mod => { entry[mod.name] = monthData[m][mod.name] || 0; });
      entry['Total'] = modules.reduce((s, mod) => s + (monthData[m][mod.name] || 0), 0);
      return entry;
    });
    const colors = ['#4361ee','#f72585','#4cc9f0','#2ec4b6','#ff9f1c'];
    return { rows, chartData: {
      type: 'bar', labels: months.map(m => monthLabel(m + '-01')),
      datasets: modules.map((mod, i) => ({
        label: mod.name, data: months.map(m => monthData[m][mod.name] || 0),
        backgroundColor: colors[i], borderRadius: 2, stack: 'stack'
      }))
    }};
  },

  // ── Recruitment & Hiring ───────────────────────────────────────────────────

  'recruitment-postings': async (db, from, to) => {
    const dc = dateClause('r.DatePosted', from, to);
    const rows = (await db.prepare(`
      SELECT c.CompanyName AS "Company", r.OpportunityTitle AS "Title",
             date(r.DatePosted) AS "Date", r.Mode, r.Status AS "Paid/Unpaid",
             r.TargetGroup AS "Target Group", r.HiredStudentAlumni AS "Hired",
             r.Country, r.Comment
      FROM Recruitment r JOIN Company c ON r.CompanyID=c.CompanyID
      WHERE 1=1${dc.sql} ORDER BY r.DatePosted DESC`).all(...dc.params));
    const byMode = {};
    rows.forEach(r => { byMode[r.Mode] = (byMode[r.Mode]||0)+1; });
    return { rows, chartData: {
      type: 'bar', labels: Object.keys(byMode),
      datasets: [{ label: 'Postings', data: Object.values(byMode),
                   backgroundColor: ['#4361ee','#f72585','#4cc9f0'], borderRadius: 4 }]
    }};
  },

  'recruitment-by-major': async (db, from, to) => {
    const dc = dateClause('r.DatePosted', from, to);
    const rows = (await db.prepare(`
      SELECT tm.Major,
             COUNT(*) AS "Posting Count",
             SUM(CASE WHEN r.Status='Paid' THEN 1 ELSE 0 END) AS "Paid Count",
             SUM(CASE WHEN r.Status='Unpaid' THEN 1 ELSE 0 END) AS "Unpaid Count"
      FROM Recruitment_TargetMajors tm JOIN Recruitment r ON tm.RecruitmentID=r.RecruitmentID
      WHERE 1=1${dc.sql}
      GROUP BY tm.Major ORDER BY "Posting Count" DESC`).all(...dc.params));
    return { rows, chartData: {
      type: 'bar', labels: rows.map(r=>r.Major),
      datasets: [
        { label: 'Paid', data: rows.map(r=>r['Paid Count']), backgroundColor: '#2ec4b6', borderRadius: 4, stack: 's' },
        { label: 'Unpaid', data: rows.map(r=>r['Unpaid Count']), backgroundColor: '#adb5bd', borderRadius: 4, stack: 's' }
      ]
    }};
  },

  'hiring-outcomes': async (db, from, to) => {
    const dc = dateClause('h.DateReported', from, to);
    const rows = (await db.prepare(`
      SELECT c.CompanyName AS "Company", co.FirstName||' '||co.LastName AS "Contact",
             h.FeedbackProvider AS "Provider", h.HiredStudentAlumni AS "Hired?",
             h.HiredStudentName AS "Student Name", date(h.DateReported) AS "Date"
      FROM HiringFeedback h
      JOIN Company c ON h.CompanyID=c.CompanyID JOIN Contact co ON h.ContactID=co.ContactID
      WHERE 1=1${dc.sql} ORDER BY h.DateReported DESC`).all(...dc.params));
    const yes = rows.filter(r=>r['Hired?']==='Yes').length;
    const no  = rows.length - yes;
    return { rows, chartData: {
      type: 'pie', labels: ['Hired (Yes)','Not Hired (No)'],
      datasets: [{ data: [yes, no], backgroundColor: ['#2ec4b6','#e71d36'] }]
    }};
  },

  'career-event-attendance': async (db, from, to) => {
    const dc = dateClause('e.EventDate', from, to);
    const rows = (await db.prepare(`
      SELECT c.CompanyName AS "Company", co.FirstName||' '||co.LastName AS "Contact",
             e.EventName AS "Event", date(e.EventDate) AS "Date",
             e.RegisteredStatus AS "Status",
             CASE WHEN e.CMUQAlumniAtBooth=1 THEN 'Yes' ELSE 'No' END AS "Alumni at Booth"
      FROM CareerEvent e
      JOIN Company c ON e.CompanyID=c.CompanyID JOIN Contact co ON e.ContactID=co.ContactID
      WHERE 1=1${dc.sql} ORDER BY e.EventDate DESC`).all(...dc.params));
    const byStatus = {};
    rows.forEach(r => { byStatus[r.Status] = (byStatus[r.Status]||0)+1; });
    const statuses = ['Attended','No-Show','Cancelled'];
    return { rows, chartData: {
      type: 'bar', labels: statuses,
      datasets: [{ label: 'Events', data: statuses.map(s=>byStatus[s]||0),
                   backgroundColor: ['#2ec4b6','#e71d36','#adb5bd'], borderRadius: 4 }]
    }};
  },

  'hiring-trends': async (db, from, to) => {
    const dc = dateClause('h.DateReported', from, to);
    const agg = (await db.prepare(`
      SELECT strftime('%Y-%m', h.DateReported) AS m,
             COUNT(*) AS n,
             GROUP_CONCAT(DISTINCT c.CompanyName) AS Companies
      FROM HiringFeedback h JOIN Company c ON h.CompanyID=c.CompanyID
      WHERE h.HiredStudentAlumni='Yes'${dc.sql}
      GROUP BY m ORDER BY m`).all(...dc.params));
    const rows = agg.map(r => ({
      Month: monthLabel(r.m + '-01'), 'Hired Count': r.n, 'Companies': r.Companies
    }));
    return { rows, chartData: {
      type: 'line', labels: rows.map(r=>r.Month),
      datasets: [{ label: 'Hired Students/Alumni', data: rows.map(r=>r['Hired Count']),
                   borderColor: '#2ec4b6', backgroundColor: 'rgba(46,196,182,0.1)',
                   fill: true, tension: 0.3 }]
    }};
  },

  // ── Academic & Student Events ──────────────────────────────────────────────

  'academic-engagements': async (db, from, to) => {
    const dc = dateClause('a.SessionDate', from, to);
    const rows = (await db.prepare(`
      SELECT c.CompanyName AS "Company", a.EngagementType AS "Type",
             a.GuestSpeakerName AS "Guest Speaker", a.FacultyName AS "Faculty",
             a.CourseNumber||' – '||a.CourseTitle AS "Course", date(a.SessionDate) AS "Date"
      FROM AcademicClassroomEngagement a
      JOIN Company c ON a.CompanyID=c.CompanyID
      WHERE 1=1${dc.sql} ORDER BY a.SessionDate DESC`).all(...dc.params));
    const byType = {};
    rows.forEach(r => { byType[r.Type] = (byType[r.Type]||0)+1; });
    const sorted = Object.entries(byType).sort((a,b)=>b[1]-a[1]);
    return { rows, chartData: {
      type: 'bar', labels: sorted.map(x=>x[0]),
      datasets: [{ label: 'Engagements', data: sorted.map(x=>x[1]),
                   backgroundColor: '#7209b7', borderRadius: 4 }]
    }};
  },

  'student-led-events': async (db, from, to) => {
    const dc = dateClause('s.ProposalDate', from, to);
    const rows = (await db.prepare(`
      SELECT c.CompanyName AS "Company", s.OrganizationName AS "Organization",
             s.StudentName AS "Student Name", s.EventTitle AS "Event Title",
             date(s.EventDate) AS "Date", s.CollaborationOutcome AS "Outcome"
      FROM StudentLedEvent s JOIN Company c ON s.CompanyID=c.CompanyID
      WHERE 1=1${dc.sql} ORDER BY s.ProposalDate DESC`).all(...dc.params));
    const comp = rows.filter(r=>r.Outcome==='Completed').length;
    const pend = rows.length - comp;
    return { rows, chartData: {
      type: 'pie', labels: ['Completed','Pending'],
      datasets: [{ data: [comp, pend], backgroundColor: ['#2ec4b6','#ff9f1c'] }]
    }};
  },

  'guest-speakers': async (db, from, to) => {
    const dc = dateClause('a.SessionDate', from, to);
    const rows = (await db.prepare(`
      SELECT a.GuestSpeakerName AS "Name", a.GuestTitle AS "Title",
             c.CompanyName AS "Company", a.CourseNumber||' – '||a.CourseTitle AS "Course",
             a.TopicTheme AS "Topic", date(a.SessionDate) AS "Date"
      FROM AcademicClassroomEngagement a JOIN Company c ON a.CompanyID=c.CompanyID
      WHERE 1=1${dc.sql} ORDER BY a.GuestSpeakerName`).all(...dc.params));
    const byCompany = {};
    rows.forEach(r => { byCompany[r.Company] = (byCompany[r.Company]||0)+1; });
    const sorted = Object.entries(byCompany).sort((a,b)=>b[1]-a[1]).slice(0,15);
    return { rows, chartData: {
      type: 'bar', labels: sorted.map(x=>x[0]),
      datasets: [{ label: 'Speakers', data: sorted.map(x=>x[1]),
                   backgroundColor: '#3a0ca3', borderRadius: 4 }]
    }};
  },

  // ── Trends & Insights ─────────────────────────────────────────────────────

  'industry-trends': async (db, from, to) => {
    // Engagement counts per semester per industry, across three activity types
    const collect = async (sql, col, kind, params) => (await db.prepare(sql).all(...params))
      .map(r => ({ sem: semesterOf(r.d), industry: r.industry || 'Unknown', kind }))
      .filter(r => r.sem);

    const dcR = dateClause('r.DatePosted', from, to);
    const dcE = dateClause('e.EventDate', from, to);
    const dcO = dateClause('o.InteractionDate', from, to);

    const events = [
      ...collect(`SELECT r.DatePosted AS d, c.Industry AS industry FROM Recruitment r JOIN Company c ON r.CompanyID=c.CompanyID WHERE 1=1${dcR.sql}`, 'd', 'recruitment', dcR.params),
      ...collect(`SELECT e.EventDate AS d, c.Industry AS industry FROM CareerEvent e JOIN Company c ON e.CompanyID=c.CompanyID WHERE e.RegisteredStatus='Attended'${dcE.sql}`, 'd', 'events', dcE.params),
      ...collect(`SELECT o.InteractionDate AS d, c.Industry AS industry FROM OutreachEngagement o JOIN Company c ON o.CompanyID=c.CompanyID WHERE 1=1${dcO.sql}`, 'd', 'outreach', dcO.params),
    ];

    // bucket: sem → industry → {recruitment, events, outreach}
    const buckets = {};
    events.forEach(ev => {
      const key = ev.sem.label;
      buckets[key] = buckets[key] || { order: ev.sem.order, industries: {} };
      const ind = buckets[key].industries[ev.industry] =
        buckets[key].industries[ev.industry] || { recruitment: 0, events: 0, outreach: 0 };
      ind[ev.kind]++;
    });

    const semesterList = await reportSemesterSeries(db, from, to);
    const semesters = Object.entries(buckets).sort((a, b) => a[1].order - b[1].order);
    const rows = [];
    semesters.forEach(([sem, data]) => {
      Object.entries(data.industries)
        .sort((a, b) => (b[1].recruitment + b[1].events + b[1].outreach) - (a[1].recruitment + a[1].events + a[1].outreach))
        .forEach(([industry, c]) => rows.push({
          'Semester': sem, 'Industry': industry,
          'Recruitment Count': c.recruitment, 'Events Count': c.events,
          'Outreach Count': c.outreach, 'Total': c.recruitment + c.events + c.outreach,
        }));
    });

    // stacked bar: one bar per semester, segments per industry (top 8 industries overall)
    const indTotals = {};
    rows.forEach(r => { indTotals[r.Industry] = (indTotals[r.Industry] || 0) + r.Total; });
    const topInds = Object.entries(indTotals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0]);
    const labels = semesterList.map(sem => sem.label);
    const datasets = topInds.map((ind, i) => ({
      label: ind,
      data: labels.map(sem => {
        const r = rows.find(x => x.Semester === sem && x.Industry === ind);
        return r ? r.Total : 0;
      }),
      backgroundColor: PALETTE[i % PALETTE.length],
    }));
    return { rows, chartData: { type: 'bar', labels, datasets, stacked: true } };
  },

  'opportunities-per-semester': async (db, from, to) => {
    const events = await collectOpportunityEvents(db, from, to);
    const semesterList = await reportSemesterSeries(db, from, to);
    const buckets = {};

    events.forEach(event => {
      const key = `${event.chartLabel}||${event.industry}`;
      const bucket = buckets[key] = buckets[key] || {
        order: event.semester.order,
        chartLabel: event.chartLabel,
        semester: event.semester.label,
        academicYear: event.academicYear ? event.academicYear.label : 'Outside AY',
        industry: event.industry,
        recruitment: 0,
        engagement: 0,
        companies: {},
      };
      bucket[event.kind]++;
      bucket.companies[event.company] = (bucket.companies[event.company] || 0) + 1;
    });

    const rows = Object.values(buckets)
      .sort((a, b) => a.order - b.order || (b.recruitment + b.engagement) - (a.recruitment + a.engagement))
      .map(bucket => ({
        'Academic Year': bucket.academicYear,
        'Semester': bucket.semester,
        'Industry': bucket.industry,
        'Recruitment Count': bucket.recruitment,
        'Engagement Count': bucket.engagement,
        'Total Opportunities': bucket.recruitment + bucket.engagement,
        'Top Companies': Object.entries(bucket.companies)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 3)
          .map(([company, count]) => `${company} (${count})`)
          .join(', ') || '—',
      }));

    const chartRows = Object.values(buckets);
    const topIndustries = Object.entries(rows.reduce((acc, row) => {
      acc[row.Industry] = (acc[row.Industry] || 0) + row['Total Opportunities'];
      return acc;
    }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([industry]) => industry);
    const labels = semesterList.map(sem => {
      const academicYear = academicYearOf(sem.from);
      return academicYear ? `${academicYear.label} • ${sem.label}` : sem.label;
    });
    const datasets = topIndustries.map((industry, index) => ({
      label: industry,
      data: labels.map(label => {
        const bucket = chartRows.find(item => item.industry === industry && item.chartLabel === label);
        return bucket ? bucket.recruitment + bucket.engagement : 0;
      }),
      backgroundColor: PALETTE[index % PALETTE.length],
      borderRadius: 4,
    }));

    return { rows, chartData: { type: 'bar', labels, datasets, stacked: true } };
  },

  'top-recruiters': async (db, from, to, periodCtx) => {
    const current = baseComparisonPeriod(periodCtx, from || todayIso());
    const previous = previousComparisonPeriod(current);

    const countBy = async (sql, range, params0 = []) => {
      const out = {};
      (await db.prepare(sql).all(...params0, range.from, range.to))
        .forEach(r => { out[r.company] = (out[r.company] || 0) + r.n; });
      return out;
    };
    const postSql = `SELECT c.CompanyName AS company, COUNT(*) AS n FROM Recruitment r JOIN Company c ON r.CompanyID=c.CompanyID WHERE r.DatePosted>=? AND r.DatePosted<=? GROUP BY c.CompanyName`;
    const hireSql = `SELECT c.CompanyName AS company, COUNT(*) AS n FROM HiringFeedback h JOIN Company c ON h.CompanyID=c.CompanyID WHERE h.HiredStudentAlumni='Yes' AND h.DateReported>=? AND h.DateReported<=? GROUP BY c.CompanyName`;

    const curPost = await countBy(postSql, current),  curHire = await countBy(hireSql, current);
    const prePost = await countBy(postSql, previous), preHire = await countBy(hireSql, previous);

    const companies = [...new Set([...Object.keys(curPost), ...Object.keys(curHire)])];
    const rows = companies.map(co => {
      const postings = curPost[co] || 0, hires = curHire[co] || 0;
      const total    = postings + hires;
      const prevTot  = (prePost[co] || 0) + (preHire[co] || 0);
      const diff     = total - prevTot;
      return {
        'Company': co, 'Postings': postings, 'Hires': hires, 'Total': total,
        [previous.label]: prevTot,
        'Change': diff > 0 ? `▲ +${diff}` : diff < 0 ? `▼ ${diff}` : '—',
      };
    }).sort((a, b) => b.Total - a.Total);

    const top = rows.slice(0, 15);
    return { rows, chartData: {
      type: 'bar', indexAxis: 'y',
      labels: top.map(r => r.Company),
      datasets: [
        { label: `Postings (${current.label})`, data: top.map(r => r.Postings), backgroundColor: '#4361ee', borderRadius: 4 },
        { label: `Hires (${current.label})`,    data: top.map(r => r.Hires),    backgroundColor: '#2ec4b6', borderRadius: 4 },
      ],
    }};
  },

  'top-roles-by-program': async (db, from, to) => {
    const dc = dateClause('r.DatePosted', from, to);
    const raw = (await db.prepare(`
      SELECT DISTINCT r.RecruitmentID AS recruitmentId,
             COALESCE(NULLIF(TRIM(m.Major), ''), 'Unspecified') AS major,
             COALESCE(NULLIF(TRIM(t.Type), ''), 'Unspecified') AS roleType,
             TRIM(COALESCE(r.OpportunityTitle, '')) AS title,
             r.Status AS payStatus,
             r.HiredStudentAlumni AS hired
      FROM Recruitment r
      LEFT JOIN Recruitment_TargetMajors m ON m.RecruitmentID = r.RecruitmentID
      LEFT JOIN Recruitment_OpportunityType t ON t.RecruitmentID = r.RecruitmentID
      WHERE 1=1${dc.sql}`).all(...dc.params));

    const byMajor = {};
    raw.forEach(r => {
      const m = byMajor[r.major] = byMajor[r.major] || {
        titles: {},
        roleTypes: {},
        postings: new Set(),
        paid: new Set(),
        hired: new Set(),
      };
      m.postings.add(r.recruitmentId);
      if (r.payStatus === 'Paid') m.paid.add(r.recruitmentId);
      if (r.hired === 'Yes') m.hired.add(r.recruitmentId);
      if (r.title) m.titles[r.title] = (m.titles[r.title] || 0) + 1;
      if (r.roleType) m.roleTypes[r.roleType] = (m.roleTypes[r.roleType] || 0) + 1;
    });

    const rows = Object.entries(byMajor)
      .sort((a, b) => b[1].postings.size - a[1].postings.size)
      .map(([major, m]) => {
        const postingCount = m.postings.size;
        const topRoleTypes = Object.entries(m.roleTypes).sort((a, b) => b[1] - a[1]).slice(0, 3);
        return {
          'Program': major,
          'Top Job Role Types': topRoleTypes.map(([type, count]) => `${type} (${count})`).join(', ') || '—',
          'Top Opportunity Titles': Object.entries(m.titles).sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([t, n]) => `${t} (${n})`).join(', ') || '—',
          'Posting Count': postingCount,
          'Paid %': postingCount ? Math.round(m.paid.size / postingCount * 100) + '%' : '0%',
          'Hired Count': m.hired.size,
        };
      });

    const topRoleTypes = Object.entries(Object.values(byMajor).reduce((acc, major) => {
      Object.entries(major.roleTypes).forEach(([type, count]) => {
        acc[type] = (acc[type] || 0) + count;
      });
      return acc;
    }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([type]) => type);

    return { rows, chartData: {
      type: 'bar',
      indexAxis: 'y',
      stacked: true,
      labels: rows.map(r => r.Program),
      datasets: topRoleTypes.length
        ? topRoleTypes.map((type, index) => ({
            label: type,
            data: rows.map(row => byMajor[row.Program]?.roleTypes?.[type] || 0),
            backgroundColor: PALETTE[index % PALETTE.length],
            borderRadius: 4,
          }))
        : [
            { label: 'Postings', data: rows.map(r => r['Posting Count']), backgroundColor: '#4361ee', borderRadius: 4 },
          ],
    }};
  },

  'activity-mix': async (db, from, to) => {
    const sources = [
      { label: 'Outreach', dateCol: 'o.InteractionDate', sql: 'SELECT o.InteractionDate AS d FROM OutreachEngagement o WHERE 1=1', color: '#4361ee' },
      { label: 'Recruitment', dateCol: 'r.DatePosted', sql: 'SELECT r.DatePosted AS d FROM Recruitment r WHERE 1=1', color: '#0dcaf0' },
      { label: 'Career Events', dateCol: 'e.EventDate', sql: "SELECT e.EventDate AS d FROM CareerEvent e WHERE e.RegisteredStatus='Attended'", color: '#7209b7' },
      { label: 'Academic', dateCol: 'a.SessionDate', sql: 'SELECT a.SessionDate AS d FROM AcademicClassroomEngagement a WHERE 1=1', color: '#ff9f1c' },
      { label: 'Student Events', dateCol: 's.ProposalDate', sql: 'SELECT s.ProposalDate AS d FROM StudentLedEvent s WHERE 1=1', color: '#f72585' },
      { label: 'Hires', dateCol: 'h.DateReported', sql: "SELECT h.DateReported AS d FROM HiringFeedback h WHERE h.HiredStudentAlumni='Yes'", color: '#198754' },
    ];

    const buckets = {};
    for (const source of sources) {
      const dc = dateClause(source.dateCol, from, to);
      (await db.prepare(`${source.sql}${dc.sql}`).all(...dc.params)).forEach(row => {
        const semester = semesterOf(row.d);
        if (!semester) return;
        const bucket = buckets[semester.label] = buckets[semester.label] || { order: semester.order, counts: {} };
        bucket.counts[source.label] = (bucket.counts[source.label] || 0) + 1;
      });
    }

    const semesterList = await reportSemesterSeries(db, from, to);
    const rows = semesterList.map(semester => {
      const bucket = buckets[semester.label] || { counts: {} };
      const row = { 'Semester': semester.label };
      let total = 0;
      sources.forEach(source => {
        const count = bucket.counts[source.label] || 0;
        row[source.label] = count;
        total += count;
      });
      row.Total = total;
      return row;
    });

    return {
      rows,
      chartData: {
        type: 'bar',
        stacked: true,
        labels: rows.map(row => row.Semester),
        datasets: sources.map(source => ({
          label: source.label,
          data: rows.map(row => row[source.label]),
          backgroundColor: source.color,
          borderRadius: 4,
        })),
      },
    };
  },

  'sector-engagement': async (db, from, to) => {
    // One engagement event per activity record, joined to company sector
    const sources = [
      ['OutreachEngagement o', 'o.InteractionDate', 'o.CompanyID'],
      ['Recruitment r',        'r.DatePosted',      'r.CompanyID'],
      ['CareerEvent e',        'e.EventDate',       'e.CompanyID'],
      ['AcademicClassroomEngagement a', 'a.SessionDate', 'a.CompanyID'],
      ['StudentLedEvent s',    's.ProposalDate',    's.CompanyID'],
      ['HiringFeedback h',     'h.DateReported',    'h.CompanyID'],
    ];
    const events = [];
    for (const [tbl, dateCol, idCol] of sources) {
      const dc = dateClause(dateCol, from, to);
      (await db.prepare(`SELECT ${dateCol} AS d, c.Sector AS sector FROM ${tbl} JOIN Company c ON ${idCol}=c.CompanyID WHERE 1=1${dc.sql}`)
        .all(...dc.params))
        .forEach(r => { const s = semesterOf(r.d); if (s) events.push({ sem: s, sector: r.sector || 'Unknown' }); });
    }

    const buckets = {}; // semLabel → {order, sectors:{}}
    events.forEach(ev => {
      const b = buckets[ev.sem.label] = buckets[ev.sem.label] || { order: ev.sem.order, sectors: {} };
      b.sectors[ev.sector] = (b.sectors[ev.sector] || 0) + 1;
    });
    const semesterList = await reportSemesterSeries(db, from, to);
    const semesters = Object.entries(buckets).sort((a, b) => a[1].order - b[1].order);
    const labels    = semesterList.map(sem => sem.label);
    const SECTORS   = ['Government', 'NGO', 'Private', 'Semi-government', 'Startup'];

    const rows = [];
    semesters.forEach(([sem, b]) => SECTORS.forEach(sec => {
      const n = b.sectors[sec] || 0;
      if (n) rows.push({ 'Semester': sem, 'Sector': sec, 'Engagements': n });
    }));

    const datasets = SECTORS.map((sec, i) => ({
      label: sec,
      data: labels.map(l => buckets[l]?.sectors?.[sec] || 0),
      borderColor: PALETTE[i], backgroundColor: PALETTE[i], fill: false, tension: 0.3,
    }));
    return { rows, chartData: { type: 'line', labels, datasets } };
  },

  'hiring-conversion': async (db, from, to) => {
    const dcR = dateClause('DatePosted', from, to);
    const dcH = dateClause('DateReported', from, to);
    const postings = (await db.prepare(`SELECT DatePosted AS d FROM Recruitment WHERE 1=1${dcR.sql}`).all(...dcR.params));
    const hires    = (await db.prepare(`SELECT DateReported AS d FROM HiringFeedback WHERE HiredStudentAlumni='Yes'${dcH.sql}`).all(...dcH.params));

    const buckets = {};
    const add = (list, key) => list.forEach(r => {
      const s = semesterOf(r.d); if (!s) return;
      const b = buckets[s.label] = buckets[s.label] || { order: s.order, posted: 0, hired: 0 };
      b[key]++;
    });
    add(postings, 'posted'); add(hires, 'hired');

    const semesterList = await reportSemesterSeries(db, from, to);
    const rows = semesterList.map(semester => {
      const bucket = buckets[semester.label] || { posted: 0, hired: 0 };
      return {
        'Semester': semester.label, 'Postings': bucket.posted, 'Hires': bucket.hired,
        'Conversion': bucket.posted ? Math.round(bucket.hired / bucket.posted * 100) + '%' : '0%',
      };
    });
    return { rows, chartData: {
      type: 'bar', labels: semesterList.map(sem => sem.label),
      datasets: [
        { label: 'Postings', data: rows.map(row => row.Postings), backgroundColor: '#4361ee', borderRadius: 4 },
        { label: 'Hires',    data: rows.map(row => row.Hires),    backgroundColor: '#2ec4b6', borderRadius: 4 },
      ],
    }};
  },

  'year-over-year-comparison': async (db, from, to, periodCtx) => {
    const countsByYear = {};
    const add = async (range, key) => {
      const rows = (await db.prepare(`
        SELECT d FROM (
          SELECT DatePosted AS d, 'recruitment' AS kind FROM Recruitment WHERE DatePosted >= ? AND DatePosted <= ?
          UNION ALL
          SELECT InteractionDate AS d, 'engagement' AS kind FROM OutreachEngagement WHERE InteractionDate >= ? AND InteractionDate <= ?
          UNION ALL
          SELECT EventDate AS d, 'engagement' AS kind FROM CareerEvent WHERE RegisteredStatus='Attended' AND EventDate >= ? AND EventDate <= ?
          UNION ALL
          SELECT SessionDate AS d, 'engagement' AS kind FROM AcademicClassroomEngagement WHERE SessionDate >= ? AND SessionDate <= ?
        ) WHERE kind = ?
      `).all(range.from, range.to, range.from, range.to, range.from, range.to, range.from, range.to, key));
      rows.forEach(row => {
        const academicYear = academicYearOf(row.d);
        if (!academicYear) return;
        const bucket = countsByYear[academicYear.label] = countsByYear[academicYear.label] || {
          order: academicYear.order,
          recruitment: 0,
          engagement: 0,
        };
        bucket[key]++;
      });
    };

    if (periodCtx?.mode === 'academic-year') {
      const current = academicYearFromKey(periodCtx.academicYear);
      const previous = previousComparisonPeriod(current);
      await add(previous, 'recruitment');
      await add(previous, 'engagement');
      await add(current, 'recruitment');
      await add(current, 'engagement');
    } else if (periodCtx?.mode === 'semester') {
      const current = academicYearForSemester(semesterFromKey(periodCtx.semester));
      const previous = previousComparisonPeriod(current);
      await add(previous, 'recruitment');
      await add(previous, 'engagement');
      await add(current, 'recruitment');
      await add(current, 'engagement');
    } else {
      await add({ from: from || '0000-01-01', to: to || '9999-12-31' }, 'recruitment');
      await add({ from: from || '0000-01-01', to: to || '9999-12-31' }, 'engagement');
    }

    const yearSeries = periodCtx?.mode === 'all'
      ? await reportAcademicYearSeries(db, from, to)
      : Object.entries(countsByYear)
          .sort((a, b) => a[1].order - b[1].order)
          .map(([label]) => academicYearRange(Number(label.slice(2, 6))))
          .filter(Boolean);

    const rows = yearSeries.map((year, index) => {
      const bucket = countsByYear[year.label] || { recruitment: 0, engagement: 0 };
      const previousBucket = index > 0
        ? (countsByYear[yearSeries[index - 1].label] || { recruitment: 0, engagement: 0 })
        : null;
      const diff = previousBucket
        ? (bucket.recruitment + bucket.engagement) - (previousBucket.recruitment + previousBucket.engagement)
        : 0;
      return {
        'Academic Year': year.label,
        'Engagement Volume': bucket.engagement,
        'Recruitment Volume': bucket.recruitment,
        'Total Volume': bucket.engagement + bucket.recruitment,
        'Change vs Previous AY': previousBucket ? (diff > 0 ? `▲ +${diff}` : diff < 0 ? `▼ ${diff}` : '—') : '—',
      };
    });

    return { rows, chartData: {
      type: 'bar',
      labels: rows.map(row => row['Academic Year']),
      datasets: [
        { label: 'Engagement', data: rows.map(row => row['Engagement Volume']), backgroundColor: '#2ec4b6', borderRadius: 4 },
        { label: 'Recruitment', data: rows.map(row => row['Recruitment Volume']), backgroundColor: '#4361ee', borderRadius: 4 },
      ],
    }};
  },

  'semester-comparison': async (db, from, to, periodCtx) => {
    const metrics = async (r) => ({
      'Companies Engaged': (await db.prepare(`
        SELECT COUNT(DISTINCT CompanyID) AS n FROM (
          SELECT CompanyID, InteractionDate AS d FROM OutreachEngagement
          UNION ALL SELECT CompanyID, DatePosted FROM Recruitment
          UNION ALL SELECT CompanyID, EventDate FROM CareerEvent
          UNION ALL SELECT CompanyID, SessionDate FROM AcademicClassroomEngagement
        ) WHERE d >= ? AND d <= ?`).get(r.from, r.to)).n,
      'New Companies Added':    (await db.prepare(`SELECT COUNT(*) AS n FROM Company WHERE DateAdded>=? AND DateAdded<=?`).get(r.from, r.to)).n,
      'Recruitment Postings':   (await db.prepare(`SELECT COUNT(*) AS n FROM Recruitment WHERE DatePosted>=? AND DatePosted<=?`).get(r.from, r.to)).n,
      'Career Events Attended': (await db.prepare(`SELECT COUNT(*) AS n FROM CareerEvent WHERE RegisteredStatus='Attended' AND EventDate>=? AND EventDate<=?`).get(r.from, r.to)).n,
      'Students Hired':         (await db.prepare(`SELECT COUNT(*) AS n FROM HiringFeedback WHERE HiredStudentAlumni='Yes' AND DateReported>=? AND DateReported<=?`).get(r.from, r.to)).n,
      'Academic Engagements':   (await db.prepare(`SELECT COUNT(*) AS n FROM AcademicClassroomEngagement WHERE SessionDate>=? AND SessionDate<=?`).get(r.from, r.to)).n,
      'Outreach Interactions':  (await db.prepare(`SELECT COUNT(*) AS n FROM OutreachEngagement WHERE InteractionDate>=? AND InteractionDate<=?`).get(r.from, r.to)).n,
    });

    if (periodCtx?.mode === 'all') {
      const series = periodCtx.viewMode === 'academic-year'
        ? await reportAcademicYearSeries(db, from, to)
        : await reportSemesterSeries(db, from, to);
      const rows = [];
      for (let index = 0; index < series.length; index += 1) {
        const period = series[index];
        const currentMetrics = await metrics(period);
        const previousMetrics = index > 0 ? await metrics(series[index - 1]) : null;
        const currentTotal = Object.values(currentMetrics).reduce((sum, value) => sum + value, 0);
        const previousTotal = previousMetrics ? Object.values(previousMetrics).reduce((sum, value) => sum + value, 0) : 0;
        const diff = currentTotal - previousTotal;
        rows.push({
          'Period': period.label,
          'Companies Engaged': currentMetrics['Companies Engaged'],
          'New Companies Added': currentMetrics['New Companies Added'],
          'Recruitment Postings': currentMetrics['Recruitment Postings'],
          'Career Events Attended': currentMetrics['Career Events Attended'],
          'Students Hired': currentMetrics['Students Hired'],
          'Academic Engagements': currentMetrics['Academic Engagements'],
          'Outreach Interactions': currentMetrics['Outreach Interactions'],
          'Total Activity': currentTotal,
          'Change vs Previous': previousMetrics ? (diff > 0 ? `▲ +${diff}` : diff < 0 ? `▼ ${diff}` : '—') : '—',
        });
      }
      return { rows, chartData: {
        type: 'bar',
        labels: rows.map(row => row.Period),
        datasets: [
          { label: 'Total Activity', data: rows.map(row => row['Total Activity']), backgroundColor: '#4361ee', borderRadius: 4 },
          { label: 'Students Hired', data: rows.map(row => row['Students Hired']), backgroundColor: '#2ec4b6', borderRadius: 4 },
        ],
      }};
    }

    const A = baseComparisonPeriod(periodCtx, from || todayIso());
    const B = previousComparisonPeriod(A);

    const a = await metrics(A), b = await metrics(B);
    const rows = Object.keys(a).map(k => {
      const diff = a[k] - b[k];
      return {
        'Metric': k, [A.label]: a[k], [B.label]: b[k],
        'Change': diff > 0 ? `▲ +${diff}` : diff < 0 ? `▼ ${diff}` : '—',
        'Trend': diff > 0 ? 'Improved' : diff < 0 ? 'Declined' : 'Unchanged',
      };
    });

    return { rows, chartData: {
      type: 'bar', labels: Object.keys(a),
      datasets: [
        { label: A.label, data: Object.values(a), backgroundColor: '#4361ee', borderRadius: 4 },
        { label: B.label, data: Object.values(b), backgroundColor: '#adb5bd', borderRadius: 4 },
      ],
    }};
  },
};

// ── Semester helpers (CMU-Q calendar) ──────────────────────────────────────────
// Fall: Aug 1 – Dec 31 | Spring: Jan 1 – May 31 | Summer: Jun 1 – Jul 31
// order = sortable integer; from/to = date range of that semester
function semesterOf(dateStr) {
  if (!dateStr) return null;
  const m = Number(String(dateStr).slice(5, 7));
  const y = Number(String(dateStr).slice(0, 4));
  if (!m || !y) return null;
  if (m >= 8) return semesterRange('fall', y);
  if (m <= 5) return semesterRange('spring', y);
  return semesterRange('summer', y);
}

function nextSemesterOf(sem) {
  const d = new Date(sem.to);
  d.setDate(d.getDate() + 1);
  return semesterOf(d.toISOString().slice(0, 10));
}

function prevSemesterOf(sem) {
  const d = new Date(sem.from);
  d.setDate(d.getDate() - 1);
  return semesterOf(d.toISOString().slice(0, 10));
}

// ── REPORT BUILDER SCHEMA ──────────────────────────────────────────────────────
const BUILDER_SCHEMA = {
  Companies: {
    table: 'Company', alias: 'c', idCol: 'CompanyID',
    joins: [],
    columns: {
      CompanyName: { label:'Company Name', type:'text', expr:'c.CompanyName' },
      Industry:    { label:'Industry', type:'text', expr:'c.Industry' },
      Sector:      { label:'Sector', type:'enum', expr:'c.Sector',
                     values:['Government','NGO','Private','Semi-government','Startup'] },
      Country:     { label:'Country', type:'text', expr:'c.Country' },
      DateAdded:   { label:'Date Added', type:'date', expr:'c.DateAdded' },
      Website:     { label:'Website', type:'text', expr:'c.Website' },
      SignedMoU:   { label:'Signed MoU', type:'boolean', expr:'c.SignedMoU' },
      FavoriteEmployer: { label:'Favorite Employer', type:'boolean', expr:'c.FavoriteEmployer' },
      Blacklisted: { label:'Blacklisted', type:'boolean', expr:'c.Blacklisted' },
      Comment:     { label:'Comment', type:'text', expr:'c.Comment' },
    }
  },
  Contacts: {
    table: 'Contact', alias: 'co', idCol: 'ContactID',
    joins: ['JOIN Company c ON co.CompanyID=c.CompanyID'],
    columns: {
      'c.CompanyName':     { label:'Company', type:'text', expr:'c.CompanyName' },
      'co.FirstName':      { label:'First Name', type:'text', expr:'co.FirstName' },
      'co.LastName':       { label:'Last Name', type:'text', expr:'co.LastName' },
      'co.EmailAddress':   { label:'Email', type:'text', expr:'co.EmailAddress' },
      'co.JobTitle':       { label:'Job Title', type:'text', expr:'co.JobTitle' },
      'co.WorkPhone':      { label:'Work Phone', type:'text', expr:'co.WorkPhone' },
      'co.Mobile':         { label:'Mobile', type:'text', expr:'co.Mobile' },
      'co.Country':        { label:'Country', type:'text', expr:'co.Country' },
      'co.Status':         { label:'Status', type:'enum', expr:'co.Status',
                             values:['Mailable','Non-mailable'] },
      'co.PrimaryContact': { label:'Primary Contact', type:'boolean', expr:'co.PrimaryContact' },
      'co.CMUQGraduate':   { label:'CMU-Q Graduate', type:'boolean', expr:'co.CMUQGraduate' },
      'co.Major':          { label:'Major', type:'enum', expr:'co.Major',
                             values:['Computer Science','Information Systems','Biological Sciences','Business Administration','Artificial Intelligence','Computational Biology'] },
      'co.GraduationYear': { label:'Graduation Year', type:'number', expr:'co.GraduationYear' },
      'co.ResumeBook':     { label:'Resume Book', type:'boolean', expr:'co.ResumeBook' },
      'co.EventInvitation':{ label:'Event Invitation', type:'boolean', expr:'co.EventInvitation' },
      'co.ExcludeFromMailing':{ label:'Exclude from Mailing', type:'boolean', expr:'co.ExcludeFromMailing' },
      'co.DateAdded':      { label:'Date Added', type:'date', expr:'co.DateAdded' },
    }
  },
  'Outreach & Engagement': {
    table: 'OutreachEngagement', alias: 'o', idCol: 'OutreachEngagementID',
    joins: ['JOIN Company c ON o.CompanyID=c.CompanyID','JOIN Contact co ON o.ContactID=co.ContactID'],
    columns: {
      'c.CompanyName':     { label:'Company', type:'text', expr:'c.CompanyName' },
      'co.FirstName':      { label:'Contact First Name', type:'text', expr:'co.FirstName' },
      'co.LastName':       { label:'Contact Last Name', type:'text', expr:'co.LastName' },
      'o.InteractionType': { label:'Type', type:'enum', expr:'o.InteractionType',
                             values:['Call','Meeting','Company Visit'] },
      'o.InteractionDate': { label:'Date', type:'date', expr:'o.InteractionDate' },
      'o.InteractionStatus':{ label:'Status', type:'enum', expr:'o.InteractionStatus',
                              values:['Complete','In-progress'] },
      'o.FollowUpDate':    { label:'Follow-Up Date', type:'date', expr:'o.FollowUpDate' },
      'o.DiscussionItems': { label:'Discussion Items', type:'text', expr:'o.DiscussionItems' },
      'o.ActionPlan':      { label:'Action Plan', type:'text', expr:'o.ActionPlan' },
    }
  },
  Recruitment: {
    table: 'Recruitment', alias: 'r', idCol: 'RecruitmentID',
    joins: ['JOIN Company c ON r.CompanyID=c.CompanyID','JOIN Contact co ON r.ContactID=co.ContactID'],
    columns: {
      'c.CompanyName':     { label:'Company', type:'text', expr:'c.CompanyName' },
      'co.FirstName':      { label:'Contact First Name', type:'text', expr:'co.FirstName' },
      'co.LastName':       { label:'Contact Last Name', type:'text', expr:'co.LastName' },
      'r.OpportunityTitle':{ label:'Title', type:'text', expr:'r.OpportunityTitle' },
      'r.DatePosted':      { label:'Date Posted', type:'date', expr:'r.DatePosted' },
      'r.Mode':            { label:'Mode', type:'enum', expr:'r.Mode',
                             values:['Onsite','Hybrid','Remote'] },
      'r.Status':          { label:'Status (Paid)', type:'enum', expr:'r.Status',
                             values:['Paid','Unpaid'] },
      'r.TargetGroup':     { label:'Target Group', type:'enum', expr:'r.TargetGroup',
                             values:['Qatari only','Open to all'] },
      'r.HiredStudentAlumni': { label:'Hired?', type:'enum', expr:'r.HiredStudentAlumni',
                                values:['Yes','No','Not Reported'] },
      'r.Country':         { label:'Country', type:'text', expr:'r.Country' },
      'r.ArabicSpeaker':   { label:'Arabic Speaker', type:'boolean', expr:'r.ArabicSpeaker' },
    }
  },
  'Career Events': {
    table: 'CareerEvent', alias: 'e', idCol: 'CareerEventID',
    joins: ['JOIN Company c ON e.CompanyID=c.CompanyID','JOIN Contact co ON e.ContactID=co.ContactID'],
    columns: {
      'c.CompanyName':   { label:'Company', type:'text', expr:'c.CompanyName' },
      'co.FirstName':    { label:'Contact First Name', type:'text', expr:'co.FirstName' },
      'co.LastName':     { label:'Contact Last Name', type:'text', expr:'co.LastName' },
      'e.EventName':     { label:'Event Name', type:'text', expr:'e.EventName' },
      'e.EventDate':     { label:'Event Date', type:'date', expr:'e.EventDate' },
      'e.RegisteredStatus': { label:'Status', type:'enum', expr:'e.RegisteredStatus',
                              values:['Attended','No-Show','Cancelled'] },
      'e.CMUQAlumniAtBooth': { label:'Alumni at Booth', type:'boolean', expr:'e.CMUQAlumniAtBooth' },
      'e.Comment':       { label:'Comment', type:'text', expr:'e.Comment' },
    }
  },
  'Student-Led Events': {
    table: 'StudentLedEvent', alias: 's', idCol: 'StudentLedEventID',
    joins: ['JOIN Company c ON s.CompanyID=c.CompanyID'],
    columns: {
      'c.CompanyName':   { label:'Company', type:'text', expr:'c.CompanyName' },
      's.OrganizationName': { label:'Organization', type:'text', expr:'s.OrganizationName' },
      's.StudentName':   { label:'Student Name', type:'text', expr:'s.StudentName' },
      's.StudentEmail':  { label:'Student Email', type:'text', expr:'s.StudentEmail' },
      's.ProposalDate':  { label:'Proposal Date', type:'date', expr:'s.ProposalDate' },
      's.EventDate':     { label:'Event Date', type:'date', expr:'s.EventDate' },
      's.EventTitle':    { label:'Event Title', type:'text', expr:'s.EventTitle' },
      's.CollaborationOutcome': { label:'Outcome', type:'enum', expr:'s.CollaborationOutcome',
                                  values:['Completed','Pending'] },
    }
  },
  'Academic Engagement': {
    table: 'AcademicClassroomEngagement', alias: 'a', idCol: 'EngagementID',
    joins: ['JOIN Company c ON a.CompanyID=c.CompanyID'],
    columns: {
      'c.CompanyName':     { label:'Company', type:'text', expr:'c.CompanyName' },
      'a.EngagementType':  { label:'Type', type:'enum', expr:'a.EngagementType',
                             values:['Guest Lecture','Panel Discussion','Community Project Partnership','Mock Interviews','Research Collaboration','Competition/Hackathon Sponsorship','Other'] },
      'a.GuestSpeakerName':{ label:'Guest Speaker', type:'text', expr:'a.GuestSpeakerName' },
      'a.GuestTitle':      { label:'Guest Title', type:'text', expr:'a.GuestTitle' },
      'a.FacultyName':     { label:'Faculty Name', type:'text', expr:'a.FacultyName' },
      'a.CourseNumber':    { label:'Course Number', type:'text', expr:'a.CourseNumber' },
      'a.CourseTitle':     { label:'Course Title', type:'text', expr:'a.CourseTitle' },
      'a.TopicTheme':      { label:'Topic/Theme', type:'text', expr:'a.TopicTheme' },
      'a.SessionDate':     { label:'Session Date', type:'date', expr:'a.SessionDate' },
      'a.SessionTime':     { label:'Session Time', type:'text', expr:'a.SessionTime' },
    }
  },
  'Hiring Feedback': {
    table: 'HiringFeedback', alias: 'h', idCol: 'HiringFeedbackID',
    joins: ['JOIN Company c ON h.CompanyID=c.CompanyID','JOIN Contact co ON h.ContactID=co.ContactID'],
    columns: {
      'c.CompanyName':     { label:'Company', type:'text', expr:'c.CompanyName' },
      'co.FirstName':      { label:'Contact First Name', type:'text', expr:'co.FirstName' },
      'co.LastName':       { label:'Contact Last Name', type:'text', expr:'co.LastName' },
      'h.FeedbackProvider':{ label:'Provider', type:'enum', expr:'h.FeedbackProvider',
                             values:['Company','Student/Alumni','Other'] },
      'h.HiredStudentAlumni': { label:'Hired?', type:'enum', expr:'h.HiredStudentAlumni',
                                values:['Yes','No'] },
      'h.DateReported':    { label:'Date Reported', type:'date', expr:'h.DateReported' },
      'h.HiredStudentName':{ label:'Student Name', type:'text', expr:'h.HiredStudentName' },
      'h.Comment':         { label:'Comment', type:'text', expr:'h.Comment' },
    }
  },
  'Potential Collaboration': {
    table: 'PotentialCollaboration', alias: 'p', idCol: 'PotentialCollaborationID',
    joins: ['JOIN Company c ON p.CompanyID=c.CompanyID'],
    columns: {
      'c.CompanyName': { label:'Company', type:'text', expr:'c.CompanyName' },
      'p.Comment':     { label:'Comment', type:'text', expr:'p.Comment' },
      'p.CreatedAt':   { label:'Created At', type:'date', expr:'p.CreatedAt' },
    }
  },
};

// ── Builder: build WHERE clause from filter array ──────────────────────────────
function buildFilters(filters, schema) {
  const parts = [], params = [];
  for (const f of (filters || [])) {
    const colDef = schema.columns[f.field];
    if (!colDef) continue;
    const expr = colDef.expr;
    switch (f.condition) {
      case 'contains':      parts.push(`${expr} LIKE ?`);  params.push(`%${f.value}%`);  break;
      case 'equals':        parts.push(`${expr} = ?`);     params.push(f.value);         break;
      case 'not_equals':    parts.push(`${expr} != ?`);    params.push(f.value);         break;
      case 'starts_with':   parts.push(`${expr} LIKE ?`);  params.push(`${f.value}%`);   break;
      case 'is_empty':      parts.push(`(${expr} IS NULL OR ${expr}='')`);                break;
      case 'is_not_empty':  parts.push(`(${expr} IS NOT NULL AND ${expr}!='')`);          break;
      case 'is_before':     parts.push(`${expr} < ?`);     params.push(f.value);         break;
      case 'is_after':      parts.push(`${expr} > ?`);     params.push(f.value);         break;
      case 'is_between':    parts.push(`${expr} BETWEEN ? AND ?`); params.push(f.value, f.value2); break;
      case 'in_last_days':  parts.push(`${expr} >= date('now',?)`); params.push(`-${parseInt(f.value)||7} days`); break;
      case 'is_true':       parts.push(`${expr} = 1`);                                   break;
      case 'is_false':      parts.push(`(${expr} = 0 OR ${expr} IS NULL)`);              break;
      case 'gt':            parts.push(`${expr} > ?`);     params.push(f.value);         break;
      case 'lt':            parts.push(`${expr} < ?`);     params.push(f.value);         break;
      case 'is':            parts.push(`${expr} = ?`);     params.push(f.value);         break;
      case 'is_not':        parts.push(`${expr} != ?`);    params.push(f.value);         break;
    }
  }
  return { sql: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
}

// ── Aggregate chart data from rows ─────────────────────────────────────────────
function buildChartData(rows, groupByExpr, chartType) {
  if (!groupByExpr || !rows.length) return null;
  // Find matching key in rows
  const keys = Object.keys(rows[0]);
  const key  = keys.find(k => k === groupByExpr) || keys[0];
  const agg  = {};
  rows.forEach(r => {
    const v = r[key] != null ? String(r[key]) : 'None';
    agg[v] = (agg[v] || 0) + 1;
  });
  const sorted = Object.entries(agg).sort((a,b)=>b[1]-a[1]).slice(0,20);
  return {
    type: chartType || 'bar',
    labels: sorted.map(x=>x[0]),
    datasets: [{ label: key, data: sorted.map(x=>x[1]),
                 backgroundColor: sorted.map((_,i)=>PALETTE[i%PALETTE.length]),
                 borderRadius: 4 }]
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /api/reports/schema — entity schema for builder
router.get('/schema', async (req, res) => {
  const schema = {};
  for (const [entity, def] of Object.entries(BUILDER_SCHEMA)) {
    schema[entity] = Object.entries(def.columns).map(([key, col]) => ({
      key, label: col.label, type: col.type, values: col.values || null
    }));
  }
  res.json(schema);
});

// GET /api/reports/periods
router.get('/periods', async (req, res) => {
  try {
    res.json(await buildReportPeriods(req.app.locals.db));
  } catch (err) {
    req.app.locals.respondServerError(req, res, err);
  }
});

// GET /api/reports/quick/:type
router.get('/quick/:type', async (req, res) => {
  const db   = req.app.locals.db;
  const type = req.params.type;
  const fn = QUICK_REPORTS[type];
  if (!fn) return res.status(404).json({ error: `Unknown report type: ${type}` });
  try {
    const period = resolveQuickReportPeriod(req.query);
    const doExport = req.query.export === '1' ? '1' : null;
    const result = await fn(db, period.from, period.to, period);
    const rows = formatRowsForOutput(result.rows);
    const meta = {
      periodMode: period.mode,
      periodLabel: result.meta?.periodLabel || period.label,
      from: period.from,
      to: period.to,
      ...(result.meta || {}),
    };
    if (doExport === '1') {
      return await exportXLSX(res, rows, `report-${type}`);
    }
    res.json({ rows, count: rows.length, chartData: result.chartData, meta });
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

// POST /api/reports/builder
router.post('/builder', async (req, res) => {
  const db = req.app.locals.db;
  const { entity, columns: selCols, filters, sortBy, sortOrder, chartType, chartGroupBy, from, to } = req.body;

  const schema = BUILDER_SCHEMA[entity];
  if (!schema) return res.status(400).json({ error: 'Unknown entity' });

  try {
    const safeFrom = optionalIsoDate(from, 'from');
    const safeTo = optionalIsoDate(to, 'to');
    const exportMode = req.query.export === 'csv' ? 'csv' : req.query.export === '1' ? '1' : null;
    const allCols = schema.columns;
    const requestedCols = optionalStringArray(selCols, 'columns', { maxItems: 100, maxItemLength: 100 });

    const validCols = requestedCols.length
      ? requestedCols.filter(k => allCols[k])
      : Object.keys(allCols);

    if (!validCols.length) return res.status(400).json({ error: 'No valid columns selected' });

    const validSort = sortBy && allCols[sortBy]
      ? allCols[sortBy].expr
      : allCols[validCols[0]].expr;
    const order = (sortOrder || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const filterClause = buildFilters(filters, schema);

    let dateSql = '', dateParams = [];
    const dateCols = Object.values(allCols).filter(c=>c.type==='date');
    if (dateCols.length && (safeFrom || safeTo)) {
      const dc = dateClause(dateCols[0].expr, safeFrom, safeTo);
      dateSql = dc.sql; dateParams = dc.params;
    }

    const selectExprs = validCols.map(k => {
      const col = allCols[k];
      const label = col.label.replace(/[^a-zA-Z0-9 ]/g,'');
      return `${col.expr} AS "${label}"`;
    });

    const sql = `
      SELECT ${selectExprs.join(', ')}
      FROM ${schema.table} ${schema.alias}
      ${schema.joins.join(' ')}
      WHERE 1=1${filterClause.sql}${dateSql}
      ORDER BY ${validSort} ${order}
      LIMIT 5000
    `;

    const rows = (await db.prepare(sql).all(...filterClause.params, ...dateParams));

    // Build chart data
    let chartData = null;
    if (chartType && chartType !== 'none' && chartGroupBy) {
      // chartGroupBy is a column key; find its label
      const groupColDef = allCols[chartGroupBy];
      if (groupColDef) {
        const labelKey = groupColDef.label.replace(/[^a-zA-Z0-9 ]/g,'');
        chartData = buildChartData(rows, labelKey, chartType);
      }
    }

    const outputRows = formatRowsForOutput(rows);
    if (exportMode === '1') return await exportXLSX(res, outputRows, 'custom-report');
    if (exportMode === 'csv') return exportCSV(res, outputRows, 'custom-report');
    res.json({ rows: outputRows, count: outputRows.length, chartData });
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

// GET /api/reports/saved
router.get('/saved', async (req, res) => {
  const db = req.app.locals.db;
  try {
    res.json((await db.prepare('SELECT * FROM SavedReports ORDER BY CreatedAt DESC').all()));
  } catch (err) { req.app.locals.respondServerError(req, res, err); }
});

// POST /api/reports/saved
router.post('/saved', requireAdminSession, async (req, res) => {
  const db = req.app.locals.db;
  try {
    const ReportName = requireTrimmedString(req.body.ReportName, 'ReportName', 120);
    const Entity = requireTrimmedString(req.body.Entity, 'Entity', 120);
    const Columns = optionalStringArray(req.body.Columns, 'Columns', { maxItems: 100, maxItemLength: 100 });
    const Filters = Array.isArray(req.body.Filters) ? req.body.Filters.slice(0, 50) : [];
    const SortBy = optionalTrimmedString(req.body.SortBy, 'SortBy', 100);
    const SortOrder = optionalTrimmedString(req.body.SortOrder, 'SortOrder', 4) || 'ASC';
    const ChartType = optionalTrimmedString(req.body.ChartType, 'ChartType', 50);
    const ChartGroupBy = optionalTrimmedString(req.body.ChartGroupBy, 'ChartGroupBy', 100);
    const info = (await db.prepare(
      'INSERT INTO SavedReports (ReportName,Entity,Columns,Filters,SortBy,SortOrder,ChartType,ChartGroupBy) VALUES (?,?,?,?,?,?,?,?)'
    ).run(ReportName, Entity,
          JSON.stringify(Columns||[]), JSON.stringify(Filters||[]),
          SortBy||null, SortOrder||'ASC', ChartType||null, ChartGroupBy||null));
    res.status(201).json((await db.prepare('SELECT * FROM SavedReports WHERE ReportID=?').get(info.lastInsertRowid)));
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

// DELETE /api/reports/saved/:id
router.delete('/saved/:id', requireAdminSession, async (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = (await db.prepare('DELETE FROM SavedReports WHERE ReportID=?').run(requirePositiveInt(req.params.id, 'Report ID')));
    if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    if (err.statusCode) return sendValidationError(res, err);
    req.app.locals.respondServerError(req, res, err);
  }
});

// ── Export helpers ─────────────────────────────────────────────────────────────
async function exportXLSX(res, rows, name) {
  const buf = await workbookBufferFromJson('Report', rows);
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${Date.now()}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}

function exportCSV(res, rows, name) {
  if (!rows.length) { res.type('text/csv').send(''); return; }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => {
    const v = r[h] == null ? '' : String(r[h]);
    return v.includes(',') || v.includes('"') || v.includes('\n')
      ? '"' + v.replace(/"/g,'""') + '"' : v;
  }).join(',')));
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${Date.now()}.csv"`);
  res.type('text/csv').send(lines.join('\r\n'));
}

module.exports = router;
