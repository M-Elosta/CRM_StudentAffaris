let allItems     = [];
let allCompanies = [];
let allContacts  = [];
let editingId    = null;
let editingUpdatedAt = null;
let displayItems   = [];
let currentPage    = 1;
const PAGE_SIZE    = 25;

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadCompanies(), loadContacts()]);
  await loadItems();

  document.getElementById('search-input').addEventListener('input', debounce(applyFilters, 300));
  document.getElementById('filter-outcome').addEventListener('change', applyFilters);
  document.getElementById('filter-from').addEventListener('change', applyFilters);
  document.getElementById('filter-to').addEventListener('change', applyFilters);

  document.getElementById('btn-add').addEventListener('click', () => openModal(null));
  document.getElementById('student-events-form').addEventListener('submit', handleSave);
  document.getElementById('btn-delete').addEventListener('click', handleDelete);

  document.getElementById('f-company').addEventListener('change', e => {
    updateContactDropdown(e.target.value);
  });
});

async function loadCompanies() {
  try {
    allCompanies = await fetchAPI('/api/companies');
    const sel = document.getElementById('f-company');
    sel.innerHTML = '<option value="">Select company… *</option>' +
      allCompanies.map(c => `<option value="${c.CompanyID}">${escHtml(c.CompanyName)}</option>`).join('');
  } catch (err) { showToast('Failed to load companies: ' + err.message, 'danger'); }
}

async function loadContacts() {
  try {
    allContacts = await fetchAPI('/api/contacts');
  } catch (err) { showToast('Failed to load contacts: ' + err.message, 'danger'); }
}

async function loadItems() {
  setLoading(true);
  try {
    allItems = await fetchAPI('/api/student-events');
    applyFilters();
  } catch (err) {
    showToast('Failed to load student-led events: ' + err.message, 'danger');
  } finally { setLoading(false); }
}

function updateContactDropdown(companyId, selectedId = null) {
  const sel = document.getElementById('f-contact');
  const filtered = companyId
    ? allContacts.filter(c => String(c.CompanyID) === String(companyId))
    : allContacts;
  sel.innerHTML = '<option value="">Select contact… *</option>' +
    filtered.map(c =>
      `<option value="${c.ContactID}" ${String(c.ContactID) === String(selectedId) ? 'selected' : ''}>
        ${escHtml(c.FirstName + ' ' + c.LastName)}
      </option>`
    ).join('');
}

function applyFilters() {
  const q       = document.getElementById('search-input').value.toLowerCase();
  const outcome = document.getElementById('filter-outcome').value;
  const from    = document.getElementById('filter-from').value;
  const to      = document.getElementById('filter-to').value;

  const filtered = allItems.filter(r => {
    if (q && !r.CompanyName?.toLowerCase().includes(q) &&
            !r.StudentName?.toLowerCase().includes(q) &&
            !r.OrganizationName?.toLowerCase().includes(q)) return false;
    if (outcome && r.CollaborationOutcome !== outcome) return false;
    const proposalDate = r.ProposalDate ? r.ProposalDate.substring(0, 10) : '';
    if (from && proposalDate < from) return false;
    if (to   && proposalDate > to)   return false;
    return true;
  });
  displayItems = filtered; currentPage = 1; renderCurrentPage();
  updateRecordCount(filtered.length, allItems.length);
}

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
function renderTable(items) {
  const tbody = document.getElementById('tbody');
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No records found. <a href="#" onclick="openModal(null);return false;">Add one</a>.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(r => {
    const outcomeBadge = renderStatusBadge(r.CollaborationOutcome);
    const proposalDate = toDateDisplay(r.ProposalDate);
    return `<tr style="cursor:pointer" data-id="${r.StudentLedEventID}">
      <td>${escHtml(r.CompanyName)}</td>
      <td>${escHtml(r.OrganizationName)}</td>
      <td>${escHtml(r.StudentName)}</td>
      <td>${proposalDate}</td>
      <td>${escHtml(r.EventTitle || '—')}</td>
      <td>${outcomeBadge}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary me-1" title="Edit" onclick="event.stopPropagation();openModalById(${r.StudentLedEventID})"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" title="Delete" onclick="event.stopPropagation();handleDeleteById(${r.StudentLedEventID})"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => {
      const item = allItems.find(r => r.StudentLedEventID == row.dataset.id);
      if (item) openModal(item);
    });
  });
}

function setLoading(on) {
  if (on) document.getElementById('tbody').innerHTML =
    `<tr><td colspan="7" class="text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div> Loading…</td></tr>`;
}

function openModalById(id) {
  const item = allItems.find(r => r.StudentLedEventID == id);
  if (item) openModal(item);
}

function openModal(item) {
  editingId = item ? item.StudentLedEventID : null;
  editingUpdatedAt = item?.UpdatedAt || null;
  const form = document.getElementById('student-events-form');
  form.reset();
  clearFormError(form);

  const isEdit = !!item;
  const readOnly = isViewerRole();
  document.getElementById('modal-title').textContent = readOnly ? 'View Student-Led Event' : (isEdit ? 'Edit Student-Led Event' : 'Add Student-Led Event');
  document.getElementById('btn-delete').classList.toggle('d-none', !isEdit || readOnly);

  if (isEdit) {
    document.getElementById('f-company').value        = item.CompanyID;
    updateContactDropdown(item.CompanyID, item.ContactID);
    document.getElementById('f-proposal-date').value  = item.ProposalDate ? item.ProposalDate.substring(0, 10) : '';
    document.getElementById('f-org').value             = item.OrganizationName || '';
    document.getElementById('f-student-name').value   = item.StudentName || '';
    document.getElementById('f-student-email').value  = item.StudentEmail || '';
    document.getElementById('f-student-phone').value  = item.StudentPhoneNumber || '';
    document.getElementById('f-outcome').value         = item.CollaborationOutcome || 'Pending';
    document.getElementById('f-event-date').value     = item.EventDate ? item.EventDate.substring(0, 10) : '';
    document.getElementById('f-event-title').value    = item.EventTitle || '';
    document.getElementById('f-comment').value         = item.Comment || '';
  } else {
    updateContactDropdown('');
    document.getElementById('f-outcome').value = 'Pending';
  }
  document.getElementById('btn-save').classList.toggle('d-none', readOnly);
  document.getElementById('btn-save').disabled = readOnly;
  setFormReadOnly(form, readOnly);
  new bootstrap.Modal(document.getElementById('the-modal')).show();
}

function formToPayload() {
  return {
    CompanyID:            document.getElementById('f-company').value,
    ContactID:            document.getElementById('f-contact').value,
    ProposalDate:         document.getElementById('f-proposal-date').value,
    OrganizationName:     document.getElementById('f-org').value.trim(),
    StudentName:          document.getElementById('f-student-name').value.trim(),
    StudentEmail:         document.getElementById('f-student-email').value.trim(),
    StudentPhoneNumber:   document.getElementById('f-student-phone').value.trim(),
    CollaborationOutcome: document.getElementById('f-outcome').value,
    EventDate:            document.getElementById('f-event-date').value || null,
    EventTitle:           document.getElementById('f-event-title').value.trim() || null,
    Comment:              document.getElementById('f-comment').value.trim() || null,
  };
}

async function handleSave(e) {
  e.preventDefault();
  if (isViewerRole()) return showToast('Viewers cannot make changes. Contact an admin.', 'danger');
  if (!validateForm(document.getElementById('student-events-form'))) return;
  const payload = formToPayload();
  if (editingId) payload.UpdatedAt = editingUpdatedAt;
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving…';
  try {
    if (editingId) {
      await fetchAPI(`/api/student-events/${editingId}`, { method: 'PUT', body: payload });
    } else {
      await fetchAPI('/api/student-events', { method: 'POST', body: payload });
    }
    bootstrap.Modal.getInstance(document.getElementById('the-modal')).hide();
    showToast('Record saved successfully');
    await loadItems();
  } catch (err) {
    showFormError('student-events-form', err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Save';
  }
}

async function handleDelete() {
  if (isViewerRole()) return showToast('Viewers cannot make changes. Contact an admin.', 'danger');
  if (!editingId) return;
  showConfirmModal('Delete Student-Led Event', '<p>Delete this student-led event record? This cannot be undone.</p>', async () => {
    try {
      bootstrap.Modal.getInstance(document.getElementById('the-modal'))?.hide();
      await fetchAPI(`/api/student-events/${editingId}`, { method: 'DELETE' });
      showToast('Record deleted', 'danger');
      await loadItems();
    } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
  });
}

async function handleDeleteById(id) {
  showConfirmModal('Delete Student-Led Event', '<p>Delete this student-led event record? This cannot be undone.</p>', async () => {
    try {
      await fetchAPI(`/api/student-events/${id}`, { method: 'DELETE' });
      showToast('Record deleted', 'danger');
      await loadItems();
    } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
  });
}
