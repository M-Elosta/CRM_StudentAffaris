// ── State ──────────────────────────────────────────────────────────────────────
let allContacts  = [];
let allCompanies = [];
let editingId    = null;
let editingUpdatedAt = null;
let displayItems   = [];
let currentPage    = 1;
const PAGE_SIZE    = 25;

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadCompanies(), loadContacts()]);

  document.getElementById('search-input').addEventListener('input', debounce(applyFilters, 300));

  document.getElementById('filter-status').addEventListener('change', applyFilters);
  document.getElementById('filter-company').addEventListener('change', applyFilters);
  document.getElementById('filter-from').addEventListener('change', applyFilters);
  document.getElementById('filter-to').addEventListener('change', applyFilters);

  document.getElementById('btn-add').addEventListener('click', () => openModal(null));

  document.getElementById('contact-form').addEventListener('submit', handleSave);

  document.getElementById('btn-delete').addEventListener('click', handleDelete);

  // CMU-Q Graduate toggle reveals Major + Graduation Year
  document.getElementById('f-cmuq').addEventListener('change', e => {
    document.getElementById('cmuq-fields').classList.toggle('d-none', !e.target.checked);
  });
});

// ── Data loading ───────────────────────────────────────────────────────────────
async function loadCompanies() {
  try {
    allCompanies = await fetchAPI('/api/companies');
    populateCompanyDropdowns();
  } catch (err) {
    showToast('Failed to load companies: ' + err.message, 'danger');
  }
}

async function loadContacts() {
  setTableLoading(true);
  try {
    allContacts = await fetchAPI('/api/contacts');
    applyFilters();
  } catch (err) {
    showToast('Failed to load contacts: ' + err.message, 'danger');
  } finally {
    setTableLoading(false);
  }
}

function populateCompanyDropdowns() {
  // Form modal dropdown
  const formSelect = document.getElementById('f-company');
  formSelect.innerHTML = '<option value="">Select company… *</option>' +
    allCompanies.map(c =>
      `<option value="${c.CompanyID}">${escHtml(c.CompanyName)}</option>`
    ).join('');

  // Filter bar dropdown
  const filterSelect = document.getElementById('filter-company');
  filterSelect.innerHTML = '<option value="">All companies</option>' +
    allCompanies.map(c =>
      `<option value="${c.CompanyID}">${escHtml(c.CompanyName)}</option>`
    ).join('');
}

function applyFilters() {
  const q         = document.getElementById('search-input').value.trim();
  const status    = document.getElementById('filter-status').value;
  const companyId = document.getElementById('filter-company').value;
  const from      = document.getElementById('filter-from').value;
  const to        = document.getElementById('filter-to').value;

  let filtered = filterContacts(q);
  if (status)    filtered = filtered.filter(c => c.Status === status);
  if (companyId) filtered = filtered.filter(c => String(c.CompanyID) === companyId);
  if (from)      filtered = filtered.filter(c => (c.DateAdded || '').slice(0, 10) >= from);
  if (to)        filtered = filtered.filter(c => (c.DateAdded || '').slice(0, 10) <= to);

  displayItems = filtered; currentPage = 1; renderCurrentPage();
  updateRecordCount(filtered.length, allContacts.length);
}

function filterContacts(q) {
  if (!q) return allContacts;
  const lower = q.toLowerCase();
  return allContacts.filter(c =>
    c.FirstName.toLowerCase().includes(lower) ||
    c.LastName.toLowerCase().includes(lower)  ||
    (c.EmailAddress || '').toLowerCase().includes(lower)
  );
}

// ── Table rendering ────────────────────────────────────────────────────────────
function renderCurrentPage() {
  const start = (currentPage - 1) * PAGE_SIZE;
  renderTable(displayItems.slice(start, start + PAGE_SIZE));

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
function renderTable(contacts) {
  const tbody = document.getElementById('contacts-tbody');

  if (contacts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-muted py-4">
          No records found. <a href="#" id="empty-add-link">Add one</a>.
        </td>
      </tr>`;
    document.getElementById('empty-add-link')?.addEventListener('click', e => {
      e.preventDefault();
      openModal(null);
    });
    return;
  }

  tbody.innerHTML = contacts.map(c => {
    const badges = [
      statusBadge(c.Status, BADGE_STYLES.contactStatus),
      c.PrimaryContact ? statusBadge('Primary', { Primary: 'bg-warning text-dark' }) : '',
      c.ExcludeFromMailing ? statusBadge('Excluded from Mailing', BADGE_STYLES.contactStatus) : '',
    ].filter(Boolean).join(' ');

    return `
      <tr style="cursor:pointer" data-id="${c.ContactID}">
        <td>${escHtml(c.LastName)}, ${escHtml(c.FirstName)}</td>
        <td>${escHtml(c.CompanyName || '—')}</td>
        <td>${escHtml(c.EmailAddress)}</td>
        <td>${escHtml(c.JobTitle || '—')}</td>
        <td><div class="d-flex flex-wrap gap-1">${badges}</div></td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-primary me-1" title="Edit" onclick="event.stopPropagation();openModalById(${c.ContactID})"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger" title="Delete" onclick="event.stopPropagation();handleDeleteById(${c.ContactID})"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => {
      const contact = allContacts.find(c => c.ContactID == row.dataset.id);
      if (contact) openModal(contact);
    });
  });
}

function setTableLoading(loading) {
  if (loading) {
    document.getElementById('contacts-tbody').innerHTML =
      `<tr><td colspan="6" class="text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div> Loading…</td></tr>`;
  }
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function openModalById(id) {
  const contact = allContacts.find(c => c.ContactID == id);
  if (contact) openModal(contact);
}

function openModal(contact) {
  editingId = contact ? contact.ContactID : null;
  editingUpdatedAt = contact?.UpdatedAt || null;

  const form = document.getElementById('contact-form');
  form.reset();
  clearFormError(form);
  document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
  document.getElementById('cmuq-fields').classList.add('d-none');

  const title     = document.getElementById('modal-title');
  const deleteBtn = document.getElementById('btn-delete');
  const saveBtn = document.getElementById('btn-save');
  const readOnly = isViewerRole();

  if (contact) {
    title.textContent = readOnly ? 'View Contact' : 'Edit Contact';
    deleteBtn.classList.toggle('d-none', readOnly);
    populateForm(contact);
  } else {
    title.textContent = readOnly ? 'View Contact' : 'Add Contact';
    deleteBtn.classList.add('d-none');
    document.getElementById('f-date-added').value = todayStr();
    document.getElementById('f-status').checked = true;
  }

  saveBtn.classList.toggle('d-none', readOnly);
  saveBtn.disabled = readOnly;
  setFormReadOnly(form, readOnly);

  new bootstrap.Modal(document.getElementById('contact-modal')).show();
}

function populateForm(c) {
  document.getElementById('f-company').value     = c.CompanyID || '';
  document.getElementById('f-firstname').value   = c.FirstName || '';
  document.getElementById('f-lastname').value    = c.LastName || '';
  document.getElementById('f-email').value       = c.EmailAddress || '';
  document.getElementById('f-date-added').value  = c.DateAdded ? c.DateAdded.slice(0,10) : todayStr();
  document.getElementById('f-workphone').value   = c.WorkPhone || '';
  document.getElementById('f-mobile').value      = c.Mobile || '';
  document.getElementById('f-jobtitle').value    = c.JobTitle || '';
  document.getElementById('f-country').value     = c.Country || '';
  document.getElementById('f-address').value     = c.Address || '';
  document.getElementById('f-linkedin').value    = c.LinkedInURL || '';
  document.getElementById('f-handshake').value   = c.HandshakeURL || '';
  document.getElementById('f-cmuq').checked      = !!c.CMUQGraduate;
  document.getElementById('f-major').value       = c.Major || '';
  document.getElementById('f-gradyear').value    = c.GraduationYear || '';
  document.getElementById('f-primary').checked   = !!c.PrimaryContact;
  document.getElementById('f-status').checked    = (c.Status !== 'Non-mailable');
  document.getElementById('f-resumebook').checked     = !!c.ResumeBook;
  document.getElementById('f-eventinvite').checked    = !!c.EventInvitation;
  document.getElementById('f-excludemail').checked    = !!c.ExcludeFromMailing;

  if (c.CMUQGraduate) {
    document.getElementById('cmuq-fields').classList.remove('d-none');
  }
}

function formToPayload() {
  return {
    CompanyID:          document.getElementById('f-company').value,
    FirstName:          document.getElementById('f-firstname').value.trim(),
    LastName:           document.getElementById('f-lastname').value.trim(),
    EmailAddress:       document.getElementById('f-email').value.trim(),
    DateAdded:          document.getElementById('f-date-added').value,
    WorkPhone:          document.getElementById('f-workphone').value.trim(),
    Mobile:             document.getElementById('f-mobile').value.trim(),
    JobTitle:           document.getElementById('f-jobtitle').value.trim(),
    Country:            document.getElementById('f-country').value.trim(),
    Address:            document.getElementById('f-address').value.trim(),
    LinkedInURL:        document.getElementById('f-linkedin').value.trim(),
    HandshakeURL:       document.getElementById('f-handshake').value.trim(),
    CMUQGraduate:       document.getElementById('f-cmuq').checked,
    Major:              document.getElementById('f-major').value.trim(),
    GraduationYear:     document.getElementById('f-gradyear').value,
    PrimaryContact:     document.getElementById('f-primary').checked,
    Status:             document.getElementById('f-status').checked ? 'Mailable' : 'Non-mailable',
    ResumeBook:         document.getElementById('f-resumebook').checked,
    EventInvitation:    document.getElementById('f-eventinvite').checked,
    ExcludeFromMailing: document.getElementById('f-excludemail').checked,
  };
}

// ── Save ───────────────────────────────────────────────────────────────────────
async function handleSave(e) {
  e.preventDefault();
  if (isViewerRole()) return showToast('Viewers cannot make changes. Contact an admin.', 'danger');
  if (!validateForm(document.getElementById('contact-form'))) return;
  const payload = formToPayload();
  if (editingId) payload.UpdatedAt = editingUpdatedAt;
  const btn = document.getElementById('btn-save');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving…';

  try {
    if (editingId) {
      await fetchAPI(`/api/contacts/${editingId}`, { method: 'PUT', body: payload });
    } else {
      await fetchAPI('/api/contacts', { method: 'POST', body: payload });
    }
    bootstrap.Modal.getInstance(document.getElementById('contact-modal')).hide();
    showToast('Record saved successfully');
    await loadContacts();
  } catch (err) {
    showFormError('contact-form', err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Save';
  }
}

// ── Delete ─────────────────────────────────────────────────────────────────────
async function handleDeleteById(id) {
  const contact = allContacts.find(c => c.ContactID == id);
  const name = contact ? `${contact.FirstName} ${contact.LastName}` : 'this contact';
  showConfirmModal('Delete Contact',
    `<p>Delete <strong>${escHtml(name)}</strong>? This will also remove all their outreach and engagement records.</p>
     <p class="text-danger mb-0"><i class="bi bi-exclamation-triangle-fill me-1"></i>This action cannot be undone.</p>`,
    async () => {
      try {
        await fetchAPI(`/api/contacts/${id}`, { method: 'DELETE' });
        showToast('Contact deleted', 'danger');
        await loadContacts();
      } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
    }
  );
}

async function handleDelete() {
  if (isViewerRole()) return showToast('Viewers cannot make changes. Contact an admin.', 'danger');
  if (!editingId) return;
  const contact = allContacts.find(c => c.ContactID === editingId);
  const name = contact ? `${contact.FirstName} ${contact.LastName}` : 'this contact';

  showConfirmModal(
    'Delete Contact',
    `<p>Delete <strong>${escHtml(name)}</strong>? This will also remove all their outreach and engagement records.</p>
     <p class="text-danger mb-0"><i class="bi bi-exclamation-triangle-fill me-1"></i>This action cannot be undone.</p>`,
    async () => {
      try {
        bootstrap.Modal.getInstance(document.getElementById('contact-modal'))?.hide();
        await fetchAPI(`/api/contacts/${editingId}`, { method: 'DELETE' });
        showToast('Contact deleted', 'danger');
        await loadContacts();
      } catch (err) {
        showToast('Delete failed: ' + err.message, 'danger');
      }
    }
  );
}
