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

// ── Semester utilities (CMU-Q academic calendar) ──────────────────────────────
// Fall:   Aug 1 – Dec 31   |   Spring: Jan 1 – May 31   |   Summer: Jun 1 – Jul 31
function getSemester(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d)) return null;
  const m = d.getMonth() + 1, y = d.getFullYear();
  if (m >= 8) return `Fall ${y}`;
  if (m <= 5) return `Spring ${y}`;
  return `Summer ${y}`;
}

function semesterRange(sem, year) {
  year = Number(year);
  if (sem === 'Fall')   return { from: `${year}-08-01`, to: `${year}-12-31` };
  if (sem === 'Spring') return { from: `${year}-01-01`, to: `${year}-05-31` };
  return { from: `${year}-06-01`, to: `${year}-07-31` }; // Summer
}

// Previous semester in chronological order: …Fall 2024 → Spring 2025 → Summer 2025 → Fall 2025…
function prevSemester(sem, year) {
  year = Number(year);
  if (sem === 'Fall')   return { sem: 'Summer', year };
  if (sem === 'Summer') return { sem: 'Spring', year };
  return { sem: 'Fall', year: year - 1 }; // before Spring Y is Fall Y-1
}

// Academic year runs Aug 1 (startYear) – Jul 31 (startYear+1)
function academicYearRange(startYear) {
  startYear = Number(startYear);
  return { from: `${startYear}-08-01`, to: `${startYear + 1}-07-31` };
}

// Semester containing today
function currentSemester() {
  const today = new Date();
  const label = getSemester(today);
  const [sem, year] = label.split(' ');
  return { sem, year: Number(year) };
}

// ── Period filter widget ───────────────────────────────────────────────────────
// Renders a 3-mode filter bar (Semester / Academic Year / Custom + Show All)
// into containerEl. Calls onChange(range) whenever the selection changes.
// range = { from, to, label, compare: {from, to, label} | null, showAll }
function initPeriodFilter(containerEl, onChange, opts = {}) {
  const cur = currentSemester();
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = thisYear + 1; y >= 2018; y--) years.push(y);

  const yearOpts = years.map(y => `<option value="${y}" ${y === cur.year ? 'selected' : ''}>${y}</option>`).join('');
  const ayStart  = cur.sem === 'Fall' ? cur.year : cur.year - 1;
  const ayOpts   = years.filter(y => y <= thisYear).map(y =>
    `<option value="${y}" ${y === ayStart ? 'selected' : ''}>${y}–${y + 1}</option>`).join('');

  containerEl.innerHTML = `
    <div class="d-flex flex-wrap align-items-center gap-3">
      <div class="btn-group btn-group-sm" role="group" aria-label="Period mode">
        <button type="button" class="btn btn-primary pf-mode" data-mode="semester">Semester</button>
        <button type="button" class="btn btn-outline-primary pf-mode" data-mode="ay">Academic Year</button>
        <button type="button" class="btn btn-outline-primary pf-mode" data-mode="custom">Custom</button>
      </div>

      <!-- Semester mode -->
      <div class="d-flex align-items-center gap-2 pf-pane" data-pane="semester">
        <select class="form-select form-select-sm" id="pf-sem" style="width:auto">
          <option ${cur.sem === 'Fall' ? 'selected' : ''}>Fall</option>
          <option ${cur.sem === 'Spring' ? 'selected' : ''}>Spring</option>
          <option ${cur.sem === 'Summer' ? 'selected' : ''}>Summer</option>
        </select>
        <select class="form-select form-select-sm" id="pf-year" style="width:auto">${yearOpts}</select>
        <div class="form-check mb-0 ms-1">
          <input class="form-check-input" type="checkbox" id="pf-compare">
          <label class="form-check-label small fw-semibold text-nowrap" for="pf-compare">Compare to previous</label>
        </div>
      </div>

      <!-- Academic year mode -->
      <div class="d-flex align-items-center gap-2 pf-pane d-none" data-pane="ay">
        <select class="form-select form-select-sm" id="pf-ay" style="width:auto">${ayOpts}</select>
      </div>

      <!-- Custom mode -->
      <div class="d-flex align-items-center gap-2 pf-pane d-none" data-pane="custom">
        <input type="date" id="pf-from" class="form-control form-control-sm" style="width:150px" title="From date">
        <span class="text-muted small">to</span>
        <input type="date" id="pf-to" class="form-control form-control-sm" style="width:150px" title="To date">
      </div>

      <div class="vr d-none d-sm-block" style="height:1.5rem"></div>
      <div class="form-check form-switch mb-0">
        <input class="form-check-input" type="checkbox" id="pf-show-all" role="switch" ${opts.showAllDefault ? 'checked' : ''}>
        <label class="form-check-label fw-semibold small" for="pf-show-all">Show All</label>
      </div>
    </div>`;

  let mode = 'semester';

  function getRange() {
    const showAll = containerEl.querySelector('#pf-show-all').checked;
    if (showAll) return { from: null, to: null, label: 'All time', compare: null, showAll: true };

    if (mode === 'semester') {
      const sem  = containerEl.querySelector('#pf-sem').value;
      const year = Number(containerEl.querySelector('#pf-year').value);
      const r    = semesterRange(sem, year);
      let compare = null;
      if (containerEl.querySelector('#pf-compare').checked) {
        const p = prevSemester(sem, year);
        compare = { ...semesterRange(p.sem, p.year), label: `${p.sem} ${p.year}` };
      }
      return { ...r, label: `${sem} ${year}`, compare, showAll: false };
    }
    if (mode === 'ay') {
      const y = Number(containerEl.querySelector('#pf-ay').value);
      return { ...academicYearRange(y), label: `AY ${y}–${y + 1}`, compare: null, showAll: false };
    }
    // custom
    const from = containerEl.querySelector('#pf-from').value || null;
    const to   = containerEl.querySelector('#pf-to').value || null;
    return { from, to, label: 'Custom range', compare: null, showAll: false };
  }

  function fire() { onChange(getRange()); }

  containerEl.querySelectorAll('.pf-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      mode = btn.dataset.mode;
      containerEl.querySelectorAll('.pf-mode').forEach(b => {
        b.classList.toggle('btn-primary', b === btn);
        b.classList.toggle('btn-outline-primary', b !== btn);
      });
      containerEl.querySelectorAll('.pf-pane').forEach(p =>
        p.classList.toggle('d-none', p.dataset.pane !== mode));
      fire();
    });
  });

  ['#pf-sem', '#pf-year', '#pf-compare', '#pf-ay', '#pf-from', '#pf-to', '#pf-show-all'].forEach(sel => {
    containerEl.querySelector(sel).addEventListener('change', fire);
  });

  return { getRange };
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

// ── Sidebar injection ──────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { href: '/index.html',                icon: 'bi-speedometer2',           label: 'Dashboard' },
  { href: '/pages/companies.html',      icon: 'bi-building',               label: 'Companies' },
  { href: '/pages/contacts.html',       icon: 'bi-people',                 label: 'Contacts' },
  { href: '/pages/outreach.html',       icon: 'bi-chat-dots',              label: 'Outreach & Engagement' },
  { href: '/pages/recruitment.html',    icon: 'bi-briefcase',              label: 'Recruitment' },
  { href: '/pages/career-events.html',  icon: 'bi-calendar-event',         label: 'Career Events' },
  { href: '/pages/student-events.html', icon: 'bi-mortarboard',            label: 'Student-Led Events' },
  { href: '/pages/academic.html',       icon: 'bi-book',                   label: 'Academic Engagement' },
  { href: '/pages/hiring-feedback.html',icon: 'bi-star',                   label: 'Hiring Feedback' },
  { href: '/pages/collaboration.html',  icon: 'bi-diagram-3',              label: 'Potential Collaboration' },
  { href: '/pages/reports.html',        icon: 'bi-file-earmark-bar-graph', label: 'Reports' },
  { href: '/pages/import.html',         icon: 'bi-upload',                 label: 'Data Import',    adminOnly: true },
  { href: '/pages/users.html',          icon: 'bi-people-fill',            label: 'Manage Users',   adminOnly: true },
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

  const items = NAV_ITEMS.map(item => {
    const active = isActive(item.href) ? 'active' : '';
    const adminCls = item.adminOnly ? ' admin-only' : '';
    return `
      <li class="nav-item${adminCls}">
        <a href="${item.href}" class="nav-link ${active} text-white px-3 py-2">
          <i class="bi ${item.icon} me-2"></i>${item.label}
        </a>
      </li>`;
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
      <ul class="nav flex-column flex-grow-1 mt-2 pb-3">${items}</ul>
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

  // Show who is signed in and apply role restrictions
  fetch('/api/auth/check').then(r => r.ok ? r.json() : null).then(data => {
    if (!data) return;
    window.appRole = data.role || 'admin';
    if (data.username) {
      const el = document.getElementById('sidebar-username');
      const roleLabel = window.appRole === 'viewer' ? ' (viewer)' : '';
      el.querySelector('span').textContent = `Signed in as ${data.username}${roleLabel}`;
      el.classList.remove('d-none');
    }
    if (window.appRole === 'viewer') {
      document.body.classList.add('role-viewer');
    }
    document.dispatchEvent(new CustomEvent('approleready', { detail: { role: window.appRole } }));
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
                    <input type="password" id="pw-new" class="form-control" required minlength="6">
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
