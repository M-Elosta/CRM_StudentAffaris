let allItems     = [];
let allCompanies = [];
let allContacts  = [];
let editingId    = null;
let displayItems   = [];
let currentPage    = 1;
const PAGE_SIZE    = 25;

const ENGAGEMENT_TYPES = [
  'Guest Lecture',
  'Panel Discussion',
  'Community Project Partnership',
  'Mock Interviews',
  'Research Collaboration',
  'Competition/Hackathon Sponsorship',
  'Other'
];

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadCompanies(), loadContacts()]);
  await loadItems();

  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('filter-type').addEventListener('change', applyFilters);
  document.getElementById('filter-from').addEventListener('change', applyFilters);
  document.getElementById('filter-to').addEventListener('change', applyFilters);

  document.getElementById('btn-add').addEventListener('click', () => openModal(null));
  document.getElementById('academic-form').addEventListener('submit', handleSave);
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
    allItems = await fetchAPI('/api/academic');
    applyFilters();
  } catch (err) {
    showToast('Failed to load academic engagements: ' + err.message, 'danger');
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
  const q    = document.getElementById('search-input').value.toLowerCase();
  const type = document.getElementById('filter-type').value;
  const from = document.getElementById('filter-from').value;
  const to   = document.getElementById('filter-to').value;

  const filtered = allItems.filter(r => {
    if (q && !r.CompanyName?.toLowerCase().includes(q) && !r.GuestSpeakerName?.toLowerCase().includes(q)) return false;
    if (type && r.EngagementType !== type) return false;
    const sessionDate = r.SessionDate ? r.SessionDate.substring(0, 10) : '';
    if (from && sessionDate < from) return false;
    if (to   && sessionDate > to)   return false;
    return true;
  });
  displayItems = filtered; currentPage = 1; renderCurrentPage();
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
    const sessionDate = r.SessionDate ? r.SessionDate.substring(0, 10) : '—';
    return `<tr style="cursor:pointer" data-id="${r.EngagementID}">
      <td>${escHtml(r.CompanyName)}</td>
      <td><span class="badge bg-secondary">${escHtml(r.EngagementType)}</span></td>
      <td>${escHtml(r.GuestSpeakerName)}</td>
      <td>${escHtml(r.FacultyName)}</td>
      <td>${escHtml(r.CourseNumber)}${r.CourseTitle ? ' – ' + escHtml(r.CourseTitle) : ''}</td>
      <td>${sessionDate}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary me-1" title="Edit" onclick="event.stopPropagation();openModalById(${r.EngagementID})"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" title="Delete" onclick="event.stopPropagation();handleDeleteById(${r.EngagementID})"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => {
      const item = allItems.find(r => r.EngagementID == row.dataset.id);
      if (item) openModal(item);
    });
  });
}

function setLoading(on) {
  if (on) document.getElementById('tbody').innerHTML =
    `<tr><td colspan="7" class="text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div> Loading…</td></tr>`;
}

function openModalById(id) {
  const item = allItems.find(r => r.EngagementID == id);
  if (item) openModal(item);
}

function openModal(item) {
  editingId = item ? item.EngagementID : null;
  document.getElementById('academic-form').reset();

  const isEdit = !!item;
  document.getElementById('modal-title').textContent = isEdit ? 'Edit Academic Engagement' : 'Add Academic Engagement';
  document.getElementById('btn-delete').classList.toggle('d-none', !isEdit);

  if (isEdit) {
    document.getElementById('f-company').value      = item.CompanyID;
    updateContactDropdown(item.CompanyID, item.ContactID);
    document.getElementById('f-type').value         = item.EngagementType || '';
    document.getElementById('f-speaker').value      = item.GuestSpeakerName || '';
    document.getElementById('f-guest-title').value  = item.GuestTitle || '';
    document.getElementById('f-email').value        = item.Email || '';
    document.getElementById('f-phone').value        = item.PhoneNumber || '';
    document.getElementById('f-faculty').value      = item.FacultyName || '';
    document.getElementById('f-course-num').value   = item.CourseNumber || '';
    document.getElementById('f-course-title').value = item.CourseTitle || '';
    document.getElementById('f-topic').value        = item.TopicTheme || '';
    document.getElementById('f-session-date').value = item.SessionDate ? item.SessionDate.substring(0, 10) : '';
    document.getElementById('f-session-time').value = item.SessionTime || '';
    document.getElementById('f-comment').value      = item.Comment || '';
  } else {
    updateContactDropdown('');
  }
  new bootstrap.Modal(document.getElementById('the-modal')).show();
}

function formToPayload() {
  return {
    CompanyID:        document.getElementById('f-company').value,
    ContactID:        document.getElementById('f-contact').value,
    EngagementType:   document.getElementById('f-type').value,
    GuestSpeakerName: document.getElementById('f-speaker').value.trim(),
    GuestTitle:       document.getElementById('f-guest-title').value.trim(),
    Email:            document.getElementById('f-email').value.trim(),
    PhoneNumber:      document.getElementById('f-phone').value.trim(),
    FacultyName:      document.getElementById('f-faculty').value.trim(),
    CourseNumber:     document.getElementById('f-course-num').value.trim(),
    CourseTitle:      document.getElementById('f-course-title').value.trim(),
    TopicTheme:       document.getElementById('f-topic').value.trim(),
    SessionDate:      document.getElementById('f-session-date').value,
    SessionTime:      document.getElementById('f-session-time').value,
    Comment:          document.getElementById('f-comment').value.trim(),
  };
}

async function handleSave(e) {
  e.preventDefault();
  if (!validateForm(document.getElementById('the-form'))) return;
  const payload = formToPayload();
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving…';
  try {
    if (editingId) {
      await fetchAPI(`/api/academic/${editingId}`, { method: 'PUT', body: payload });
    } else {
      await fetchAPI('/api/academic', { method: 'POST', body: payload });
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
  showConfirmModal('Delete Academic Engagement', '<p>Delete this academic engagement record? This cannot be undone.</p>', async () => {
    try {
      bootstrap.Modal.getInstance(document.getElementById('the-modal'))?.hide();
      await fetchAPI(`/api/academic/${editingId}`, { method: 'DELETE' });
      showToast('Record deleted', 'danger');
      await loadItems();
    } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
  });
}

async function handleDeleteById(id) {
  showConfirmModal('Delete Academic Engagement', '<p>Delete this academic engagement record? This cannot be undone.</p>', async () => {
    try {
      await fetchAPI(`/api/academic/${id}`, { method: 'DELETE' });
      showToast('Record deleted', 'danger');
      await loadItems();
    } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
  });
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
