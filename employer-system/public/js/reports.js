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
      { type: 'industry-trends',     label: 'Industry Trends',       desc: 'Engagement by industry per semester',   icon: 'bi-bar-chart-steps',  color: '#4361ee' },
      { type: 'top-recruiters',      label: 'Top Recruiters',        desc: 'Companies ranked, vs last semester',    icon: 'bi-trophy',           color: '#e9a823' },
      { type: 'top-roles-by-program',label: 'Top Roles by Program',  desc: 'Job roles grouped by target major',     icon: 'bi-diagram-3',        color: '#7209b7' },
      { type: 'sector-engagement',   label: 'Sector Engagement',     desc: 'Sector activity over semesters',        icon: 'bi-graph-up',         color: '#2ec4b6' },
      { type: 'hiring-conversion',   label: 'Hiring Conversion',     desc: 'Postings vs actual hires per semester', icon: 'bi-funnel',           color: '#198754' },
      { type: 'semester-comparison', label: 'Semester Comparison',   desc: 'Side-by-side semester metrics',         icon: 'bi-arrow-left-right', color: '#f72585' },
    ],
  },
];

// ── State ──────────────────────────────────────────────────────────────────────
let quickChart      = null;
let activeQuickType = null;

let repFilter = null;

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderReportSections();

  repFilter = initDateFilter('rep-from', 'rep-to', 'rep-show-all',
    () => { if (activeQuickType) rerunActive(); });

  document.getElementById('btn-quick-export').addEventListener('click', exportQuickExcel);
  document.getElementById('btn-download-png').addEventListener('click', () => downloadChartPNG('quick-chart', activeQuickType));
  document.getElementById('btn-print-quick').addEventListener('click', () => window.print());
});

function currentRange() {
  const r = repFilter ? repFilter.getRange() : { from: '', to: '' };
  return { from: r.from || null, to: r.to || null };
}

function rerunActive() {
  const card = document.querySelector('.report-card.active');
  runQuickReport(activeQuickType, card?.dataset.label || '');
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

  // Attach click handlers
  document.querySelectorAll('.report-card').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.report-card').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
      runQuickReport(el.dataset.type, el.dataset.label);
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
  const range = currentRange();
  const from  = range.from || '';
  const to    = range.to   || '';

  // Show results panel immediately (with loading state)
  const section = document.getElementById('results-section');
  section.classList.remove('d-none');
  document.getElementById('quick-loading').classList.remove('d-none');
  document.getElementById('chart-wrapper').classList.add('d-none');
  document.getElementById('quick-table-wrap').classList.add('d-none');
  document.getElementById('quick-empty').classList.add('d-none');
  document.getElementById('btn-download-png').classList.add('d-none');

  document.getElementById('qr-title').textContent = label;
  document.getElementById('qr-count').textContent  = '';

  // Smooth scroll to results
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to)   qs.set('to',   to);
    const data = await fetchAPI(`/api/reports/quick/${type}?${qs}`);

    document.getElementById('qr-count').textContent =
      `${data.count} record${data.count !== 1 ? 's' : ''}`;

    renderQuickTable(data.rows);
    renderQuickChart(data.chartData);
  } catch (err) {
    showToast('Failed to load report: ' + err.message, 'danger');
    document.getElementById('quick-empty').classList.remove('d-none');
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
      cols.map(c => `<td title="${escHtml(String(r[c] ?? ''))}">${escHtml(String(r[c] ?? '—'))}</td>`).join('') +
      '</tr>';
  }).join('');

  document.getElementById('quick-table-wrap').classList.remove('d-none');
}

function renderQuickChart(chartData) {
  const wrapper = document.getElementById('chart-wrapper');
  const pngBtn  = document.getElementById('btn-download-png');
  if (!chartData || !chartData.labels || !chartData.labels.length) {
    wrapper.classList.add('d-none');
    pngBtn.classList.add('d-none');
    return;
  }
  wrapper.classList.remove('d-none');
  pngBtn.classList.remove('d-none');
  if (quickChart) { quickChart.destroy(); quickChart = null; }
  quickChart = new Chart(document.getElementById('quick-chart').getContext('2d'), buildChartConfig(chartData));
}

async function exportQuickExcel() {
  if (!activeQuickType) return;
  const range = currentRange();
  const from  = range.from || '';
  const to    = range.to   || '';
  const qs = new URLSearchParams({ export: '1' });
  if (from) qs.set('from', from);
  if (to)   qs.set('to',   to);
  triggerDownload(`/api/reports/quick/${activeQuickType}?${qs}`);
  showToast('Downloading Excel…');
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
                const pct   = total ? Math.round(ctx.parsed / total * 100) : 0;
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
        y: { beginAtZero: true,          stacked: chartData.stacked || false },
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
  a.href     = canvas.toDataURL('image/png');
  a.click();
  showToast('Chart downloaded');
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function triggerDownload(url) {
  const a = document.createElement('a');
  a.href = url; a.click();
}

function escHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
