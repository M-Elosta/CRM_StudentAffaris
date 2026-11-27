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
  document.getElementById('filter-status').addEventListener('change', applyFilters);
  document.getElementById('filter-from').addEventListener('change', applyFilters);
  document.getElementById('filter-to').addEventListener('change', applyFilters);

  document.getElementById('btn-add').addEventListener('click', () => openModal(null));
  document.getElementById('career-events-form').addEventListener('submit', handleSave);
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
    allItems = await fetchAPI('/api/career-events');
    applyFilters();
  } catch (err) {
    showToast('Failed to load career events: ' + err.message, 'danger');
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
  const q      = document.getElementById('search-input').value.toLowerCase();
  const status = document.getElementById('filter-status').value;
  const from   = document.getElementById('filter-from').value;
  const to     = document.getElementById('filter-to').value;

  const filtered = allItems.filter(r => {
    if (q && !r.CompanyName?.toLowerCase().includes(q) && !r.EventName?.toLowerCase().includes(q)) return false;
    if (status && r.RegisteredStatus !== status) return false;
    const eventDate = r.EventDate ? r.EventDate.substring(0, 10) : '';
    if (from && eventDate < from) return false;
    if (to   && eventDate > to)   return false;
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
    const alumniBooth = r.CMUQAlumniAtBooth ? '&#10003;' : '&mdash;';

    return `<tr style="cursor:pointer" data-id="${r.CareerEventID}">
      <td>${escHtml(r.CompanyName)}</td>
      <td>${escHtml(r.ContactName)}</td>
      <td>${escHtml(r.EventName)}</td>
      <td>${formatDate(r.EventDate)}</td>
      <td>${statusBadge(r.RegisteredStatus, BADGE_STYLES.careerEventStatus)}</td>
      <td class="text-center">${alumniBooth}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-primary me-1" title="Edit" onclick="event.stopPropagation();openModalById(${r.CareerEventID})"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" title="Delete" onclick="event.stopPropagation();handleDeleteById(${r.CareerEventID})"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => {
      const item = allItems.find(r => r.CareerEventID == row.dataset.id);
      if (item) openModal(item);
    });
  });
}

function setLoading(on) {
  if (on) document.getElementById('tbody').innerHTML =
    `<tr><td colspan="7" class="text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div> Loading…</td></tr>`;
}

function openModalById(id) {
  const item = allItems.find(r => r.CareerEventID == id);
  if (item) openModal(item);
}

function openModal(item) {
  editingId = item ? item.CareerEventID : null;
  editingUpdatedAt = item?.UpdatedAt || null;
  const form = document.getElementById('career-events-form');
  form.reset();
  clearFormError(form);

  const isEdit = !!item;
  const readOnly = isViewerRole();
  document.getElementById('modal-title').textContent = readOnly ? 'View Career Event' : (isEdit ? 'Edit Career Event' : 'Add Career Event');
  document.getElementById('btn-delete').classList.toggle('d-none', !isEdit || readOnly);

  if (isEdit) {
    document.getElementById('f-company').value   = item.CompanyID;
    updateContactDropdown(item.CompanyID, item.ContactID);
    document.getElementById('f-name').value      = item.EventName || '';
    document.getElementById('f-date').value      = item.EventDate ? item.EventDate.substring(0, 10) : '';
    document.getElementById('f-status').value    = item.RegisteredStatus || 'Attended';
    document.getElementById('f-alumni').checked  = !!item.CMUQAlumniAtBooth;
    document.getElementById('f-comment').value   = item.Comment || '';
  } else {
    updateContactDropdown('');
    document.getElementById('f-date').value = todayStr();
    document.getElementById('f-status').value = 'Attended';
  }
  document.getElementById('btn-save').classList.toggle('d-none', readOnly);
  document.getElementById('btn-save').disabled = readOnly;
  setFormReadOnly(form, readOnly);
  new bootstrap.Modal(document.getElementById('the-modal')).show();
}

function formToPayload() {
  return {
    CompanyID:         document.getElementById('f-company').value,
    ContactID:         document.getElementById('f-contact').value,
    EventName:         document.getElementById('f-name').value.trim(),
    EventDate:         document.getElementById('f-date').value,
    RegisteredStatus:  document.getElementById('f-status').value,
    CMUQAlumniAtBooth: document.getElementById('f-alumni').checked,
    Comment:           document.getElementById('f-comment').value.trim(),
  };
}

async function handleSave(e) {
  e.preventDefault();
  if (isViewerRole()) return showToast('Viewers cannot make changes. Contact an admin.', 'danger');
  if (!validateForm(document.getElementById('career-events-form'))) return;
  const payload = formToPayload();
  if (editingId) payload.UpdatedAt = editingUpdatedAt;
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving…';
  try {
    if (editingId) {
      await fetchAPI(`/api/career-events/${editingId}`, { method: 'PUT', body: payload });
    } else {
      await fetchAPI('/api/career-events', { method: 'POST', body: payload });
    }
    bootstrap.Modal.getInstance(document.getElementById('the-modal')).hide();
    showToast('Record saved successfully');
    await loadItems();
  } catch (err) {
    showFormError('career-events-form', err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Save';
  }
}

async function handleDelete() {
  if (isViewerRole()) return showToast('Viewers cannot make changes. Contact an admin.', 'danger');
  if (!editingId) return;
  showConfirmModal('Delete Career Event', '<p>Delete this career event record? This cannot be undone.</p>', async () => {
    try {
      bootstrap.Modal.getInstance(document.getElementById('the-modal'))?.hide();
      await fetchAPI(`/api/career-events/${editingId}`, { method: 'DELETE' });
      showToast('Record deleted', 'danger');
      await loadItems();
    } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
  });
}

async function handleDeleteById(id) {
  showConfirmModal('Delete Career Event', '<p>Delete this career event record? This cannot be undone.</p>', async () => {
    try {
      await fetchAPI(`/api/career-events/${id}`, { method: 'DELETE' });
      showToast('Record deleted', 'danger');
      await loadItems();
    } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
  });
}
