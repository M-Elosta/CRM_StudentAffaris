const express = require('express');
const router  = express.Router();
const XLSX    = require('xlsx');

// ── Chart colour palette (consistent with dashboard) ───────────────────────────
const PALETTE = ['#4361ee','#f72585','#4cc9f0','#2ec4b6','#ff9f1c','#e71d36',
                 '#3a0ca3','#7209b7','#06d6a0','#118ab2','#ffd166','#ef476f'];

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

// ────────────────────────────────────────────────────────────────────────────
// QUICK REPORT DEFINITIONS
// Each fn(db, from, to) returns { rows, chartData: { type, labels, datasets } }
// ────────────────────────────────────────────────────────────────────────────
const QUICK_REPORTS = {

  // ── Contact Lists ──────────────────────────────────────────────────────────

  'mailable-contacts': (db, from, to) => {
    const dc = dateClause('co.DateAdded', from, to);
    const rows = db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
             co.EmailAddress AS "Email", co.JobTitle AS "Job Title",
             COALESCE(co.WorkPhone, co.Mobile) AS "Phone", co.Country
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.Status='Mailable' AND co.ExcludeFromMailing=0 AND c.Blacklisted=0${dc.sql}
      ORDER BY c.CompanyName, co.LastName`).all(...dc.params);
    const agg = {};
    rows.forEach(r => { agg[r.Company] = (agg[r.Company] || 0) + 1; });
    const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]);
    return { rows, chartData: {
      type: 'pie', labels: sorted.map(x=>x[0]),
      datasets: [{ data: sorted.map(x=>x[1]), backgroundColor: PALETTE }]
    }};
  },

  'event-invitation': (db, from, to) => {
    const dc = dateClause('co.DateAdded', from, to);
    const rows = db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
             co.EmailAddress AS "Email", co.JobTitle AS "Job Title",
             COALESCE(co.WorkPhone, co.Mobile) AS "Phone", co.Country
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.EventInvitation=1 AND co.Status='Mailable' AND co.ExcludeFromMailing=0${dc.sql}
      ORDER BY c.CompanyName, co.LastName`).all(...dc.params);
    const agg = {};
    rows.forEach(r => { agg[r.Company] = (agg[r.Company] || 0) + 1; });
    const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]).slice(0, 20);
    return { rows, chartData: {
      type: 'bar', labels: sorted.map(x=>x[0]),
      datasets: [{ label: 'Contacts', data: sorted.map(x=>x[1]),
                   backgroundColor: '#4361ee', borderRadius: 4 }]
    }};
  },

  'resume-book': (db, from, to) => {
    const dc = dateClause('co.DateAdded', from, to);
    const rows = db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
             co.EmailAddress AS "Email", co.JobTitle AS "Job Title",
             COALESCE(co.WorkPhone, co.Mobile) AS "Phone", co.Country,
             co.Major AS "Major", co.GraduationYear AS "Grad Year"
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.ResumeBook=1 AND co.Status='Mailable' AND co.ExcludeFromMailing=0${dc.sql}
      ORDER BY co.Major, co.LastName`).all(...dc.params);
    const agg = {};
    rows.forEach(r => { const k = r.Major || 'Not Set'; agg[k] = (agg[k] || 0) + 1; });
    const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]);
    return { rows, chartData: {
      type: 'bar', labels: sorted.map(x=>x[0]),
      datasets: [{ label: 'Contacts', data: sorted.map(x=>x[1]),
                   backgroundColor: '#2ec4b6', borderRadius: 4 }]
    }};
  },

  'non-mailable': (db, from, to) => {
    const dc = dateClause('co.DateAdded', from, to);
    const rows = db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
             co.EmailAddress AS "Email",
             CASE WHEN c.Blacklisted=1 THEN 'Blacklisted Company' ELSE 'Manually Set' END AS "Reason"
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.Status='Non-mailable'${dc.sql}
      ORDER BY co.LastName`).all(...dc.params);
    const bl = rows.filter(r => r.Reason === 'Blacklisted Company').length;
    const mn = rows.length - bl;
    return { rows, chartData: {
      type: 'pie', labels: ['Blacklisted Company', 'Manually Set'],
      datasets: [{ data: [bl, mn], backgroundColor: ['#e71d36','#adb5bd'] }]
    }};
  },

  'primary-contacts': (db, from, to) => {
    const dc = dateClause('co.DateAdded', from, to);
    const rows = db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
             co.EmailAddress AS "Email", co.JobTitle AS "Job Title",
             COALESCE(co.WorkPhone, co.Mobile) AS "Phone"
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.PrimaryContact=1 AND co.Status='Mailable'${dc.sql}
      ORDER BY c.CompanyName, co.LastName`).all(...dc.params);
    const agg = {};
    rows.forEach(r => { agg[r.Company] = (agg[r.Company] || 0) + 1; });
    const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]).slice(0, 20);
    return { rows, chartData: {
      type: 'bar', labels: sorted.map(x=>x[0]),
      datasets: [{ label: 'Primary Contacts', data: sorted.map(x=>x[1]),
                   backgroundColor: '#f72585', borderRadius: 4 }]
    }};
  },

  'alumni-contacts': (db, from, to) => {
    const dc = dateClause('co.DateAdded', from, to);
    const rows = db.prepare(`
      SELECT co.FirstName||' '||co.LastName AS "Name", c.CompanyName AS "Company",
             co.Major AS "Major", co.GraduationYear AS "Grad Year",
             co.EmailAddress AS "Email", co.JobTitle AS "Job Title"
      FROM Contact co JOIN Company c ON co.CompanyID=c.CompanyID
      WHERE co.CMUQGraduate=1${dc.sql}
      ORDER BY co.GraduationYear DESC, co.LastName`).all(...dc.params);
    const agg = {};
    rows.forEach(r => { const k = r.Major || 'Not Set'; agg[k] = (agg[k] || 0) + 1; });
    const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]);
    return { rows, chartData: {
      type: 'bar', labels: sorted.map(x=>x[0]),
      datasets: [{ label: 'Alumni', data: sorted.map(x=>x[1]),
                   backgroundColor: '#7209b7', borderRadius: 4 }]
    }};
  },

  // ── Company Reports ────────────────────────────────────────────────────────

  'all-companies': (db, from, to) => {
    const dc = dateClause('DateAdded', from, to);
    const rows = db.prepare(`
      SELECT CompanyName AS "Name", Industry, Sector, Country,
             date(DateAdded) AS "Date Added", Website,
             CASE WHEN SignedMoU=1 THEN 'Yes' ELSE 'No' END AS "Signed MoU",
             CASE WHEN FavoriteEmployer=1 THEN 'Yes' ELSE 'No' END AS "Favorite"
      FROM Company WHERE Blacklisted=0${dc.sql}
      ORDER BY CompanyName`).all(...dc.params);
    const agg = {};
    rows.forEach(r => { agg[r.Sector] = (agg[r.Sector] || 0) + 1; });
    const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]);
    return { rows, chartData: {
      type: 'pie', labels: sorted.map(x=>x[0]),
      datasets: [{ data: sorted.map(x=>x[1]), backgroundColor: PALETTE }]
    }};
  },

  'blacklisted-companies': (db, from, to) => {
    const rows = db.prepare(`
      SELECT CompanyName AS "Name", Industry, Country, Comment
      FROM Company WHERE Blacklisted=1
      ORDER BY CompanyName`).all();
    const agg = {};
    rows.forEach(r => { agg[r.Industry || 'Unknown'] = (agg[r.Industry || 'Unknown'] || 0) + 1; });
    const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]);
    return { rows, chartData: {
      type: 'bar', labels: sorted.map(x=>x[0]),
      datasets: [{ label: 'Blacklisted', data: sorted.map(x=>x[1]),
                   backgroundColor: '#e71d36', borderRadius: 4 }]
    }};
  },

  'companies-by-country': (db, from, to) => {
    const dc = dateClause('DateAdded', from, to);
    const rows = db.prepare(`
      SELECT c.Country, COUNT(DISTINCT c.CompanyID) AS "Company Count",
             COUNT(DISTINCT co.ContactID) AS "Contact Count"
      FROM Company c LEFT JOIN Contact co ON c.CompanyID=co.CompanyID
      WHERE c.Blacklisted=0${dc.sql}
      GROUP BY c.Country ORDER BY "Company Count" DESC`).all(...dc.params);
    return { rows, chartData: {
      type: 'bar', indexAxis: 'y', labels: rows.map(r=>r.Country),
      datasets: [{ label: 'Companies', data: rows.map(r=>r['Company Count']),
                   backgroundColor: '#4361ee', borderRadius: 4 }]
    }};
  },

  'companies-by-sector': (db, from, to) => {
    const dc = dateClause('DateAdded', from, to);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM Company WHERE Blacklisted=0${dc.sql}`).get(...dc.params).n;
    const rows = db.prepare(`
      SELECT Sector, COUNT(*) AS "Company Count",
             ROUND(COUNT(*)*100.0/?, 1) AS "Percentage"
      FROM Company WHERE Blacklisted=0${dc.sql}
      GROUP BY Sector ORDER BY "Company Count" DESC`).all(total, ...dc.params);
    return { rows, chartData: {
      type: 'doughnut', labels: rows.map(r=>r.Sector),
      datasets: [{ data: rows.map(r=>r['Company Count']), backgroundColor: PALETTE }]
    }};
  },

  'favorite-employers': (db, from, to) => {
    const dc = dateClause('c.DateAdded', from, to);
    const rows = db.prepare(`
      SELECT c.CompanyName AS "Name", c.Industry, c.Sector, c.Country,
             COUNT(co.ContactID) AS "Contact Count"
      FROM Company c LEFT JOIN Contact co ON c.CompanyID=co.CompanyID
      WHERE c.FavoriteEmployer=1${dc.sql}
      GROUP BY c.CompanyID ORDER BY "Contact Count" DESC`).all(...dc.params);
    const bySector = {};
    rows.forEach(r => { bySector[r.Sector] = (bySector[r.Sector] || 0) + 1; });
    const sorted = Object.entries(bySector).sort((a,b)=>b[1]-a[1]);
    return { rows, chartData: {
      type: 'bar', labels: sorted.map(x=>x[0]),
      datasets: [{ label: 'Favorites', data: sorted.map(x=>x[1]),
                   backgroundColor: '#ff9f1c', borderRadius: 4 }]
    }};
  },

  'new-companies': (db, from, to) => {
    const dc = dateClause('DateAdded', from, to);
    const rows = db.prepare(`
      SELECT CompanyName AS "Name", Industry, Sector, Country, date(DateAdded) AS "Date Added"
      FROM Company WHERE 1=1${dc.sql}
      ORDER BY DateAdded DESC`).all(...dc.params);
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

  'mou-partners': (db, from, to) => {
    const rows = db.prepare(`
      SELECT c.CompanyName AS "Name", c.Industry, c.Sector, c.Country,
             COUNT(co.ContactID) AS "Contact Count"
      FROM Company c LEFT JOIN Contact co ON c.CompanyID=co.CompanyID
      WHERE c.SignedMoU=1
      GROUP BY c.CompanyID ORDER BY c.CompanyName`).all();
    const bySector = {};
    rows.forEach(r => { bySector[r.Sector] = (bySector[r.Sector] || 0) + 1; });
    const sorted = Object.entries(bySector).sort((a,b)=>b[1]-a[1]);
    return { rows, chartData: {
      type: 'pie', labels: sorted.map(x=>x[0]),
      datasets: [{ data: sorted.map(x=>x[1]), backgroundColor: PALETTE }]
    }};
  },

  // ── Engagement & Activity ──────────────────────────────────────────────────

  'followup-actions': (db, from, to) => {
    const today = new Date().toISOString().slice(0,10);
    const weekEnd = new Date(Date.now() + 7*86400000).toISOString().slice(0,10);
    const rows = db.prepare(`
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
      ORDER BY o.FollowUpDate ASC`).all();
    const counts = { overdue:0, 'this-week':0, upcoming:0 };
    rows.forEach(r => { counts[r._urgency] = (counts[r._urgency]||0)+1; });
    return { rows, chartData: {
      type: 'bar', labels: ['Overdue','Due This Week','Upcoming'],
      datasets: [{ label: 'Follow-ups', data: [counts.overdue, counts['this-week'], counts.upcoming],
                   backgroundColor: ['#e71d36','#ff9f1c','#4361ee'], borderRadius: 4 }]
    }};
  },

  'engagement-summary': (db, from, to) => {
    const makeFilter = (col) => {
      const dc = dateClause(col, from, to);
      return { f: dc.sql, p: dc.params };
    };
    const o = makeFilter('InteractionDate'), r2 = makeFilter('DatePosted'),
          ce = makeFilter('EventDate'),       ac = makeFilter('SessionDate'),
          se = makeFilter('ProposalDate'),    hf = makeFilter('DateReported');
    const rows = db.prepare(`
      SELECT c.CompanyName AS "Company",
        (SELECT COUNT(*) FROM OutreachEngagement WHERE CompanyID=c.CompanyID${o.f}) AS "Outreach",
        (SELECT COUNT(*) FROM Recruitment WHERE CompanyID=c.CompanyID${r2.f}) AS "Recruitment",
        (SELECT COUNT(*) FROM CareerEvent WHERE CompanyID=c.CompanyID${ce.f}) AS "Career Events",
        (SELECT COUNT(*) FROM AcademicClassroomEngagement WHERE CompanyID=c.CompanyID${ac.f}) AS "Academic",
        (SELECT COUNT(*) FROM StudentLedEvent WHERE CompanyID=c.CompanyID${se.f}) AS "Student Events",
        (SELECT COUNT(*) FROM HiringFeedback WHERE CompanyID=c.CompanyID${hf.f}) AS "Hiring Feedback"
      FROM Company c WHERE c.Blacklisted=0
      ORDER BY c.CompanyName`
    ).all(...o.p,...r2.p,...ce.p,...ac.p,...se.p,...hf.p).map(r => ({
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

  'inactive-companies': (db, from, to) => {
    const makeFilter = (col) => {
      const dc = dateClause(col, from, to);
      return { f: dc.sql, p: dc.params };
    };
    const o = makeFilter('InteractionDate'), r2 = makeFilter('DatePosted'),
          ce = makeFilter('EventDate'),       ac = makeFilter('SessionDate'),
          se = makeFilter('ProposalDate'),    hf = makeFilter('DateReported');
    const rows = db.prepare(`
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
    ).all(...o.p,...r2.p,...ce.p,...ac.p,...se.p,...hf.p);
    const bySector = {};
    rows.forEach(r => { bySector[r.Sector||'Unknown']=(bySector[r.Sector||'Unknown']||0)+1; });
    const sorted = Object.entries(bySector).sort((a,b)=>b[1]-a[1]);
    return { rows, chartData: {
      type: 'pie', labels: sorted.map(x=>x[0]),
      datasets: [{ data: sorted.map(x=>x[1]), backgroundColor: PALETTE }]
    }};
  },

  'monthly-activity': (db, from, to) => {
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
      const agg = db.prepare(
        `SELECT strftime('%Y-%m', ${mod.dateCol}) AS m, COUNT(*) AS n FROM ${mod.table} WHERE ${mod.dateCol} IS NOT NULL${dc.sql} GROUP BY m ORDER BY m`
      ).all(...dc.params);
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

  'recruitment-postings': (db, from, to) => {
    const dc = dateClause('r.DatePosted', from, to);
    const rows = db.prepare(`
      SELECT c.CompanyName AS "Company", r.OpportunityTitle AS "Title",
             date(r.DatePosted) AS "Date", r.Mode, r.Status AS "Paid/Unpaid",
             r.TargetGroup AS "Target Group", r.HiredStudentAlumni AS "Hired",
             r.Country, r.Comment
      FROM Recruitment r JOIN Company c ON r.CompanyID=c.CompanyID
      WHERE 1=1${dc.sql} ORDER BY r.DatePosted DESC`).all(...dc.params);
    const byMode = {};
    rows.forEach(r => { byMode[r.Mode] = (byMode[r.Mode]||0)+1; });
    return { rows, chartData: {
      type: 'bar', labels: Object.keys(byMode),
      datasets: [{ label: 'Postings', data: Object.values(byMode),
                   backgroundColor: ['#4361ee','#f72585','#4cc9f0'], borderRadius: 4 }]
    }};
  },

  'recruitment-by-major': (db, from, to) => {
    const dc = dateClause('r.DatePosted', from, to);
    const rows = db.prepare(`
      SELECT tm.Major,
             COUNT(*) AS "Posting Count",
             SUM(CASE WHEN r.Status='Paid' THEN 1 ELSE 0 END) AS "Paid Count",
             SUM(CASE WHEN r.Status='Unpaid' THEN 1 ELSE 0 END) AS "Unpaid Count"
      FROM Recruitment_TargetMajors tm JOIN Recruitment r ON tm.RecruitmentID=r.RecruitmentID
      WHERE 1=1${dc.sql}
      GROUP BY tm.Major ORDER BY "Posting Count" DESC`).all(...dc.params);
    return { rows, chartData: {
      type: 'bar', labels: rows.map(r=>r.Major),
      datasets: [
        { label: 'Paid', data: rows.map(r=>r['Paid Count']), backgroundColor: '#2ec4b6', borderRadius: 4, stack: 's' },
        { label: 'Unpaid', data: rows.map(r=>r['Unpaid Count']), backgroundColor: '#adb5bd', borderRadius: 4, stack: 's' }
      ]
    }};
  },

  'hiring-outcomes': (db, from, to) => {
    const dc = dateClause('h.DateReported', from, to);
    const rows = db.prepare(`
      SELECT c.CompanyName AS "Company", co.FirstName||' '||co.LastName AS "Contact",
             h.FeedbackProvider AS "Provider", h.HiredStudentAlumni AS "Hired?",
             h.HiredStudentName AS "Student Name", date(h.DateReported) AS "Date"
      FROM HiringFeedback h
      JOIN Company c ON h.CompanyID=c.CompanyID JOIN Contact co ON h.ContactID=co.ContactID
      WHERE 1=1${dc.sql} ORDER BY h.DateReported DESC`).all(...dc.params);
    const yes = rows.filter(r=>r['Hired?']==='Yes').length;
    const no  = rows.length - yes;
    return { rows, chartData: {
      type: 'pie', labels: ['Hired (Yes)','Not Hired (No)'],
      datasets: [{ data: [yes, no], backgroundColor: ['#2ec4b6','#e71d36'] }]
    }};
  },

  'career-event-attendance': (db, from, to) => {
    const dc = dateClause('e.EventDate', from, to);
    const rows = db.prepare(`
      SELECT c.CompanyName AS "Company", co.FirstName||' '||co.LastName AS "Contact",
             e.EventName AS "Event", date(e.EventDate) AS "Date",
             e.RegisteredStatus AS "Status",
             CASE WHEN e.CMUQAlumniAtBooth=1 THEN 'Yes' ELSE 'No' END AS "Alumni at Booth"
      FROM CareerEvent e
      JOIN Company c ON e.CompanyID=c.CompanyID JOIN Contact co ON e.ContactID=co.ContactID
      WHERE 1=1${dc.sql} ORDER BY e.EventDate DESC`).all(...dc.params);
    const byStatus = {};
    rows.forEach(r => { byStatus[r.Status] = (byStatus[r.Status]||0)+1; });
    const statuses = ['Attended','No-Show','Cancelled'];
    return { rows, chartData: {
      type: 'bar', labels: statuses,
      datasets: [{ label: 'Events', data: statuses.map(s=>byStatus[s]||0),
                   backgroundColor: ['#2ec4b6','#e71d36','#adb5bd'], borderRadius: 4 }]
    }};
  },

  'hiring-trends': (db, from, to) => {
    const dc = dateClause('h.DateReported', from, to);
    const agg = db.prepare(`
      SELECT strftime('%Y-%m', h.DateReported) AS m,
             COUNT(*) AS n,
             GROUP_CONCAT(DISTINCT c.CompanyName) AS Companies
      FROM HiringFeedback h JOIN Company c ON h.CompanyID=c.CompanyID
      WHERE h.HiredStudentAlumni='Yes'${dc.sql}
      GROUP BY m ORDER BY m`).all(...dc.params);
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

  'academic-engagements': (db, from, to) => {
    const dc = dateClause('a.SessionDate', from, to);
    const rows = db.prepare(`
      SELECT c.CompanyName AS "Company", a.EngagementType AS "Type",
             a.GuestSpeakerName AS "Guest Speaker", a.FacultyName AS "Faculty",
             a.CourseNumber||' – '||a.CourseTitle AS "Course", date(a.SessionDate) AS "Date"
      FROM AcademicClassroomEngagement a
      JOIN Company c ON a.CompanyID=c.CompanyID
      WHERE 1=1${dc.sql} ORDER BY a.SessionDate DESC`).all(...dc.params);
    const byType = {};
    rows.forEach(r => { byType[r.Type] = (byType[r.Type]||0)+1; });
    const sorted = Object.entries(byType).sort((a,b)=>b[1]-a[1]);
    return { rows, chartData: {
      type: 'bar', labels: sorted.map(x=>x[0]),
      datasets: [{ label: 'Engagements', data: sorted.map(x=>x[1]),
                   backgroundColor: '#7209b7', borderRadius: 4 }]
    }};
  },

  'student-led-events': (db, from, to) => {
    const dc = dateClause('s.ProposalDate', from, to);
    const rows = db.prepare(`
      SELECT c.CompanyName AS "Company", s.OrganizationName AS "Organization",
             s.StudentName AS "Student Name", s.EventTitle AS "Event Title",
             date(s.EventDate) AS "Date", s.CollaborationOutcome AS "Outcome"
      FROM StudentLedEvent s JOIN Company c ON s.CompanyID=c.CompanyID
      WHERE 1=1${dc.sql} ORDER BY s.ProposalDate DESC`).all(...dc.params);
    const comp = rows.filter(r=>r.Outcome==='Completed').length;
    const pend = rows.length - comp;
    return { rows, chartData: {
      type: 'pie', labels: ['Completed','Pending'],
      datasets: [{ data: [comp, pend], backgroundColor: ['#2ec4b6','#ff9f1c'] }]
    }};
  },

  'guest-speakers': (db, from, to) => {
    const dc = dateClause('a.SessionDate', from, to);
    const rows = db.prepare(`
      SELECT a.GuestSpeakerName AS "Name", a.GuestTitle AS "Title",
             c.CompanyName AS "Company", a.CourseNumber||' – '||a.CourseTitle AS "Course",
             a.TopicTheme AS "Topic", date(a.SessionDate) AS "Date"
      FROM AcademicClassroomEngagement a JOIN Company c ON a.CompanyID=c.CompanyID
      WHERE 1=1${dc.sql} ORDER BY a.GuestSpeakerName`).all(...dc.params);
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

  'industry-trends': (db, from, to) => {
    // Engagement counts per semester per industry, across three activity types
    const collect = (sql, col, kind, params) => db.prepare(sql).all(...params)
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
    const labels = semesters.map(([sem]) => sem);
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

  'top-recruiters': (db, from, to) => {
    // Target semester = semester containing `from` (or current semester)
    const anchor = from || new Date().toISOString().slice(0, 10);
    const cur  = semesterOf(anchor);
    const prev = prevSemesterOf(cur);

    const countBy = (sql, range, params0 = []) => {
      const out = {};
      db.prepare(sql).all(...params0, range.from, range.to)
        .forEach(r => { out[r.company] = (out[r.company] || 0) + r.n; });
      return out;
    };
    const postSql = `SELECT c.CompanyName AS company, COUNT(*) AS n FROM Recruitment r JOIN Company c ON r.CompanyID=c.CompanyID WHERE r.DatePosted>=? AND r.DatePosted<=? GROUP BY c.CompanyName`;
    const hireSql = `SELECT c.CompanyName AS company, COUNT(*) AS n FROM HiringFeedback h JOIN Company c ON h.CompanyID=c.CompanyID WHERE h.HiredStudentAlumni='Yes' AND h.DateReported>=? AND h.DateReported<=? GROUP BY c.CompanyName`;

    const curPost = countBy(postSql, cur),  curHire = countBy(hireSql, cur);
    const prePost = countBy(postSql, prev), preHire = countBy(hireSql, prev);

    const companies = [...new Set([...Object.keys(curPost), ...Object.keys(curHire)])];
    const rows = companies.map(co => {
      const postings = curPost[co] || 0, hires = curHire[co] || 0;
      const total    = postings + hires;
      const prevTot  = (prePost[co] || 0) + (preHire[co] || 0);
      const diff     = total - prevTot;
      return {
        'Company': co, 'Postings': postings, 'Hires': hires, 'Total': total,
        [`${prev.label}`]: prevTot,
        'Change': diff > 0 ? `▲ +${diff}` : diff < 0 ? `▼ ${diff}` : '—',
      };
    }).sort((a, b) => b.Total - a.Total);

    const top = rows.slice(0, 15);
    return { rows, chartData: {
      type: 'bar', indexAxis: 'y',
      labels: top.map(r => r.Company),
      datasets: [
        { label: `Postings (${cur.label})`, data: top.map(r => r.Postings), backgroundColor: '#4361ee', borderRadius: 4 },
        { label: `Hires (${cur.label})`,    data: top.map(r => r.Hires),    backgroundColor: '#2ec4b6', borderRadius: 4 },
      ],
    }};
  },

  'top-roles-by-program': (db, from, to) => {
    const dc = dateClause('r.DatePosted', from, to);
    const raw = db.prepare(`
      SELECT m.Major AS major, r.OpportunityTitle AS title, r.Status AS payStatus,
             r.HiredStudentAlumni AS hired
      FROM Recruitment_TargetMajors m
      JOIN Recruitment r ON m.RecruitmentID = r.RecruitmentID
      WHERE 1=1${dc.sql}`).all(...dc.params);

    const byMajor = {};
    raw.forEach(r => {
      const m = byMajor[r.major] = byMajor[r.major] || { titles: {}, postings: 0, paid: 0, hired: 0 };
      m.postings++;
      if (r.payStatus === 'Paid')  m.paid++;
      if (r.hired === 'Yes')       m.hired++;
      const t = (r.title || '').trim();
      if (t) m.titles[t] = (m.titles[t] || 0) + 1;
    });

    const rows = Object.entries(byMajor)
      .sort((a, b) => b[1].postings - a[1].postings)
      .map(([major, m]) => ({
        'Major': major,
        'Top Opportunity Titles': Object.entries(m.titles).sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([t, n]) => `${t} (${n})`).join(', ') || '—',
        'Posting Count': m.postings,
        'Paid %': m.postings ? Math.round(m.paid / m.postings * 100) + '%' : '0%',
        'Hired Count': m.hired,
      }));

    return { rows, chartData: {
      type: 'bar',
      labels: rows.map(r => r.Major),
      datasets: [
        { label: 'Postings', data: rows.map(r => r['Posting Count']), backgroundColor: '#4361ee', borderRadius: 4 },
        { label: 'Hired',    data: rows.map(r => r['Hired Count']),   backgroundColor: '#2ec4b6', borderRadius: 4 },
      ],
    }};
  },

  'sector-engagement': (db, from, to) => {
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
    sources.forEach(([tbl, dateCol, idCol]) => {
      const dc = dateClause(dateCol, from, to);
      db.prepare(`SELECT ${dateCol} AS d, c.Sector AS sector FROM ${tbl} JOIN Company c ON ${idCol}=c.CompanyID WHERE 1=1${dc.sql}`)
        .all(...dc.params)
        .forEach(r => { const s = semesterOf(r.d); if (s) events.push({ sem: s, sector: r.sector || 'Unknown' }); });
    });

    const buckets = {}; // semLabel → {order, sectors:{}}
    events.forEach(ev => {
      const b = buckets[ev.sem.label] = buckets[ev.sem.label] || { order: ev.sem.order, sectors: {} };
      b.sectors[ev.sector] = (b.sectors[ev.sector] || 0) + 1;
    });
    const semesters = Object.entries(buckets).sort((a, b) => a[1].order - b[1].order);
    const labels    = semesters.map(([l]) => l);
    const SECTORS   = ['Government', 'NGO', 'Private', 'Semi-government', 'Startup'];

    const rows = [];
    semesters.forEach(([sem, b]) => SECTORS.forEach(sec => {
      const n = b.sectors[sec] || 0;
      if (n) rows.push({ 'Semester': sem, 'Sector': sec, 'Engagements': n });
    }));

    const datasets = SECTORS.map((sec, i) => ({
      label: sec,
      data: labels.map(l => buckets[l].sectors[sec] || 0),
      borderColor: PALETTE[i], backgroundColor: PALETTE[i], fill: false, tension: 0.3,
    }));
    return { rows, chartData: { type: 'line', labels, datasets } };
  },

  'hiring-conversion': (db, from, to) => {
    const dcR = dateClause('DatePosted', from, to);
    const dcH = dateClause('DateReported', from, to);
    const postings = db.prepare(`SELECT DatePosted AS d FROM Recruitment WHERE 1=1${dcR.sql}`).all(...dcR.params);
    const hires    = db.prepare(`SELECT DateReported AS d FROM HiringFeedback WHERE HiredStudentAlumni='Yes'${dcH.sql}`).all(...dcH.params);

    const buckets = {};
    const add = (list, key) => list.forEach(r => {
      const s = semesterOf(r.d); if (!s) return;
      const b = buckets[s.label] = buckets[s.label] || { order: s.order, posted: 0, hired: 0 };
      b[key]++;
    });
    add(postings, 'posted'); add(hires, 'hired');

    const semesters = Object.entries(buckets).sort((a, b) => a[1].order - b[1].order);
    const rows = semesters.map(([sem, b]) => ({
      'Semester': sem, 'Postings': b.posted, 'Hires': b.hired,
      'Conversion': b.posted ? Math.round(b.hired / b.posted * 100) + '%' : '—',
    }));
    return { rows, chartData: {
      type: 'bar', labels: semesters.map(([l]) => l),
      datasets: [
        { label: 'Postings', data: semesters.map(([, b]) => b.posted), backgroundColor: '#4361ee', borderRadius: 4 },
        { label: 'Hires',    data: semesters.map(([, b]) => b.hired),  backgroundColor: '#2ec4b6', borderRadius: 4 },
      ],
    }};
  },

  'semester-comparison': (db, from, to) => {
    // Semester A = semester containing `from` (or current); B = the one before it
    const anchor = from || new Date().toISOString().slice(0, 10);
    const A = semesterOf(anchor);
    const B = prevSemesterOf(A);

    const metrics = (r) => ({
      'Companies Engaged': db.prepare(`
        SELECT COUNT(DISTINCT CompanyID) AS n FROM (
          SELECT CompanyID, InteractionDate AS d FROM OutreachEngagement
          UNION ALL SELECT CompanyID, DatePosted FROM Recruitment
          UNION ALL SELECT CompanyID, EventDate FROM CareerEvent
          UNION ALL SELECT CompanyID, SessionDate FROM AcademicClassroomEngagement
        ) WHERE d >= ? AND d <= ?`).get(r.from, r.to).n,
      'New Companies Added':    db.prepare(`SELECT COUNT(*) AS n FROM Company WHERE DateAdded>=? AND DateAdded<=?`).get(r.from, r.to).n,
      'Recruitment Postings':   db.prepare(`SELECT COUNT(*) AS n FROM Recruitment WHERE DatePosted>=? AND DatePosted<=?`).get(r.from, r.to).n,
      'Career Events Attended': db.prepare(`SELECT COUNT(*) AS n FROM CareerEvent WHERE RegisteredStatus='Attended' AND EventDate>=? AND EventDate<=?`).get(r.from, r.to).n,
      'Students Hired':         db.prepare(`SELECT COUNT(*) AS n FROM HiringFeedback WHERE HiredStudentAlumni='Yes' AND DateReported>=? AND DateReported<=?`).get(r.from, r.to).n,
      'Academic Engagements':   db.prepare(`SELECT COUNT(*) AS n FROM AcademicClassroomEngagement WHERE SessionDate>=? AND SessionDate<=?`).get(r.from, r.to).n,
      'Outreach Interactions':  db.prepare(`SELECT COUNT(*) AS n FROM OutreachEngagement WHERE InteractionDate>=? AND InteractionDate<=?`).get(r.from, r.to).n,
    });

    const a = metrics(A), b = metrics(B);
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
  if (m >= 8) return { label: `Fall ${y}`,   order: y * 3 + 2, from: `${y}-08-01`, to: `${y}-12-31` };
  if (m <= 5) return { label: `Spring ${y}`, order: y * 3 + 0, from: `${y}-01-01`, to: `${y}-05-31` };
  return { label: `Summer ${y}`, order: y * 3 + 1, from: `${y}-06-01`, to: `${y}-07-31` };
}

function prevSemesterOf(sem) {
  // step back via the day before this semester starts
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
router.get('/schema', (req, res) => {
  const schema = {};
  for (const [entity, def] of Object.entries(BUILDER_SCHEMA)) {
    schema[entity] = Object.entries(def.columns).map(([key, col]) => ({
      key, label: col.label, type: col.type, values: col.values || null
    }));
  }
  res.json(schema);
});

// GET /api/reports/quick/:type
router.get('/quick/:type', (req, res) => {
  const db   = req.app.locals.db;
  const type = req.params.type;
  const { from, to, export: doExport } = req.query;
  const fn = QUICK_REPORTS[type];
  if (!fn) return res.status(404).json({ error: `Unknown report type: ${type}` });
  try {
    const result = fn(db, from || null, to || null);
    if (doExport === '1') {
      return exportXLSX(res, result.rows, `report-${type}`);
    }
    res.json({ rows: result.rows, count: result.rows.length, chartData: result.chartData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reports/builder
router.post('/builder', (req, res) => {
  const db = req.app.locals.db;
  const { entity, columns: selCols, filters, sortBy, sortOrder, chartType, chartGroupBy, from, to } = req.body;

  const schema = BUILDER_SCHEMA[entity];
  if (!schema) return res.status(400).json({ error: 'Unknown entity' });

  const allCols = schema.columns;

  // Whitelist selected columns
  const validCols = (selCols && selCols.length)
    ? selCols.filter(k => allCols[k])
    : Object.keys(allCols);

  if (!validCols.length) return res.status(400).json({ error: 'No valid columns selected' });

  // Whitelist sort column
  const validSort = sortBy && allCols[sortBy]
    ? allCols[sortBy].expr
    : allCols[validCols[0]].expr;
  const order = (sortOrder || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  // Build filter WHERE clause
  const filterClause = buildFilters(filters, schema);

  // Build date range clause for the primary date column (first date column)
  let dateSql = '', dateParams = [];
  const dateCols = Object.values(allCols).filter(c=>c.type==='date');
  if (dateCols.length && (from || to)) {
    const dc = dateClause(dateCols[0].expr, from, to);
    dateSql = dc.sql; dateParams = dc.params;
  }

  // SELECT expressions
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

  try {
    const rows = db.prepare(sql).all(...filterClause.params, ...dateParams);

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

    if (req.query.export === '1') return exportXLSX(res, rows, 'custom-report');
    if (req.query.export === 'csv') return exportCSV(res, rows, 'custom-report');
    res.json({ rows, count: rows.length, chartData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/saved
router.get('/saved', (req, res) => {
  const db = req.app.locals.db;
  try {
    res.json(db.prepare('SELECT * FROM SavedReports ORDER BY CreatedAt DESC').all());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/reports/saved
router.post('/saved', (req, res) => {
  const db = req.app.locals.db;
  const { ReportName, Entity, Columns, Filters, SortBy, SortOrder, ChartType, ChartGroupBy } = req.body;
  if (!ReportName || !Entity) return res.status(400).json({ error: 'ReportName and Entity are required' });
  try {
    const info = db.prepare(
      'INSERT INTO SavedReports (ReportName,Entity,Columns,Filters,SortBy,SortOrder,ChartType,ChartGroupBy) VALUES (?,?,?,?,?,?,?,?)'
    ).run(ReportName, Entity,
          JSON.stringify(Columns||[]), JSON.stringify(Filters||[]),
          SortBy||null, SortOrder||'ASC', ChartType||null, ChartGroupBy||null);
    res.status(201).json(db.prepare('SELECT * FROM SavedReports WHERE ReportID=?').get(info.lastInsertRowid));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/reports/saved/:id
router.delete('/saved/:id', (req, res) => {
  const db = req.app.locals.db;
  try {
    const info = db.prepare('DELETE FROM SavedReports WHERE ReportID=?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Export helpers ─────────────────────────────────────────────────────────────
function exportXLSX(res, rows, name) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Report');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
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
