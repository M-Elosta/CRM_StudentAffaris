// ── Report catalogue ───────────────────────────────────────────────────────────
const REPORT_SECTIONS = [
  {
    id: 'contact-lists',
    icon: 'bi-people',
    label: 'Contact Lists',
    cards: [
      { type: 'mailable-contacts',  label: 'Mailable Contacts',    desc: 'Contacts opted in for email',           icon: 'bi-envelope-check',    color: '#198754' },
      { type: 'event-invitation',   label: 'Event Invitation List', desc: 'Companies to invite to events',         icon: 'bi-calendar-event',    color: '#4361ee' },
      { type: 'resume-book',        label: 'Resume Book',           desc: 'For student resume book distribution',  icon: 'bi-journal-text',      color: '#0dcaf0' },
      { type: 'non-mailable',       label: 'Non-Mailable',          desc: 'Contacts without email consent',        icon: 'bi-envelope-x',        color: '#dc3545' },
      { type: 'primary-contacts',   label: 'Primary Contacts',      desc: 'Main point of contact per company',     icon: 'bi-star-fill',         color: '#e9a823' },
      { type: 'alumni-contacts',    label: 'Alumni Contacts',       desc: 'CMU-Q alumni at partner companies',     icon: 'bi-mortarboard',       color: '#7209b7' },
    ],
  },
  {
    id: 'company-reports',
    icon: 'bi-building',
    label: 'Company Reports',
    cards: [
      { type: 'all-companies',         label: 'All Companies',       desc: 'Full employer directory listing',         icon: 'bi-buildings',           color: '#4361ee' },
      { type: 'blacklisted-companies', label: 'Blacklisted',         desc: 'Companies flagged as blocked',            icon: 'bi-slash-circle',        color: '#dc3545' },
      { type: 'companies-by-country',  label: 'By Country',          desc: 'Employers grouped by country',            icon: 'bi-globe',               color: '#2ec4b6' },
      { type: 'companies-by-sector',   label: 'By Sector',           desc: 'Employers grouped by industry',           icon: 'bi-pie-chart',           color: '#0dcaf0' },
      { type: 'favorite-employers',    label: 'Favourite Employers', desc: 'Top-rated employer partners',             icon: 'bi-heart-fill',          color: '#dc3545' },
      { type: 'new-companies',         label: 'New Companies',       desc: 'Recently added companies trend',          icon: 'bi-graph-up',            color: '#198754' },
      { type: 'mou-partners',          label: 'MoU Partners',        desc: 'Companies with a signed MoU',             icon: 'bi-file-earmark-check',  color: '#4361ee' },
    ],
  },
  {
    id: 'engagement',
    icon: 'bi-activity',
    label: 'Engagement & Activity',
    cards: [
      { type: 'followup-actions',   label: 'Follow-up Actions',   desc: 'Upcoming & overdue follow-ups',       icon: 'bi-alarm',          color: '#e9a823' },
      { type: 'engagement-summary', label: 'Engagement Summary',  desc: 'Outreach activity per employer',      icon: 'bi-bar-chart-steps',color: '#4361ee' },
      { type: 'inactive-companies', label: 'Inactive Companies',  desc: 'No contact in 6 or more months',      icon: 'bi-pause-circle',   color: '#6c757d' },
      { type: 'monthly-activity',   label: 'Monthly Activity',    desc: 'Interactions overview by month',      icon: 'bi-calendar3',      color: '#0dcaf0' },
    ],
  },
  {
    id: 'recruitment',
    icon: 'bi-briefcase',
    label: 'Recruitment & Hiring',
    cards: [
      { type: 'recruitment-postings',    label: 'Recruitment Postings',  desc: 'Open job & internship listings',      icon: 'bi-briefcase',       color: '#4361ee' },
      { type: 'recruitment-by-major',    label: 'By Major',              desc: 'Opportunities by field of study',     icon: 'bi-book',            color: '#0dcaf0' },
      { type: 'hiring-outcomes',         label: 'Hiring Outcomes',       desc: 'Student hiring result reports',       icon: 'bi-person-check',    color: '#198754' },
      { type: 'career-event-attendance', label: 'Event Attendance',      desc: 'Companies present at career events',  icon: 'bi-people',          color: '#4361ee' },
      { type: 'hiring-trends',           label: 'Hiring Trends',         desc: 'Monthly hiring data over time',       icon: 'bi-graph-up-arrow',  color: '#198754' },
    ],
  },
  {
    id: 'academic',
    icon: 'bi-mortarboard',
    label: 'Academic & Student',
    cards: [
      { type: 'academic-engagements', label: 'Academic Engagements', desc: 'Classroom visits & guest lectures', icon: 'bi-mortarboard-fill', color: '#7209b7' },
      { type: 'student-led-events',   label: 'Student-Led Events',   desc: 'Student-organised engagements',    icon: 'bi-megaphone',        color: '#e9a823' },
      { type: 'guest-speakers',       label: 'Guest Speakers',       desc: 'Industry speaker sessions',        icon: 'bi-mic',              color: '#343a40' },
    ],
  },
  {
    id: 'trends',
    icon: 'bi-graph-up-arrow',
    label: 'Trends & Insights',
    cards: [
      { type: 'industry-trends',             label: 'Industry Trends',              desc: 'Recruitment and engagement by industry',          icon: 'bi-bar-chart-steps',  color: '#4361ee' },
      { type: 'opportunities-per-semester',  label: 'Opportunities per Semester',   desc: 'Industries and companies driving semester activity', icon: 'bi-calendar-range', color: '#0dcaf0' },
      { type: 'top-recruiters',              label: 'Top Recruiters',               desc: 'Companies ranked against the previous period',   icon: 'bi-trophy',           color: '#e9a823' },
      { type: 'top-roles-by-program',        label: 'Top Job Roles by Program',     desc: 'Most common opportunity titles and types by target major', icon: 'bi-diagram-3', color: '#7209b7' },
      { type: 'activity-mix',                label: 'Activity Mix',                 desc: 'How outreach, recruitment, events, and hiring shift over time', icon: 'bi-layers', color: '#198754' },
      { type: 'year-over-year-comparison',   label: 'Year-over-Year Comparison',    desc: 'Engagement and recruitment volumes across academic years', icon: 'bi-bar-chart-line', color: '#f72585' },
      { type: 'sector-engagement',           label: 'Sector Engagement',            desc: 'Sector activity over semesters',                 icon: 'bi-graph-up',         color: '#2ec4b6' },
      { type: 'hiring-conversion',           label: 'Hiring Conversion',            desc: 'Postings vs actual hires per semester',          icon: 'bi-funnel',           color: '#198754' },
      { type: 'semester-comparison',         label: 'Semester Comparison',          desc: 'Side-by-side period metrics',                    icon: 'bi-arrow-left-right', color: '#6f42c1' },
    ],
  },
];

// ── State ──────────────────────────────────────────────────────────────────────
let quickChart = null;
let activeQuickType = null;
let repFilter = null;
let reportPeriods = buildFallbackPeriods();

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  renderReportSections();

  repFilter = initDateFilter('rep-from', 'rep-to', 'rep-show-all',
    () => { if (activeQuickType) rerunActive(); });

  document.getElementById('btn-quick-export').addEventListener('click', exportQuickExcel);
  document.getElementById('btn-download-png').addEventListener('click', exportQuickChartPng);
  document.getElementById('btn-print-quick').addEventListener('click', printQuickReport);

  await initReportFilters();
  restoreRequestedReport();
});

function currentRange() {
  const r = repFilter ? repFilter.getRange() : { from: '', to: '' };
  return { from: r.from || null, to: r.to || null };
}

function currentPeriodContext() {
  const showAll = document.getElementById('rep-show-all')?.checked;
  if (showAll) return { mode: 'all', label: 'All time' };

  const mode = document.getElementById('rep-view-mode')?.value || 'date';
  if (mode === 'semester') {
    const option = reportPeriods.semesters.find(x => x.key === document.getElementById('rep-semester')?.value);
    return { mode, semester: option?.key || null, label: option?.label || 'Semester' };
  }
  if (mode === 'academic-year') {
    const option = reportPeriods.academicYears.find(x => x.key === document.getElementById('rep-academic-year')?.value);
    return { mode, academicYear: option?.key || null, label: option?.label || 'Academic year' };
  }

  const range = currentRange();
  if (range.from && range.to) return { mode, label: `${formatReportDate(range.from)} - ${formatReportDate(range.to)}` };
  if (range.from) return { mode, label: `From ${formatReportDate(range.from)}` };
  if (range.to) return { mode, label: `To ${formatReportDate(range.to)}` };
  return { mode, label: 'Custom range' };
}

function rerunActive() {
  const card = document.querySelector('.report-card.active');
  runQuickReport(activeQuickType, card?.dataset.label || '');
}

function setQuickFeedback(kind, message) {
  const el = document.getElementById('quick-feedback');
  if (!el) return;
  el.className = `alert alert-${kind} py-2 px-3 small`;
  el.textContent = message;
}

function updateActionButtons({ hasSelection = false, hasChart = false } = {}) {
  document.getElementById('btn-quick-export').disabled = !hasSelection;
  document.getElementById('btn-print-quick').disabled = !hasSelection;
  const pngBtn = document.getElementById('btn-download-png');
  pngBtn.disabled = !hasChart;
  pngBtn.classList.toggle('d-none', !hasChart);
}

function normalizeRequestedReportType(value) {
  if (!value) return null;
  const aliases = {
    'follow_up': 'followup-actions',
    'follow-up': 'followup-actions',
  };
  return aliases[value] || value;
}

function setActiveReportCard(cardEl) {
  document.querySelectorAll('.report-card').forEach(card => {
    const isActive = card === cardEl;
    card.classList.toggle('active', isActive);
    card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function restoreRequestedReport() {
  const requestedType = normalizeRequestedReportType(new URLSearchParams(window.location.search).get('type'));
  if (!requestedType) return;
  const card = document.querySelector(`.report-card[data-type="${CSS.escape(requestedType)}"]`);
  if (!card) {
    showToast(`Unknown report type: ${requestedType}`, 'warning');
    return;
  }
  setActiveReportCard(card);
  runQuickReport(card.dataset.type, card.dataset.label);
}

async function initReportFilters() {
  const viewModeEl = document.getElementById('rep-view-mode');
  const semesterEl = document.getElementById('rep-semester');
  const academicYearEl = document.getElementById('rep-academic-year');
  const showAllEl = document.getElementById('rep-show-all');

  reportPeriods = await loadReportPeriods();
  populatePeriodOptions(semesterEl, reportPeriods.semesters);
  populatePeriodOptions(academicYearEl, reportPeriods.academicYears);

  semesterEl.value = reportPeriods.defaults?.semester || reportPeriods.semesters[0]?.key || '';
  academicYearEl.value = reportPeriods.defaults?.academicYear || reportPeriods.academicYears[0]?.key || '';
  viewModeEl.value = 'semester';

  viewModeEl.addEventListener('change', () => {
    if (showAllEl.checked) showAllEl.checked = false;
    ensureModeSelection(viewModeEl.value);
    applyReportFilterState(true);
  });
  semesterEl.addEventListener('change', () => {
    if (showAllEl.checked) showAllEl.checked = false;
    applyReportFilterState(true);
  });
  academicYearEl.addEventListener('change', () => {
    if (showAllEl.checked) showAllEl.checked = false;
    applyReportFilterState(true);
  });
  showAllEl.addEventListener('change', () => applyReportFilterState(false));

  applyReportFilterState(false);
}

async function loadReportPeriods() {
  try {
    const data = await fetchAPI('/api/reports/periods');
    if (Array.isArray(data?.semesters) && data.semesters.length && Array.isArray(data?.academicYears) && data.academicYears.length) {
      return data;
    }
  } catch (_) {}
  return buildFallbackPeriods();
}

function populatePeriodOptions(selectEl, items) {
  selectEl.innerHTML = items.map(item =>
    `<option value="${escHtml(item.key)}">${escHtml(item.label)}</option>`).join('');
}

function ensureModeSelection(mode) {
  if (mode === 'semester' && !document.getElementById('rep-semester').value) {
    document.getElementById('rep-semester').value = reportPeriods.defaults?.semester || reportPeriods.semesters[0]?.key || '';
  }
  if (mode === 'academic-year' && !document.getElementById('rep-academic-year').value) {
    document.getElementById('rep-academic-year').value = reportPeriods.defaults?.academicYear || reportPeriods.academicYears[0]?.key || '';
  }
}

function applyReportFilterState(triggerRerun) {
  const showAllEl = document.getElementById('rep-show-all');
  const viewModeEl = document.getElementById('rep-view-mode');
  const semesterEl = document.getElementById('rep-semester');
  const academicYearEl = document.getElementById('rep-academic-year');
  const fromEl = document.getElementById('rep-from');
  const toEl = document.getElementById('rep-to');
  const semesterWrap = document.getElementById('rep-semester-wrap');
  const academicYearWrap = document.getElementById('rep-ay-wrap');
  const dateWrap = document.getElementById('rep-date-wrap');
  const captionEl = document.getElementById('rep-period-caption');
  const isAll = showAllEl.checked;
  const mode = viewModeEl.value;

  viewModeEl.disabled = false;
  semesterEl.disabled = isAll || mode !== 'semester';
  academicYearEl.disabled = isAll || mode !== 'academic-year';
  fromEl.disabled = isAll || mode !== 'date';
  toEl.disabled = isAll || mode !== 'date';

  semesterWrap.classList.toggle('d-none', isAll || mode !== 'semester');
  academicYearWrap.classList.toggle('d-none', isAll || mode !== 'academic-year');
  dateWrap.classList.toggle('d-none', isAll || mode !== 'date');

  if (isAll) {
    fromEl.value = '';
    toEl.value = '';
    captionEl.textContent = 'All time';
  } else if (mode === 'semester') {
    const semester = reportPeriods.semesters.find(x => x.key === semesterEl.value) || reportPeriods.semesters[0];
    if (semester) {
      fromEl.value = semester.from;
      toEl.value = semester.to;
      captionEl.textContent = `${semester.label} • ${formatReportDate(semester.from)} - ${formatReportDate(semester.to)}`;
    }
  } else if (mode === 'academic-year') {
    const academicYear = reportPeriods.academicYears.find(x => x.key === academicYearEl.value) || reportPeriods.academicYears[0];
    if (academicYear) {
      fromEl.value = academicYear.from;
      toEl.value = academicYear.to;
      captionEl.textContent = `${academicYear.label} • ${formatReportDate(academicYear.from)} - ${formatReportDate(academicYear.to)}`;
    }
  } else if (fromEl.value && toEl.value) {
    captionEl.textContent = `${formatReportDate(fromEl.value)} - ${formatReportDate(toEl.value)}`;
  } else if (fromEl.value) {
    captionEl.textContent = `From ${formatReportDate(fromEl.value)}`;
  } else if (toEl.value) {
    captionEl.textContent = `To ${formatReportDate(toEl.value)}`;
  } else {
    captionEl.textContent = 'Custom range';
  }

  if (triggerRerun && activeQuickType) rerunActive();
}

function buildFallbackPeriods() {
  const today = new Date();
  const currentYear = today.getFullYear();
  const semesters = [];
  const terms = [
    ['spring', 'Spring', '01-01', '05-31'],
    ['summer', 'Summer', '06-01', '07-31'],
    ['fall', 'Fall', '08-01', '12-31'],
  ];

  for (let year = currentYear - 4; year <= currentYear + 1; year++) {
    terms.forEach(([key, label, from, to]) => {
      semesters.push({
        key: `${year}-${key}`,
        label: `${label} ${year}`,
        from: `${year}-${from}`,
        to: `${year}-${to}`,
      });
    });
  }

  const academicYears = [];
  for (let start = currentYear - 4; start <= currentYear + 1; start++) {
    academicYears.push({
      key: `${start}-${String(start + 1).slice(-2)}`,
      label: `AY${start}-${String(start + 1).slice(-2)}`,
      from: `${start}-08-01`,
      to: `${start + 1}-05-31`,
    });
  }

  return {
    semesters,
    academicYears,
    defaults: {
      semester: defaultSemesterKey(),
      academicYear: defaultAcademicYearKey(),
    },
  };
}

function formatReportDate(value) {
  if (!value) return '—';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);
  return `${match[3]}/${match[2]}/${match[1].slice(-2)}`;
}

function defaultSemesterKey() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month >= 8) return `${year}-fall`;
  if (month <= 5) return `${year}-spring`;
  return `${year}-summer`;
}

function defaultAcademicYearKey() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const start = month >= 8 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

function buildQuickReportQuery(extra = {}) {
  const qs = new URLSearchParams(extra);
  const showAll = document.getElementById('rep-show-all').checked;
  const mode = document.getElementById('rep-view-mode').value;
  const range = currentRange();

  if (!showAll) {
    if (mode === 'semester') {
      qs.set('semester', document.getElementById('rep-semester').value);
    } else if (mode === 'academic-year') {
      qs.set('academicYear', document.getElementById('rep-academic-year').value);
    } else {
      if (range.from) qs.set('from', range.from);
      if (range.to) qs.set('to', range.to);
    }
  }

  return qs;
}

// ── Render sections & cards ────────────────────────────────────────────────────
function renderReportSections() {
  const container = document.getElementById('report-sections');
  container.innerHTML = REPORT_SECTIONS.map(section => `
    <div class="mb-4">
      <div class="section-header">
        <span class="section-pill">
          <i class="bi ${section.icon} text-primary"></i>
          ${escHtml(section.label)}
        </span>
        <div class="section-divider"></div>
      </div>
      <div class="report-grid">
        ${section.cards.map(card => buildCardHtml(card)).join('')}
      </div>
    </div>`).join('');

  document.querySelectorAll('.report-card').forEach(el => {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-pressed', 'false');
    const activate = () => {
      setActiveReportCard(el);
      const url = new URL(window.location.href);
      url.searchParams.set('type', el.dataset.type);
      window.history.replaceState({}, '', url);
      runQuickReport(el.dataset.type, el.dataset.label);
    };
    el.addEventListener('click', activate);
    el.addEventListener('keydown', evt => {
      if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        activate();
      }
    });
  });
}

function buildCardHtml(card) {
  const bgAlpha = hexToRgba(card.color, 0.12);
  return `
    <div class="report-card" data-type="${escHtml(card.type)}" data-label="${escHtml(card.label)}">
      <div class="card-icon-wrap" style="background:${bgAlpha}">
        <i class="bi ${card.icon}" style="color:${card.color}"></i>
      </div>
      <div class="card-title">${escHtml(card.label)}</div>
      <div class="card-desc">${escHtml(card.desc)}</div>
    </div>`;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Quick Reports ──────────────────────────────────────────────────────────────
async function runQuickReport(type, label) {
  activeQuickType = type;

  const section = document.getElementById('results-section');
  section.classList.remove('d-none');
  document.getElementById('quick-loading').classList.remove('d-none');
  document.getElementById('chart-wrapper').classList.add('d-none');
  document.getElementById('quick-table-wrap').classList.add('d-none');
  document.getElementById('quick-empty').classList.add('d-none');
  document.getElementById('btn-download-png').classList.add('d-none');

  document.getElementById('qr-title').textContent = label;
  document.getElementById('qr-count').textContent = '';
  updateActionButtons({ hasSelection: true, hasChart: false });
  setQuickFeedback('info', `Loading ${label} for ${currentPeriodContext().label.toLowerCase()}...`);
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const data = await fetchAPI(`/api/reports/quick/${type}?${buildQuickReportQuery()}`);
    const countText = `${data.count} record${data.count !== 1 ? 's' : ''}`;
    document.getElementById('qr-count').textContent = data.meta?.periodLabel
      ? `${countText} • ${data.meta.periodLabel}`
      : countText;

    renderQuickTable(data.rows);
    renderQuickChart(data.chartData);
    if (data.rows?.length) {
      setQuickFeedback('success', `Showing ${label} for ${data.meta?.periodLabel || currentPeriodContext().label}.`);
    } else {
      setQuickFeedback('warning', `No records found for ${label} in ${data.meta?.periodLabel || currentPeriodContext().label}.`);
    }
  } catch (err) {
    showToast('Failed to load report: ' + err.message, 'danger');
    document.getElementById('quick-empty').classList.remove('d-none');
    updateActionButtons({ hasSelection: true, hasChart: false });
    setQuickFeedback('danger', `Could not load ${label}: ${err.message}`);
  } finally {
    document.getElementById('quick-loading').classList.add('d-none');
  }
}

function renderQuickTable(rows) {
  const thead = document.getElementById('quick-thead');
  const tbody = document.getElementById('quick-tbody');

  if (!rows || !rows.length) {
    thead.innerHTML = '';
    tbody.innerHTML = '';
    document.getElementById('quick-empty').classList.remove('d-none');
    return;
  }

  const cols = Object.keys(rows[0]).filter(k => !k.startsWith('_'));
  thead.innerHTML = '<tr>' + cols.map(c => `<th>${escHtml(c)}</th>`).join('') + '</tr>';

  const urgencyClass = { overdue: 'table-danger', 'this-week': 'table-warning', upcoming: '' };
  tbody.innerHTML = rows.map(r => {
    const cls = r._urgency ? (urgencyClass[r._urgency] || '') : '';
    return `<tr class="${cls}">` +
      cols.map(c => {
        const value = formatReportCellValue(r[c]);
        return `<td title="${escHtml(value)}">${escHtml(value)}</td>`;
      }).join('') +
      '</tr>';
  }).join('');

  document.getElementById('quick-table-wrap').classList.remove('d-none');
}

function formatReportCellValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(value)) return formatReportDate(value);
  return String(value);
}

function renderQuickChart(chartData) {
  const wrapper = document.getElementById('chart-wrapper');
  if (!chartData || !chartData.labels || !chartData.labels.length) {
    wrapper.classList.add('d-none');
    updateActionButtons({ hasSelection: !!activeQuickType, hasChart: false });
    return;
  }
  wrapper.classList.remove('d-none');
  updateActionButtons({ hasSelection: !!activeQuickType, hasChart: true });
  if (quickChart) { quickChart.destroy(); quickChart = null; }
  quickChart = new Chart(document.getElementById('quick-chart').getContext('2d'), buildChartConfig(chartData));
}

async function exportQuickExcel() {
  if (!activeQuickType) {
    showToast('Choose a report before exporting.', 'warning');
    return;
  }
  triggerDownload(`/api/reports/quick/${activeQuickType}?${buildQuickReportQuery({ export: '1' })}`);
  showToast('Downloading Excel…');
}

function exportQuickChartPng() {
  if (!activeQuickType || !quickChart) {
    showToast('Load a report chart before downloading PNG.', 'warning');
    return;
  }
  downloadChartPNG('quick-chart', activeQuickType);
}

function printQuickReport() {
  if (!activeQuickType) {
    showToast('Choose a report before printing.', 'warning');
    return;
  }
  window.print();
}

// ── Chart.js ───────────────────────────────────────────────────────────────────
function buildChartConfig(chartData) {
  const isPie = ['pie', 'doughnut'].includes(chartData.type);
  return {
    type: chartData.type,
    data: { labels: chartData.labels, datasets: chartData.datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      animation: { duration: 400 },
      plugins: {
        legend: { display: isPie || chartData.datasets.length > 1, position: 'bottom' },
        tooltip: {
          callbacks: {
            label: ctx => {
              if (isPie) {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total ? Math.round(ctx.parsed / total * 100) : 0;
                return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
              }
              const val = ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed;
              return ` ${ctx.dataset.label || ''}: ${val}`;
            },
          },
        },
      },
      scales: isPie ? {} : {
        x: { ticks: { maxRotation: 45 }, stacked: chartData.stacked || false },
        y: { beginAtZero: true, stacked: chartData.stacked || false },
      },
      indexAxis: chartData.indexAxis || 'x',
    },
  };
}

function downloadChartPNG(canvasId, name) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const a = document.createElement('a');
  a.download = `${name || 'chart'}-${Date.now()}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
  showToast('Chart downloaded');
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function triggerDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  a.click();
}

function escHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
