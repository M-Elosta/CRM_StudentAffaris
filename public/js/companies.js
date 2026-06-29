// ── State ──────────────────────────────────────────────────────────────────────
let allCompanies = [];
let editingId    = null;
let displayItems   = [];
let currentPage    = 1;
const PAGE_SIZE    = 25;

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadCompanies();

  bindDebouncedInput('search-input', e => {
    displayItems = filterCompanies(e.target.value.trim()); currentPage = 1; renderCurrentPage();
  });

  document.getElementById('btn-add').addEventListener('click', () => openModal(null));

  document.getElementById('company-form').addEventListener('submit', handleSave);

  document.getElementById('btn-delete').addEventListener('click', handleDelete);

  // Show/hide Pay Amount based on Blacklisted toggle label
  document.getElementById('f-blacklisted').addEventListener('change', e => {
    const warn = document.getElementById('blacklist-warning');
    warn.classList.toggle('d-none', !e.target.checked);
  });
});

// ── Data loading ───────────────────────────────────────────────────────────────
async function loadCompanies() {
  setTableLoading(true);
  try {
    allCompanies = await fetchAPI('/api/companies');
    displayItems = allCompanies; renderCurrentPage();
  } catch (err) {
    showToast('Failed to load companies: ' + err.message, 'danger');
  } finally {
    setTableLoading(false);
  }
}

function filterCompanies(q) {
  if (!q) return allCompanies;
  const lower = safeLower(q);
  return allCompanies.filter(c =>
    safeLower(c.CompanyName).includes(lower) ||
    safeLower(c.Country).includes(lower) ||
    safeLower(c.Industry).includes(lower) ||
    safeLower(c.Sector).includes(lower)
  );
}

// ── Table rendering ────────────────────────────────────────────────────────────
function renderCurrentPage() {
  const start = (currentPage - 1) * PAGE_SIZE;
  renderTable(displayItems.slice(start, start + PAGE_SIZE));
  updateRecordCountBadge(displayItems.length, allCompanies.length);

  let pEl = document.getElementById('pagination-controls');
  if (!pEl) {
    pEl = document.createElement('div');
    pEl.id = 'pagination-controls';
    pEl.className = 'mt-3';
    document.querySelector('.table-responsive')?.closest('.card')
      ?.insertAdjacentElement('afterend', pEl);
  }
  if (!pEl) return;
  const totalPages = Math.ceil(displayItems.length / PAGE_SIZE);
  pEl.innerHTML = totalPages > 1
    ? buildPaginationHtml(currentPage, totalPages, displayItems.length, PAGE_SIZE)
    : '';
  pEl.querySelectorAll('[data-page]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      currentPage = +a.dataset.page;
      renderCurrentPage();
      document.querySelector('.table-responsive')
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
}
function renderTable(companies) {
  const tbody = document.getElementById('companies-tbody');

  if (companies.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-muted py-4">
          No companies found. <a href="#" id="empty-add-link">Add your first company</a>.
        </td>
      </tr>`;
    document.getElementById('empty-add-link')?.addEventListener('click', e => {
      e.preventDefault();
      openModal(null);
    });
    return;
  }

  tbody.innerHTML = companies.map(c => {
    const flagBadges = [
      c.Blacklisted ? renderStatusBadge('Blacklisted') : '',
      c.SignedMoU ? renderSemanticBadge('MoU', 'good', { subtle: true, title: 'Signed memorandum of understanding' }) : '',
      c.FavoriteEmployer
        ? '<span class="entity-indicator entity-indicator-good" title="Favorite employer" aria-label="Favorite employer"><i class="bi bi-star-fill"></i></span>'
        : '',
    ].filter(Boolean).join('');
    const rowClass = c.Blacklisted ? 'table-secondary' : '';

    return `
      <tr class="${rowClass}" style="cursor:pointer" data-id="${c.CompanyID}">
        <td>
          <div class="name-with-flags">
            <span class="entity-name">${escHtml(c.CompanyName)}</span>
            ${flagBadges ? `<span class="badge-stack">${flagBadges}</span>` : ''}
          </div>
        </td>
        <td>${escHtml(c.Industry)}</td>
        <td>${escHtml(c.Sector)}</td>
        <td>${escHtml(c.Country)}</td>
        <td>${formatDate(c.DateAdded)}</td>
        <td>${c.Website ? `<a href="${escHtml(c.Website)}" target="_blank" rel="noopener" title="Open website in new tab" onclick="event.stopPropagation()"><i class="bi bi-box-arrow-up-right"></i></a>` : '—'}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-primary me-1" title="Edit" onclick="event.stopPropagation();openModal(allCompanies.find(x=>x.CompanyID==${c.CompanyID}))"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger" title="Delete" onclick="event.stopPropagation();handleDeleteById(${c.CompanyID})"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => {
      const company = allCompanies.find(c => c.CompanyID == row.dataset.id);
      if (company) openModal(company);
    });
  });
}

function setTableLoading(loading) {
  const tbody = document.getElementById('companies-tbody');
  if (loading) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div> Loading…</td></tr>`;
  }
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function openModal(company) {
  editingId = company ? company.CompanyID : null;

  const form = document.getElementById('company-form');
  form.reset();
  clearFormError(form);
  document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
  document.getElementById('blacklist-warning').classList.add('d-none');

  const title = document.getElementById('modal-title');
  const deleteBtn = document.getElementById('btn-delete');

  if (company) {
    title.textContent = 'Edit Company';
    deleteBtn.classList.remove('d-none');
    populateForm(company);
  } else {
    title.textContent = 'Add Company';
    deleteBtn.classList.add('d-none');
    // Default date to today
    document.getElementById('f-date-added').value = todayStr();
  }

  new bootstrap.Modal(document.getElementById('company-modal')).show();
}

function populateForm(c) {
  document.getElementById('f-name').value         = c.CompanyName || '';
  document.getElementById('f-date-added').value   = toDateInputValue(c.DateAdded) || todayStr();
  document.getElementById('f-industry').value     = c.Industry || '';
  document.getElementById('f-sector').value       = c.Sector || '';
  document.getElementById('f-country').value      = c.Country || '';
  document.getElementById('f-address').value      = c.Address || '';
  document.getElementById('f-website').value      = c.Website || '';
  document.getElementById('f-linkedin').value     = c.LinkedInURL || '';
  document.getElementById('f-handshake').value    = c.HandshakeURL || '';
  document.getElementById('f-mou').checked        = !!c.SignedMoU;
  document.getElementById('f-favorite').checked   = !!c.FavoriteEmployer;
  document.getElementById('f-blacklisted').checked = !!c.Blacklisted;
  document.getElementById('f-comment').value      = c.Comment || '';

  if (c.Blacklisted) {
    document.getElementById('blacklist-warning').classList.remove('d-none');
  }
}

function formToPayload() {
  return {
    CompanyName:     document.getElementById('f-name').value.trim(),
    DateAdded:       document.getElementById('f-date-added').value,
    Industry:        document.getElementById('f-industry').value.trim(),
    Sector:          document.getElementById('f-sector').value,
    Country:         document.getElementById('f-country').value.trim(),
    Address:         document.getElementById('f-address').value.trim(),
    Website:         document.getElementById('f-website').value.trim(),
    LinkedInURL:     document.getElementById('f-linkedin').value.trim(),
    HandshakeURL:    document.getElementById('f-handshake').value.trim(),
    SignedMoU:       document.getElementById('f-mou').checked,
    FavoriteEmployer:document.getElementById('f-favorite').checked,
    Blacklisted:     document.getElementById('f-blacklisted').checked,
    Comment:         document.getElementById('f-comment').value.trim(),
  };
}

// ── Save ───────────────────────────────────────────────────────────────────────
async function handleSave(e) {
  e.preventDefault();
  if (!validateForm(document.getElementById('company-form'))) return;
  const payload = formToPayload();
  const btn = document.getElementById('btn-save');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving…';

  try {
    if (editingId) {
      await fetchAPI(`/api/companies/${editingId}`, { method: 'PUT', body: payload });
    } else {
      await fetchAPI('/api/companies', { method: 'POST', body: payload });
    }
    bootstrap.Modal.getInstance(document.getElementById('company-modal')).hide();
    showToast('Record saved successfully');
    await loadCompanies();
  } catch (err) {
    showFormError('company-form', 'Save failed: ' + err.message);
    showToast('Save failed: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Save';
  }
}

// ── Delete ─────────────────────────────────────────────────────────────────────
async function handleDelete() {
  if (!editingId) return;

  try {
    const counts = await fetchAPI(`/api/companies/${editingId}/related-counts`);
    const parts = [];
    if (counts.contacts)     parts.push(`${counts.contacts} contact(s)`);
    if (counts.outreach)     parts.push(`${counts.outreach} outreach record(s)`);
    if (counts.recruitment)  parts.push(`${counts.recruitment} recruitment posting(s)`);
    if (counts.events)       parts.push(`${counts.events} career event(s)`);
    if (counts.academic)     parts.push(`${counts.academic} academic engagement(s)`);
    if (counts.studentEvents)parts.push(`${counts.studentEvents} student-led event(s)`);

    const detail = parts.length
      ? `<p class="text-danger mt-2 mb-0"><i class="bi bi-exclamation-triangle-fill me-1"></i>This will also permanently delete: ${parts.join(', ')}.</p>`
      : '';

    showConfirmModal(
      'Delete Company',
      `<p>Delete <strong>${escHtml(counts.companyName)}</strong>? This action cannot be undone.</p>${detail}`,
      async () => {
        try {
          bootstrap.Modal.getInstance(document.getElementById('company-modal'))?.hide();
          await fetchAPI(`/api/companies/${editingId}`, { method: 'DELETE' });
          showToast('Company deleted', 'danger');
          await loadCompanies();
        } catch (err) {
          showToast('Delete failed: ' + err.message, 'danger');
        }
      }
    );
  } catch (err) {
    showToast('Could not load company details: ' + err.message, 'danger');
  }
}

async function handleDeleteById(id) {
  try {
    const counts = await fetchAPI(`/api/companies/${id}/related-counts`);
    const parts = [];
    if (counts.contacts)      parts.push(`${counts.contacts} contact(s)`);
    if (counts.outreach)      parts.push(`${counts.outreach} outreach record(s)`);
    if (counts.recruitment)   parts.push(`${counts.recruitment} recruitment posting(s)`);
    if (counts.events)        parts.push(`${counts.events} career event(s)`);
    if (counts.academic)      parts.push(`${counts.academic} academic engagement(s)`);
    if (counts.studentEvents) parts.push(`${counts.studentEvents} student-led event(s)`);
    const detail = parts.length
      ? `<p class="text-danger mt-2 mb-0"><i class="bi bi-exclamation-triangle-fill me-1"></i>This will also permanently delete: ${parts.join(', ')}.</p>`
      : '';
    showConfirmModal('Delete Company',
      `<p>Delete <strong>${escHtml(counts.companyName)}</strong>? This action cannot be undone.</p>${detail}`,
      async () => {
        try {
          await fetchAPI(`/api/companies/${id}`, { method: 'DELETE' });
          showToast('Company deleted', 'danger');
          await loadCompanies();
        } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
      }
    );
  } catch (err) { showToast('Could not load company details: ' + err.message, 'danger'); }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function todayStr() {
  return todayISODate();
}

function formatDate(str) {
  return toDateDisplay(str);
}
