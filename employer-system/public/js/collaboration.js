let allItems     = [];
let allCompanies = [];
let editingId    = null;

const COLLABORATION_OPPS = [
  'Intern/Graduate Hiring',
  'Career Events',
  'Mentorship Programs',
  'Mock Interviews',
  'Guest Speakers/Panelists',
  'Workshops/Training Sessions',
  'Company/Site Visits',
  'Community Project Partnership',
  'Student-Led Events',
  'Case Studies',
  'Research Partnership',
  'Competition/Hackathon Sponsorship',
  'Student Sponsorship',
  'MoU Signing',
  'Other'
];

document.addEventListener('DOMContentLoaded', async () => {
  buildOpportunitiesCheckboxes();
  await loadCompanies();
  await loadItems();

  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('btn-add').addEventListener('click', () => openModal(null));
  document.getElementById('collaboration-form').addEventListener('submit', handleSave);
  document.getElementById('btn-delete').addEventListener('click', handleDelete);
});

function buildOpportunitiesCheckboxes() {
  const container = document.getElementById('chk-opps');
  container.innerHTML = COLLABORATION_OPPS.map((v, i) => `
    <div class="form-check form-check-inline">
      <input class="form-check-input" type="checkbox" id="opp-${i}" value="${escHtml(v)}" name="opp">
      <label class="form-check-label" for="opp-${i}">${escHtml(v)}</label>
    </div>`).join('');
}

function getCheckedOpps() {
  return [...document.querySelectorAll('input[name="opp"]:checked')].map(el => el.value);
}

function setCheckedOpps(values) {
  document.querySelectorAll('input[name="opp"]').forEach(el => {
    el.checked = (values || []).includes(el.value);
  });
}

async function loadCompanies() {
  try {
    allCompanies = await fetchAPI('/api/companies');
    const sel = document.getElementById('f-company');
    sel.innerHTML = '<option value="">Select company… *</option>' +
      allCompanies.map(c => `<option value="${c.CompanyID}">${escHtml(c.CompanyName)}</option>`).join('');
  } catch (err) { showToast('Failed to load companies: ' + err.message, 'danger'); }
}

async function loadItems() {
  setLoading(true);
  try {
    allItems = await fetchAPI('/api/collaboration');
    applyFilters();
  } catch (err) {
    showToast('Failed to load collaboration records: ' + err.message, 'danger');
  } finally { setLoading(false); }
}

function applyFilters() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const filtered = allItems.filter(r => {
    if (q && !r.CompanyName?.toLowerCase().includes(q)) return false;
    return true;
  });
  renderTable(filtered);
}

function renderTable(items) {
  const tbody = document.getElementById('tbody');
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">No records found. <a href="#" onclick="openModal(null);return false;">Add one</a>.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(r => {
    const opps = Array.isArray(r.Opportunities) ? r.Opportunities.join(', ') : (r.Opportunities || '');
    return `<tr style="cursor:pointer" data-id="${r.PotentialCollaborationID}">
      <td>${escHtml(r.CompanyName)}</td>
      <td>${escHtml(opps)}</td>
      <td style="max-width:200px" class="text-truncate">${escHtml(r.Comment)}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary me-1" onclick="event.stopPropagation();openModalById(${r.PotentialCollaborationID})"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation();handleDeleteById(${r.PotentialCollaborationID})"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => {
      const item = allItems.find(r => r.PotentialCollaborationID == row.dataset.id);
      if (item) openModal(item);
    });
  });
}

function setLoading(on) {
  if (on) document.getElementById('tbody').innerHTML =
    `<tr><td colspan="4" class="text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div> Loading…</td></tr>`;
}

function openModalById(id) {
  const item = allItems.find(r => r.PotentialCollaborationID == id);
  if (item) openModal(item);
}

function openModal(item) {
  editingId = item ? item.PotentialCollaborationID : null;
  document.getElementById('collaboration-form').reset();
  document.querySelectorAll('input[name="opp"]').forEach(el => el.checked = false);

  const isEdit = !!item;
  document.getElementById('modal-title').textContent = isEdit ? 'Edit Collaboration' : 'Add Collaboration';
  document.getElementById('btn-delete').classList.toggle('d-none', !isEdit);

  if (isEdit) {
    document.getElementById('f-company').value = item.CompanyID;
    setCheckedOpps(item.Opportunities);
    document.getElementById('f-comment').value = item.Comment || '';
  }
  new bootstrap.Modal(document.getElementById('the-modal')).show();
}

function formToPayload() {
  return {
    CompanyID:     document.getElementById('f-company').value,
    Opportunities: getCheckedOpps(),
    Comment:       document.getElementById('f-comment').value.trim(),
  };
}

async function handleSave(e) {
  e.preventDefault();
  const payload = formToPayload();
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving…';
  try {
    if (editingId) {
      await fetchAPI(`/api/collaboration/${editingId}`, { method: 'PUT', body: payload });
    } else {
      await fetchAPI('/api/collaboration', { method: 'POST', body: payload });
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
  showConfirmModal('Delete Collaboration', '<p>Delete this collaboration record? This cannot be undone.</p>', async () => {
    try {
      bootstrap.Modal.getInstance(document.getElementById('the-modal'))?.hide();
      await fetchAPI(`/api/collaboration/${editingId}`, { method: 'DELETE' });
      showToast('Record deleted', 'danger');
      await loadItems();
    } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
  });
}

async function handleDeleteById(id) {
  showConfirmModal('Delete Collaboration', '<p>Delete this collaboration record? This cannot be undone.</p>', async () => {
    try {
      await fetchAPI(`/api/collaboration/${id}`, { method: 'DELETE' });
      showToast('Record deleted', 'danger');
      await loadItems();
    } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
  });
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
