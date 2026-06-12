let allItems    = [];
let allCompanies = [];
let allContacts  = [];
let editingId    = null;
let displayItems   = [];
let currentPage    = 1;
const PAGE_SIZE    = 25;

const TODAY = new Date().toISOString().slice(0, 10);

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadCompanies(), loadContacts()]);
  await loadItems();

  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('filter-type').addEventListener('change', applyFilters);
  document.getElementById('filter-status').addEventListener('change', applyFilters);
  document.getElementById('filter-from').addEventListener('change', applyFilters);
  document.getElementById('filter-to').addEventListener('change', applyFilters);

  document.getElementById('btn-add').addEventListener('click', () => openModal(null));
  document.getElementById('outreach-form').addEventListener('submit', handleSave);
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
    allItems = await fetchAPI('/api/outreach');
    renderTable(allItems);
  } catch (err) {
    showToast('Failed to load outreach records: ' + err.message, 'danger');
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
  const type   = document.getElementById('filter-type').value;
  const status = document.getElementById('filter-status').value;
  const from   = document.getElementById('filter-from').value;
  const to     = document.getElementById('filter-to').value;

  let filtered = allItems.filter(r => {
    if (q && !r.CompanyName?.toLowerCase().includes(q) && !r.ContactName?.toLowerCase().includes(q)) return false;
    if (type   && r.InteractionType   !== type)   return false;
    if (status && r.InteractionStatus !== status) return false;
    if (from   && r.InteractionDate < from)        return false;
    if (to     && r.InteractionDate > to)          return false;
    return true;
  });
  displayItems = filtered; currentPage = 1; renderCurrentPage();
}

function isOverdue(row) {
  return row.FollowUpDate && row.FollowUpDate < TODAY && row.InteractionStatus === 'In-progress';
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
  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No records found. <a href="#" onclick="openModal(null);return false;">Add one</a>.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(r => {
    const statusBadge = r.InteractionStatus === 'Complete'
      ? '<span class="badge bg-success">Complete</span>'
      : '<span class="badge bg-warning text-dark">In-progress</span>';

    const followUp = r.FollowUpDate
      ? (isOverdue(r)
          ? `<span class="text-danger fw-semibold"><i class="bi bi-exclamation-circle me-1"></i>${r.FollowUpDate}</span>`
          : r.FollowUpDate)
      : '—';

    const typeBadge = {
      'Call': 'bg-info', 'Meeting': 'bg-primary', 'Company Visit': 'bg-secondary'
    }[r.InteractionType] || 'bg-secondary';

    return `<tr style="cursor:pointer" data-id="${r.OutreachEngagementID}">
      <td>${escHtml(r.CompanyName)}</td>
      <td>${escHtml(r.ContactName)}</td>
      <td><span class="badge ${typeBadge}">${escHtml(r.InteractionType)}</span></td>
      <td>${r.InteractionDate}</td>
      <td>${statusBadge}</td>
      <td>${followUp}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-primary me-1" title="Edit" onclick="event.stopPropagation();openModalById(${r.OutreachEngagementID})"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" title="Delete" onclick="event.stopPropagation();handleDeleteById(${r.OutreachEngagementID})"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => {
      const item = allItems.find(r => r.OutreachEngagementID == row.dataset.id);
      if (item) openModal(item);
    });
  });
}

function setLoading(on) {
  if (on) document.getElementById('tbody').innerHTML =
    `<tr><td colspan="7" class="text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div> Loading…</td></tr>`;
}

function openModalById(id) {
  const item = allItems.find(r => r.OutreachEngagementID == id);
  if (item) openModal(item);
}

function openModal(item) {
  editingId = item ? item.OutreachEngagementID : null;
  document.getElementById('outreach-form').reset();

  const isEdit = !!item;
  document.getElementById('modal-title').textContent = isEdit ? 'Edit Outreach Record' : 'Add Outreach Record';
  document.getElementById('btn-delete').classList.toggle('d-none', !isEdit);

  if (isEdit) {
    document.getElementById('f-company').value = item.CompanyID;
    updateContactDropdown(item.CompanyID, item.ContactID);
    document.getElementById('f-type').value          = item.InteractionType;
    document.getElementById('f-date').value          = item.InteractionDate;
    document.getElementById('f-discussion').value    = item.DiscussionItems || '';
    document.getElementById('f-action').value        = item.ActionPlan || '';
    document.getElementById('f-followup').value      = item.FollowUpDate || '';
    document.getElementById('f-status').value        = item.InteractionStatus || 'In-progress';
  } else {
    updateContactDropdown('');
    document.getElementById('f-date').value   = TODAY;
    document.getElementById('f-status').value = 'In-progress';
  }
  new bootstrap.Modal(document.getElementById('the-modal')).show();
}

async function handleSave(e) {
  e.preventDefault();
  if (!validateForm(document.getElementById('the-form'))) return;
  const payload = {
    CompanyID:         document.getElementById('f-company').value,
    ContactID:         document.getElementById('f-contact').value,
    InteractionType:   document.getElementById('f-type').value,
    InteractionDate:   document.getElementById('f-date').value,
    DiscussionItems:   document.getElementById('f-discussion').value.trim(),
    ActionPlan:        document.getElementById('f-action').value.trim(),
    FollowUpDate:      document.getElementById('f-followup').value,
    InteractionStatus: document.getElementById('f-status').value,
  };
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving…';
  try {
    if (editingId) {
      await fetchAPI(`/api/outreach/${editingId}`, { method: 'PUT', body: payload });
    } else {
      await fetchAPI('/api/outreach', { method: 'POST', body: payload });
    }
    bootstrap.Modal.getInstance(document.getElementById('the-modal')).hide();
    showToast('Record saved successfully');
    await loadItems();
  } catch (err) {
    showToast('Save failed: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Save';
  }
}

async function handleDelete() {
  if (!editingId) return;
  showConfirmModal('Delete Record', '<p>Delete this outreach record? This cannot be undone.</p>', async () => {
    try {
      bootstrap.Modal.getInstance(document.getElementById('the-modal'))?.hide();
      await fetchAPI(`/api/outreach/${editingId}`, { method: 'DELETE' });
      showToast('Record deleted', 'danger');
      await loadItems();
    } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
  });
}

async function handleDeleteById(id) {
  showConfirmModal('Delete Record', '<p>Delete this outreach record? This cannot be undone.</p>', async () => {
    try {
      await fetchAPI(`/api/outreach/${id}`, { method: 'DELETE' });
      showToast('Record deleted', 'danger');
      await loadItems();
    } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
  });
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
