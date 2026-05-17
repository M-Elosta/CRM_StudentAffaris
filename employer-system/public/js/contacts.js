// ── State ──────────────────────────────────────────────────────────────────────
let allContacts  = [];
let allCompanies = [];
let editingId    = null;

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadCompanies(), loadContacts()]);

  document.getElementById('search-input').addEventListener('input', applyFilters);

  document.getElementById('filter-status').addEventListener('change', applyFilters);
  document.getElementById('filter-company').addEventListener('change', applyFilters);

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

  let filtered = filterContacts(q);
  if (status)    filtered = filtered.filter(c => c.Status === status);
  if (companyId) filtered = filtered.filter(c => String(c.CompanyID) === companyId);

  renderTable(filtered);
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
function renderTable(contacts) {
  const tbody = document.getElementById('contacts-tbody');

  if (contacts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center text-muted py-4">
          No contacts found. <a href="#" id="empty-add-link">Add your first contact</a>.
        </td>
      </tr>`;
    document.getElementById('empty-add-link')?.addEventListener('click', e => {
      e.preventDefault();
      openModal(null);
    });
    return;
  }

  tbody.innerHTML = contacts.map(c => {
    const statusBadge = c.Status === 'Mailable'
      ? '<span class="badge bg-success">Mailable</span>'
      : '<span class="badge bg-danger">Non-mailable</span>';

    const primaryBadge = c.PrimaryContact
      ? '<i class="bi bi-star-fill text-warning ms-1" title="Primary Contact"></i>'
      : '';

    const excludeBadge = c.ExcludeFromMailing
      ? '<span class="badge bg-warning text-dark ms-1">Excluded from Mailing</span>'
      : '';

    return `
      <tr style="cursor:pointer" data-id="${c.ContactID}">
        <td>${escHtml(c.LastName)}, ${escHtml(c.FirstName)}${primaryBadge}</td>
        <td>${escHtml(c.CompanyName || '—')}</td>
        <td>${escHtml(c.EmailAddress)}</td>
        <td>${escHtml(c.JobTitle || '—')}</td>
        <td>${statusBadge}${excludeBadge}</td>
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
      `<tr><td colspan="5" class="text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div> Loading…</td></tr>`;
  }
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function openModal(contact) {
  editingId = contact ? contact.ContactID : null;

  const form = document.getElementById('contact-form');
  form.reset();
  document.getElementById('cmuq-fields').classList.add('d-none');

  const title     = document.getElementById('modal-title');
  const deleteBtn = document.getElementById('btn-delete');

  if (contact) {
    title.textContent = 'Edit Contact';
    deleteBtn.classList.remove('d-none');
    populateForm(contact);
  } else {
    title.textContent = 'Add Contact';
    deleteBtn.classList.add('d-none');
    document.getElementById('f-date-added').value = todayStr();
    document.getElementById('f-status').checked = true;
  }

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
  const payload = formToPayload();
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
    showToast('Save failed: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Save';
  }
}

// ── Delete ─────────────────────────────────────────────────────────────────────
async function handleDelete() {
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

function updateRecordCount(shown, total) {
  const el = document.getElementById('record-count');
  if (!el) return;
  el.textContent = shown === total ? `${total} record${total !== 1 ? 's' : ''}` : `${shown} of ${total}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
