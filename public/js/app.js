// ── Shared fetch wrapper ───────────────────────────────────────────────────────
async function fetchAPI(url, options = {}) {
  const defaults = {
    headers: { 'Content-Type': 'application/json' },
  };
  const config = { ...defaults, ...options };
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }
  const res = await fetch(url, config);
  // Session expired → send the user back to the login page instead of showing
  // a cryptic error toast on every action
  if (res.status === 401 && !window.location.pathname.endsWith('login.html')) {
    window.location.href = '/login.html';
    return new Promise(() => {}); // never resolves; page is navigating away
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function safeText(value) {
  return value === undefined || value === null ? '' : String(value);
}

function safeLower(value) {
  return safeText(value).toLowerCase();
}

function escapeHtml(value) {
  return safeText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Only allow http(s) URLs in href attributes — blocks javascript: and data: URIs
function safeUrl(u) {
  const s = String(u ?? '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function semanticToneForStatus(value) {
  const normalized = safeLower(value).replace(/\s+/g, '-');
  switch (normalized) {
    case 'mailable':
    case 'complete':
    case 'completed':
    case 'attended':
    case 'yes':
    case 'paid':
    case 'favorite':
      return 'good';
    case 'non-mailable':
    case 'blacklisted':
    case 'cancelled':
    case 'overdue':
    case 'no':
      return 'bad';
    case 'in-progress':
    case 'pending':
    case 'due-soon':
    case 'not-reported':
      return 'warn';
    case 'no-show':
    case 'viewer':
    case 'admin':
    default:
      return 'neutral';
  }
}

function semanticBadgeClass(tone = 'neutral', subtle = false, extraClasses = '') {
  const toneClass = `badge-semantic-${tone}`;
  return ['badge', 'badge-semantic', toneClass, subtle ? 'badge-semantic-subtle' : '', extraClasses]
    .filter(Boolean)
    .join(' ');
}

function renderSemanticBadge(label, tone = 'neutral', options = {}) {
  const { subtle = false, extraClasses = '', title = '' } = options;
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<span class="${semanticBadgeClass(tone, subtle, extraClasses)}"${titleAttr}>${escapeHtml(label)}</span>`;
}

function renderPrimaryIndicator(title = 'Primary contact') {
  const safeTitle = escapeHtml(title);
  return `<span class="entity-indicator entity-indicator-primary" title="${safeTitle}" aria-label="${safeTitle}"><i class="bi bi-star-fill"></i></span>`;
}

function renderStatusBadge(label, options = {}) {
  return renderSemanticBadge(label, semanticToneForStatus(label), options);
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function toDateInputValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + value);
    return excelEpoch.toISOString().slice(0, 10);
  }

  const text = safeText(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

function toDateDisplay(value) {
  return toDateInputValue(value) || '—';
}

function bindDebouncedInput(elementOrId, handler, delay = 300) {
  const element = typeof elementOrId === 'string'
    ? document.getElementById(elementOrId)
    : elementOrId;
  if (!element) return;

  let timer = null;
  element.addEventListener('input', event => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => handler(event), delay);
  });
}

function ensureRecordCountBadge() {
  let badge = document.getElementById('record-count');
  if (badge) return badge;

  const sticky = document.querySelector('.page-sticky-top');
  if (!sticky) return null;

  const searchInput = sticky.querySelector('#search-input');
  if (!searchInput) return null;

  const filterRow = searchInput.closest('.d-flex')
    || searchInput.closest('.filter-bar')
    || searchInput.closest('.mb-3')
    || searchInput.parentElement;
  if (!filterRow || filterRow.querySelector('#record-count')) return document.getElementById('record-count');
  if (!filterRow.classList.contains('d-flex')) {
    filterRow.classList.add('d-flex', 'align-items-center', 'gap-2', 'flex-wrap');
  }

  badge = document.createElement('span');
  badge.id = 'record-count';
  badge.className = 'badge bg-secondary ms-auto';
  filterRow.appendChild(badge);
  return badge;
}

function updateRecordCountBadge(shown, total = shown) {
  const badge = ensureRecordCountBadge();
  if (!badge) return;

  const label = shown === total
    ? `${total} record${total === 1 ? '' : 's'}`
    : `${shown} of ${total}`;
  badge.textContent = label;
}

function clearFormError(formOrId) {
  const form = typeof formOrId === 'string' ? document.getElementById(formOrId) : formOrId;
  const errorEl = form?.querySelector('.form-inline-error');
  if (!errorEl) return;
  errorEl.classList.add('d-none');
  errorEl.textContent = '';
}

function showFormError(formOrId, message) {
  const form = typeof formOrId === 'string' ? document.getElementById(formOrId) : formOrId;
  const modalBody = form?.querySelector('.modal-body');
  if (!form || !modalBody) return;

  let errorEl = form.querySelector('.form-inline-error');
  if (!errorEl) {
    errorEl = document.createElement('div');
    errorEl.className = 'alert alert-danger small py-2 form-inline-error';
    modalBody.prepend(errorEl);
  }

  errorEl.textContent = message;
  errorEl.classList.remove('d-none');
}

// ── Form validation ────────────────────────────────────────────────────────────
// Marks every [required] field in the form invalid if empty; returns true if all
// pass. Clears the red border automatically when the user edits the field.
function validateForm(formEl) {
  clearFormError(formEl);
  let valid = true;
  formEl.querySelectorAll('[required]').forEach(el => {
    const empty = el.tagName === 'SELECT' ? !el.value : !(el.value || '').trim();
    el.classList.toggle('is-invalid', empty);
    if (empty) {
      valid = false;
      const clear = () => el.classList.remove('is-invalid');
      el.addEventListener('input',  clear, { once: true });
      el.addEventListener('change', clear, { once: true });
    }
  });
  if (!valid) showToast('Please fill in all highlighted fields.', 'warning');
  return valid;
}

// ── Pagination ─────────────────────────────────────────────────────────────────
// Returns inner HTML for a Bootstrap pagination nav.
function buildPaginationHtml(page, totalPages, total, perPage) {
  const start = (page - 1) * perPage + 1;
  const end   = Math.min(page * perPage, total);

  const prev = page > 1
    ? `<li class="page-item"><a class="page-link" href="#" data-page="${page - 1}">‹</a></li>`
    : `<li class="page-item disabled"><span class="page-link">‹</span></li>`;
  const next = page < totalPages
    ? `<li class="page-item"><a class="page-link" href="#" data-page="${page + 1}">›</a></li>`
    : `<li class="page-item disabled"><span class="page-link">›</span></li>`;

  const lo = Math.max(1, page - 2), hi = Math.min(totalPages, page + 2);
  let links = '';
  if (lo > 1) links += `<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`;
  if (lo > 2) links += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
  for (let p = lo; p <= hi; p++) {
    links += `<li class="page-item${p === page ? ' active' : ''}"><a class="page-link" href="#" data-page="${p}">${p}</a></li>`;
  }
  if (hi < totalPages - 1) links += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
  if (hi < totalPages)     links += `<li class="page-item"><a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a></li>`;

  return `<div class="d-flex flex-column flex-sm-row align-items-center justify-content-between gap-2 w-100 px-1">
    <small class="text-muted">Showing ${start}–${end} of ${total} records</small>
    <nav aria-label="Table navigation"><ul class="pagination pagination-sm mb-0">${prev}${links}${next}</ul></nav>
  </div>`;
}

// ── Column sorting ─────────────────────────────────────────────────────────────
// Returns a NEW array sorted by `key`: numbers numerically, strings
// case-insensitively (ISO dates sort correctly as strings). Empties last.
function sortByKey(items, key, dir = 'asc') {
  const mult = dir === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    const av = a?.[key], bv = b?.[key];
    const aEmpty = av === undefined || av === null || av === '';
    const bEmpty = bv === undefined || bv === null || bv === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
    return safeLower(av).localeCompare(safeLower(bv)) * mult;
  });
}

// Makes every <th data-sort-key="Field"> in the thead clickable (and keyboard
// operable). Clicking toggles asc/desc, shows a caret, sets aria-sort, then
// calls onSort(key, dir). Returns { key, dir } getters for the current state.
function initSortableHeaders(theadEl, onSort) {
  if (!theadEl) return null;
  const headers = [...theadEl.querySelectorAll('th[data-sort-key]')];
  if (!headers.length) return null;

  const state = { key: null, dir: 'asc' };

  headers.forEach(th => {
    th.classList.add('th-sortable');
    th.setAttribute('tabindex', '0');
    th.setAttribute('role', 'button');
    th.setAttribute('aria-sort', 'none');
    th.insertAdjacentHTML('beforeend', '<i class="bi sort-caret" aria-hidden="true"></i>');

    const activate = () => {
      if (state.key === th.dataset.sortKey) {
        state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.key = th.dataset.sortKey;
        state.dir = 'asc';
      }
      headers.forEach(h => {
        const active = h === th;
        h.setAttribute('aria-sort', active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
        const caret = h.querySelector('.sort-caret');
        if (caret) caret.className = 'bi sort-caret' + (active ? (state.dir === 'asc' ? ' bi-caret-up-fill' : ' bi-caret-down-fill') : '');
      });
      onSort(state.key, state.dir);
    };

    th.addEventListener('click', activate);
    th.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
  });

  return {
    get key() { return state.key; },
    get dir() { return state.dir; },
  };
}

// ── Toast notification ─────────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const id = 'toast-' + Date.now();
  const bgClass = type === 'success' ? 'bg-success' : type === 'danger' ? 'bg-danger' : 'bg-warning';
  const safeMessage = String(message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = `
    <div id="${id}" class="toast align-items-center text-white ${bgClass} border-0" role="alert" aria-live="assertive">
      <div class="d-flex">
        <div class="toast-body fw-semibold">${safeMessage}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`;

  container.insertAdjacentHTML('beforeend', html);
  const el = document.getElementById(id);
  const toast = new bootstrap.Toast(el, { delay: 3500 });
  toast.show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

// ── Confirm modal ──────────────────────────────────────────────────────────────
function showConfirmModal(title, body, onConfirm, confirmLabel = 'Delete', confirmClass = 'btn-danger') {
  let modal = document.getElementById('global-confirm-modal');
  if (!modal) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal fade" id="global-confirm-modal" tabindex="-1" aria-labelledby="gcm-title">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="gcm-title"></h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body" id="gcm-body"></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn" id="gcm-confirm"></button>
            </div>
          </div>
        </div>
      </div>`);
    modal = document.getElementById('global-confirm-modal');
  }

  document.getElementById('gcm-title').textContent = title;
  document.getElementById('gcm-body').innerHTML = body;
  const btn = document.getElementById('gcm-confirm');
  btn.textContent = confirmLabel;
  btn.className = `btn ${confirmClass}`;

  const bsModal = new bootstrap.Modal(modal);

  // Replace listener
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', async () => {
    const idleHtml = newBtn.innerHTML;
    newBtn.disabled = true;
    newBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Working…';
    try {
      bsModal.hide();
      await onConfirm();
    } finally {
      newBtn.disabled = false;
      newBtn.innerHTML = idleHtml;
    }
  });

  bsModal.show();
}

// ── Date utility ──────────────────────────────────────────────────────────────
function formatRelativeDate(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d)) return null;
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dd    = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff  = Math.round((today - dd) / 86400000);
  const time  = d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
  if (diff === 0) return `today at ${time}`;
  if (diff === 1) return `yesterday at ${time}`;
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Meta / last-updated cache ──────────────────────────────────────────────────
let _metaCache = null;
async function fetchLastUpdated() {
  if (_metaCache) return _metaCache;
  try { _metaCache = await fetchAPI('/api/meta/last-updated'); }
  catch (_) { _metaCache = {}; }
  return _metaCache;
}

// ── Show-All date filter helper ────────────────────────────────────────────────
// fromId/toId = IDs of the date inputs, showAllId = ID of the toggle
// Returns { getRange() }
function initDateFilter(fromId, toId, showAllId, onChange) {
  const fromEl    = document.getElementById(fromId);
  const toEl      = document.getElementById(toId);
  const showAllEl = document.getElementById(showAllId);
  if (!fromEl || !toEl || !showAllEl) return null;

  function applyState() {
    const on = showAllEl.checked;
    fromEl.disabled = on;
    toEl.disabled   = on;
  }

  function defaultToCurrentSemester() {
    const m = new Date().getMonth() + 1, y = new Date().getFullYear();
    fromEl.value = m >= 8 ? `${y}-08-01` : m <= 5 ? `${y}-01-01` : `${y}-06-01`;
    toEl.value   = m >= 8 ? `${y}-12-31` : m <= 5 ? `${y}-05-31` : `${y}-07-31`;
  }

  function getRange() {
    if (showAllEl.checked) return { from: '', to: '' };
    return { from: fromEl.value || '', to: toEl.value || '' };
  }

  showAllEl.addEventListener('change', () => {
    if (!showAllEl.checked && !fromEl.value && !toEl.value) defaultToCurrentSemester();
    applyState();
    onChange(getRange());
  });
  [fromEl, toEl].forEach(el => el.addEventListener('change', () => {
    if (!fromEl.value && !toEl.value) { showAllEl.checked = true; applyState(); }
    onChange(getRange());
  }));

  applyState(); // initial — disable pickers since Show All is ON by default
  return { getRange };
}

// ── Sidebar navigation sections ────────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    label: null,
    items: [
      { href: '/index.html', icon: 'bi-speedometer2', label: 'Dashboard' },
    ],
  },
  {
    label: 'RECORDS',
    items: [
      { href: '/pages/companies.html',       icon: 'bi-building',               label: 'Companies' },
      { href: '/pages/contacts.html',        icon: 'bi-people',                 label: 'Contacts' },
      { href: '/pages/outreach.html',        icon: 'bi-chat-dots',              label: 'Outreach & Engagement' },
      { href: '/pages/recruitment.html',     icon: 'bi-briefcase',              label: 'Recruitment' },
      { href: '/pages/career-events.html',   icon: 'bi-calendar-event',         label: 'Career Events' },
      { href: '/pages/student-events.html',  icon: 'bi-mortarboard',            label: 'Student-Led Events' },
      { href: '/pages/academic.html',        icon: 'bi-book',                   label: 'Academic Engagement' },
      { href: '/pages/hiring-feedback.html', icon: 'bi-star',                   label: 'Hiring Feedback' },
      { href: '/pages/collaboration.html',   icon: 'bi-diagram-3',              label: 'Potential Collaboration' },
    ],
  },
  {
    label: 'TOOLS',
    items: [
      { href: '/pages/reports.html', icon: 'bi-file-earmark-bar-graph', label: 'Reports' },
      { href: '/pages/import.html',  icon: 'bi-upload',                 label: 'Data Import', adminOnly: true },
    ],
  },
  {
    label: 'ADMIN',
    adminOnly: true,
    items: [
      { href: '/pages/users.html', icon: 'bi-people-fill', label: 'Manage Users' },
    ],
  },
];

function injectSidebar() {
  const placeholder = document.getElementById('sidebar-placeholder');
  if (!placeholder) return;

  const currentPath = window.location.pathname;

  // Active-state: match exact filename, treating '/' and '/index.html' the same
  function isActive(href) {
    const page = href.replace(/^\//, '');
    if (page === 'index.html' && (currentPath === '/' || currentPath === '/index.html')) return true;
    return currentPath.endsWith(page);
  }

  // Build nav sections with divider labels
  const navHtml = NAV_SECTIONS.map(section => {
    const sectionAdminCls = section.adminOnly ? ' admin-only' : '';
    const labelHtml = section.label
      ? `<li class="nav-item px-3 pt-3 pb-1${sectionAdminCls}">
           <span style="font-size:10px;font-weight:700;letter-spacing:.08em;color:rgba(255,255,255,.4);text-transform:uppercase">${section.label}</span>
         </li>`
      : '';
    const itemsHtml = section.items.map(item => {
      const active  = isActive(item.href) ? 'active' : '';
      const itemCls = (item.adminOnly || section.adminOnly) ? ' admin-only' : '';
      return `<li class="nav-item${itemCls}">
        <a href="${item.href}" class="nav-link ${active} text-white px-3 py-2">
          <i class="bi ${item.icon} me-2"></i>${item.label}
        </a>
      </li>`;
    }).join('');
    return labelHtml + itemsHtml;
  }).join('');

  placeholder.innerHTML = `
    <!-- Mobile top bar -->
    <div class="mobile-topbar d-md-none d-flex align-items-center justify-content-between px-3 py-2 bg-dark text-white">
      <span class="fw-bold">ERO System</span>
      <button class="btn btn-sm btn-outline-light" id="sidebar-toggle" aria-label="Toggle navigation">
        <i class="bi bi-list fs-5"></i>
      </button>
    </div>

    <!-- Sidebar nav -->
    <nav id="sidebar-nav" class="sidebar d-flex flex-column bg-dark text-white">
      <div class="px-3 py-3 border-bottom border-secondary d-none d-md-block">
        <div class="fw-bold fs-6 text-white">ERO System</div>
        <div class="small text-secondary">CMU-Q Employer Relations</div>
      </div>
      <ul class="nav flex-column flex-grow-1 mt-2 pb-3">${navHtml}</ul>
      <div class="border-top border-secondary px-3 py-2">
        <div class="small text-secondary mb-2 text-truncate d-none" id="sidebar-username">
          <i class="bi bi-person-circle me-1"></i><span></span>
        </div>
        <button class="btn btn-sm btn-outline-light w-100 mb-1" id="btn-change-pw">
          <i class="bi bi-key me-1"></i>Change Password
        </button>
        <button class="btn btn-sm btn-outline-danger w-100" id="btn-logout">
          <i class="bi bi-box-arrow-right me-1"></i>Logout
        </button>
      </div>
    </nav>

    <!-- Mobile overlay -->
    <div id="sidebar-overlay" class="sidebar-overlay d-none"></div>`;

  // Mobile toggle behaviour
  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebarNav = document.getElementById('sidebar-nav');
  const overlay = document.getElementById('sidebar-overlay');

  function openSidebar() {
    sidebarNav.classList.add('sidebar-open');
    overlay.classList.remove('d-none');
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    sidebarNav.classList.remove('sidebar-open');
    overlay.classList.add('d-none');
    document.body.style.overflow = '';
  }

  toggleBtn?.addEventListener('click', () => {
    sidebarNav.classList.contains('sidebar-open') ? closeSidebar() : openSidebar();
  });
  overlay?.addEventListener('click', closeSidebar);

  // Close sidebar when a nav link is clicked on mobile
  sidebarNav.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', closeSidebar);
  });

  // Show who is signed in, apply role, populate last-updated indicators
  fetch('/api/auth/check').then(r => r.ok ? r.json() : null).then(async data => {
    if (!data) return;
    window.appRole   = data.role   || 'admin';
    window.appUserId = data.userId || null;
    if (data.username) {
      const el = document.getElementById('sidebar-username');
      const roleLabel = window.appRole === 'viewer' ? ' (viewer)' : '';
      el.querySelector('span').textContent = `Signed in as ${data.username}${roleLabel}`;
      el.classList.remove('d-none');
    }
    if (window.appRole === 'viewer') document.body.classList.add('role-viewer');
    document.dispatchEvent(new CustomEvent('approleready', { detail: { role: window.appRole } }));

    // Populate any last-updated indicator on this page
    const luEl = document.getElementById('page-last-updated');
    if (luEl) {
      const meta   = await fetchLastUpdated();
      const entity = luEl.dataset.entity;
      const ts     = meta[entity];
      luEl.textContent = ts ? `Last updated: ${formatRelativeDate(ts)}` : 'No records yet.';
    }

    // Dashboard freshness strip
    const freshEl = document.getElementById('data-freshness');
    if (freshEl) {
      const meta = await fetchLastUpdated();
      const PAGE = {
        companies: '/pages/companies.html', contacts: '/pages/contacts.html',
        outreach: '/pages/outreach.html', recruitment: '/pages/recruitment.html',
        careerEvents: '/pages/career-events.html', studentEvents: '/pages/student-events.html',
        academic: '/pages/academic.html', hiringFeedback: '/pages/hiring-feedback.html',
        collaboration: '/pages/collaboration.html',
      };
      const LABEL = {
        companies: 'Companies', contacts: 'Contacts', outreach: 'Outreach',
        recruitment: 'Recruitment', careerEvents: 'Career Events',
        studentEvents: 'Student Events', academic: 'Academic', hiringFeedback: 'Hiring Feedback',
        collaboration: 'Collaboration',
      };
      const sorted = Object.entries(meta)
        .filter(([, ts]) => ts)
        .sort((a, b) => new Date(b[1]) - new Date(a[1]))
        .slice(0, 3);
      if (sorted.length) {
        const parts = sorted.map(([key, ts]) =>
          `<a href="${PAGE[key]}" class="text-decoration-none text-reset">${LABEL[key]}</a> <span class="text-muted">(${formatRelativeDate(ts)})</span>`
        ).join(' &middot; ');
        freshEl.innerHTML = `<i class="bi bi-clock-history me-1 text-muted"></i><span class="text-muted small">Recently updated: </span>${parts}`;
      }
    }
  }).catch(() => {
    if (!window.location.pathname.endsWith('login.html')) {
      showToast('Could not verify your session. Refresh or sign in again.', 'danger');
    }
  });

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    try {
      await fetchAPI('/api/auth/logout', {
        method: 'POST',
        headers: {},
      });
      window.location.href = '/login.html';
    } catch (err) {
      showToast('Logout failed: ' + err.message, 'danger');
    }
  });

  // Change password modal
  document.getElementById('btn-change-pw')?.addEventListener('click', () => {
    let modal = document.getElementById('change-pw-modal');
    if (!modal) {
      document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="change-pw-modal" tabindex="-1" aria-labelledby="change-pw-title">
          <div class="modal-dialog">
            <div class="modal-content">
              <div class="modal-header"><h5 class="modal-title" id="change-pw-title">Change Password</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <form id="change-pw-form">
                <div class="modal-body">
                  <div id="pw-error" class="alert alert-danger d-none small py-2"></div>
                  <div class="mb-3">
                    <label class="form-label" for="pw-current">Current Password</label>
                    <input type="password" id="pw-current" class="form-control" required autocomplete="current-password">
                  </div>
                  <div class="mb-3">
                    <label class="form-label" for="pw-new">New Password</label>
                    <input type="password" id="pw-new" class="form-control" required minlength="6" autocomplete="new-password">
                  </div>
                  <div class="mb-0">
                    <label class="form-label" for="pw-confirm">Confirm New Password</label>
                    <input type="password" id="pw-confirm" class="form-control" required autocomplete="new-password">
                  </div>
                </div>
                <div class="modal-footer">
                  <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                  <button type="submit" class="btn btn-primary" id="pw-submit">Update Password</button>
                </div>
              </form>
            </div>
          </div>
        </div>`);
      modal = document.getElementById('change-pw-modal');

      document.getElementById('change-pw-form').addEventListener('submit', async e => {
        e.preventDefault();
        const errEl = document.getElementById('pw-error');
        errEl.classList.add('d-none');
        const newPw  = document.getElementById('pw-new').value;
        const confPw = document.getElementById('pw-confirm').value;
        if (newPw !== confPw) { errEl.textContent = 'Passwords do not match'; errEl.classList.remove('d-none'); return; }
        const btn = document.getElementById('pw-submit');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const res = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: document.getElementById('pw-current').value, newPassword: newPw })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          bootstrap.Modal.getInstance(modal).hide();
          showToast('Password updated successfully');
        } catch (err) {
          errEl.textContent = err.message; errEl.classList.remove('d-none');
        } finally { btn.disabled = false; btn.textContent = 'Update Password'; }
      });
    }
    new bootstrap.Modal(modal).show();
  });
}

document.addEventListener('DOMContentLoaded', injectSidebar);
document.addEventListener('DOMContentLoaded', () => {
  ensureRecordCountBadge();

  document.querySelectorAll('label.form-label').forEach(label => {
    const control = label.parentElement?.querySelector('[required]');
    if (!control || label.querySelector('.required-indicator')) return;
    const star = document.createElement('span');
    star.className = 'text-danger required-indicator';
    star.textContent = ' *';
    label.appendChild(star);
  });

  document.querySelectorAll('[title]:is(button, .btn)').forEach(button => {
    if (!button.getAttribute('aria-label')) {
      button.setAttribute('aria-label', button.getAttribute('title'));
    }
  });

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('shown.bs.modal', () => {
      // Focus the first real form field — skip hidden/disabled inputs and the
      // close (X) button so keyboard users land somewhere useful.
      const firstField = modal.querySelector(
        'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)'
      );
      firstField?.focus();
    });
  });
});
