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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Toast notification ─────────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const id = 'toast-' + Date.now();
  const bgClass = type === 'success' ? 'bg-success' : type === 'danger' ? 'bg-danger' : 'bg-warning';

  const html = `
    <div id="${id}" class="toast align-items-center text-white ${bgClass} border-0" role="alert" aria-live="assertive">
      <div class="d-flex">
        <div class="toast-body fw-semibold">${message}</div>
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
  { href: '/pages/import.html',         icon: 'bi-upload',                 label: 'Data Import' },
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
    return `
      <li class="nav-item">
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
}

document.addEventListener('DOMContentLoaded', injectSidebar);
