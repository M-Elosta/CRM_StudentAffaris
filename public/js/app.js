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

// ── Form validation ────────────────────────────────────────────────────────────
// Marks every [required] field in the form invalid if empty; returns true if all
// pass. Clears the red border automatically when the user edits the field.
function validateForm(formEl) {
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
      <div class="modal fade" id="global-confirm-modal" tabindex="-1">
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
  newBtn.addEventListener('click', () => {
    bsModal.hide();
    onConfirm();
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
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

// ── Shared string / date / UI helpers ─────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Returns "15/06/25"; timezone-safe; returns "—" for empty/invalid
function formatDate(str) {
  if (!str) return '—';
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  return `${m[3]}/${m[2]}/${m[1].slice(-2)}`;
}

// Returns a debounced version of fn (300 ms default)
function debounce(fn, ms = 300) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// Update #record-count badge; safe no-op when element absent
function updateRecordCount(shown, total) {
  const el = document.getElementById('record-count');
  if (!el) return;
  el.textContent = shown === total
    ? `${total} record${total !== 1 ? 's' : ''}`
    : `${shown} of ${total}`;
}

const BADGE_STYLES = {
  companyState: {
    'Active': 'bg-primary',
    'Blacklisted': 'bg-danger',
    'Favorite': 'bg-warning text-dark',
    'Signed MoU': 'bg-success',
  },
  contactStatus: {
    'Mailable': 'bg-success',
    'Non-mailable': 'bg-danger',
    'Excluded from Mailing': 'bg-warning text-dark',
  },
  outreachStatus: {
    'Complete': 'bg-success',
    'In-progress': 'bg-warning text-dark',
  },
  outreachType: {
    'Call': 'bg-info text-dark',
    'Meeting': 'bg-primary',
    'Company Visit': 'bg-secondary',
  },
  recruitmentMode: {
    'Onsite': 'bg-primary',
    'Hybrid': 'bg-info text-dark',
    'Remote': 'bg-secondary',
  },
  recruitmentStatus: {
    'Paid': 'bg-success',
    'Unpaid': 'bg-secondary',
  },
  recruitmentHired: {
    'Yes': 'bg-success',
    'No': 'bg-secondary',
    'Not Reported': 'bg-warning text-dark',
  },
  careerEventStatus: {
    'Attended': 'bg-success',
    'No-Show': 'bg-danger',
    'Cancelled': 'bg-secondary',
  },
  studentOutcome: {
    'Completed': 'bg-success',
    'Pending': 'bg-warning text-dark',
  },
  academicType: {
    'Guest Lecture': 'bg-primary',
    'Panel Discussion': 'bg-info text-dark',
    'Community Project Partnership': 'bg-success',
    'Mock Interviews': 'bg-warning text-dark',
    'Research Collaboration': 'bg-secondary',
    'Competition/Hackathon Sponsorship': 'bg-dark',
    'Other': 'bg-secondary',
  },
  hiringProvider: {
    'Company': 'bg-primary',
    'Student/Alumni': 'bg-info text-dark',
    'Other': 'bg-secondary',
  },
  hiringOutcome: {
    'Yes': 'bg-success',
    'No': 'bg-secondary',
  },
};

function getBadgeClass(group, value, fallback = 'bg-secondary') {
  return BADGE_STYLES[group]?.[String(value)] || fallback;
}

// Returns a Bootstrap badge <span>; classMap maps value → 'bg-*' class
function statusBadge(value, classMap = {}) {
  if (value === null || value === undefined || value === '') return '<span class="badge bg-secondary">—</span>';
  const cls = classMap[String(value)] || 'bg-secondary';
  return `<span class="badge ${cls}">${escHtml(String(value))}</span>`;
}

function clearFormError(formOrId) {
  const form = typeof formOrId === 'string' ? document.getElementById(formOrId) : formOrId;
  form?.querySelector('[data-form-error]')?.remove();
}

function showFormError(formOrId, message) {
  const form = typeof formOrId === 'string' ? document.getElementById(formOrId) : formOrId;
  if (!form) return;
  clearFormError(form);
  const body = form.querySelector('.modal-body');
  if (!body) return;
  body.insertAdjacentHTML('afterbegin',
    `<div class="alert alert-danger py-2 small mb-3" data-form-error>${escHtml(message)}</div>`);
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
  }).catch(() => {});

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  // Change password modal
  document.getElementById('btn-change-pw')?.addEventListener('click', () => {
    let modal = document.getElementById('change-pw-modal');
    if (!modal) {
      document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="change-pw-modal" tabindex="-1">
          <div class="modal-dialog">
            <div class="modal-content">
              <div class="modal-header"><h5 class="modal-title">Change Password</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <form id="change-pw-form">
                <div class="modal-body">
                  <div id="pw-error" class="alert alert-danger d-none small py-2"></div>
                  <div class="mb-3">
                    <label class="form-label">Current Password</label>
                    <input type="password" id="pw-current" class="form-control" required>
                  </div>
                  <div class="mb-3">
                    <label class="form-label">New Password</label>
                    <input type="password" id="pw-new" class="form-control" required minlength="12">
                  </div>
                  <div class="mb-0">
                    <label class="form-label">Confirm New Password</label>
                    <input type="password" id="pw-confirm" class="form-control" required>
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
