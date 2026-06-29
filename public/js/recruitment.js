let allItems     = [];
let allCompanies = [];
let allContacts  = [];
let editingId    = null;
let editingUpdatedAt = null;
let displayItems   = [];
let currentPage    = 1;
const PAGE_SIZE    = 25;

const OPP_TYPES    = ['Internship','Part-time Job','Full-time Job','Graduate Program','Summer Research Program','Training Program','Mentorship Program','Fellowship','Competition/Hackathon','Volunteering','Others'];
const COLLECT_CH   = ['Resume book','Handshake','Email','Other'];
const MAJORS       = ['Computer Science','Information Systems','Biological Sciences','Business Administration','Artificial Intelligence','Computational Biology'];
const CLASS_LEVELS = ['Freshman','Sophomore','Junior','Senior','Alumni'];

document.addEventListener('DOMContentLoaded', async () => {
  buildCheckboxGroups();
  await Promise.all([loadCompanies(), loadContacts()]);
  await loadItems();

  document.getElementById('search-input').addEventListener('input', debounce(applyFilters, 300));
  document.getElementById('filter-mode').addEventListener('change', applyFilters);
  document.getElementById('filter-status').addEventListener('change', applyFilters);
  document.getElementById('filter-from').addEventListener('change', applyFilters);
  document.getElementById('filter-to').addEventListener('change', applyFilters);
  document.getElementById('btn-add').addEventListener('click', () => openModal(null));
  document.getElementById('recruitment-form').addEventListener('submit', handleSave);
  document.getElementById('btn-delete').addEventListener('click', handleDelete);
  document.getElementById('f-company').addEventListener('change', e => updateContactDropdown(e.target.value));
  document.getElementById('f-pay-status').addEventListener('change', e => {
    document.getElementById('pay-amount-row').classList.toggle('d-none', e.target.value !== 'Paid');
  });
});

function buildCheckboxGroups() {
  document.getElementById('chk-opp-types').innerHTML    = checkboxHtml('opp', OPP_TYPES);
  document.getElementById('chk-collect').innerHTML      = checkboxHtml('collect', COLLECT_CH);
  document.getElementById('chk-majors').innerHTML       = checkboxHtml('major', MAJORS);
  document.getElementById('chk-classlevel').innerHTML   = checkboxHtml('cls', CLASS_LEVELS);
}

function checkboxHtml(prefix, items) {
  return items.map((v, i) => `
    <div class="form-check form-check-inline">
      <input class="form-check-input" type="checkbox" id="${prefix}-${i}" value="${v}" name="${prefix}">
      <label class="form-check-label" for="${prefix}-${i}">${v}</label>
    </div>`).join('');
}

function getChecked(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
}

function setChecked(name, values) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(el => {
    el.checked = (values || []).includes(el.value);
  });
}

async function loadCompanies() {
  try {
    allCompanies = await fetchAPI('/api/companies');
    document.getElementById('f-company').innerHTML =
      '<option value="">Select company… *</option>' +
      allCompanies.map(c => `<option value="${c.CompanyID}">${escHtml(c.CompanyName)}</option>`).join('');
  } catch (err) { showToast('Failed to load companies', 'danger'); }
}

async function loadContacts() {
  try { allContacts = await fetchAPI('/api/contacts'); }
  catch (err) { showToast('Failed to load contacts', 'danger'); }
}

async function loadItems() {
  setLoading(true);
  try {
    allItems = await fetchAPI('/api/recruitment');
    applyFilters();
  } catch (err) { showToast('Failed to load: ' + err.message, 'danger'); }
  finally { setLoading(false); }
}

function updateContactDropdown(companyId, selectedId = null) {
  const sel = document.getElementById('f-contact');
  const filtered = companyId ? allContacts.filter(c => String(c.CompanyID) === String(companyId)) : allContacts;
  sel.innerHTML = '<option value="">Select contact… *</option>' +
    filtered.map(c =>
      `<option value="${c.ContactID}" ${String(c.ContactID)===String(selectedId)?'selected':''}>${escHtml(c.FirstName+' '+c.LastName)}</option>`
    ).join('');
}

function applyFilters() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const mode   = document.getElementById('filter-mode').value;
  const status = document.getElementById('filter-status').value;
  const from   = document.getElementById('filter-from').value;
  const to     = document.getElementById('filter-to').value;
  const filtered = allItems.filter(r => {
    if (q && !r.CompanyName?.toLowerCase().includes(q) && !r.OpportunityTitle?.toLowerCase().includes(q)) return false;
    if (mode   && r.Mode   !== mode)   return false;
    if (status && r.Status !== status) return false;
    if (from   && r.DatePosted < from) return false;
    if (to     && r.DatePosted > to)   return false;
    return true;
  });
  displayItems = filtered;
  currentPage = 1;
  renderCurrentPage();
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
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No records found. <a href="#" onclick="openModal(null);return false;">Add one</a>.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(r => {
    const hiredBadge = renderStatusBadge(r.HiredStudentAlumni);
    const modeBadge = renderSemanticBadge(r.Mode, 'neutral', { subtle: true });
    const statusBadge = renderSemanticBadge(
      r.Status,
      r.Status === 'Paid' ? 'good' : 'neutral',
      { subtle: r.Status !== 'Paid' }
    );
    return `<tr style="cursor:pointer" data-id="${r.RecruitmentID}">
      <td>${escHtml(r.CompanyName)}</td>
      <td>${escHtml(r.OpportunityTitle)}</td>
      <td>${toDateDisplay(r.DatePosted)}</td>
      <td>${modeBadge}</td>
      <td>${statusBadge}</td>
      <td>${r.TargetGroup}</td>
      <td>${hiredBadge}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-primary me-1" title="Edit" onclick="event.stopPropagation();openModalById(${r.RecruitmentID})"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" title="Delete" onclick="event.stopPropagation();handleDeleteById(${r.RecruitmentID})"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(row =>
    row.addEventListener('click', () => openModal(allItems.find(r => r.RecruitmentID == row.dataset.id)))
  );
}

function setLoading(on) {
  if (on) document.getElementById('tbody').innerHTML =
    `<tr><td colspan="8" class="text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div> Loading…</td></tr>`;
}

function openModalById(id) {
  const item = allItems.find(r => r.RecruitmentID == id);
  if (item) openModal(item);
}

function openModal(item) {
  editingId = item ? item.RecruitmentID : null;
  editingUpdatedAt = item?.UpdatedAt || null;
  const form = document.getElementById('recruitment-form');
  form.reset();
  clearFormError(form);
  document.querySelectorAll('input[type="checkbox"]').forEach(el => el.checked = false);
  document.getElementById('pay-amount-row').classList.add('d-none');

  const readOnly = isViewerRole();
  document.getElementById('modal-title').textContent = readOnly ? 'View Recruitment' : (item ? 'Edit Recruitment' : 'Add Recruitment');
  document.getElementById('btn-delete').classList.toggle('d-none', !item || readOnly);

  if (item) {
    document.getElementById('f-company').value        = item.CompanyID;
    updateContactDropdown(item.CompanyID, item.ContactID);
    document.getElementById('f-date').value           = item.DatePosted;
    document.getElementById('f-title').value          = item.OpportunityTitle;
    document.getElementById('f-duration').value       = item.Duration || '';
    document.getElementById('f-hire-start').value     = item.HiringStartDate || '';
    document.getElementById('f-hire-end').value       = item.HiringEndDate || '';
    document.getElementById('f-country').value        = item.Country || '';
    document.getElementById('f-mode').value           = item.Mode;
    document.getElementById('f-pay-status').value     = item.Status;
    document.getElementById('f-pay-amount').value     = item.PayAmount || '';
    document.getElementById('f-target-group').value   = item.TargetGroup;
    document.getElementById('f-arabic').checked       = !!item.ArabicSpeaker;
    document.getElementById('f-hired').value          = item.HiredStudentAlumni;
    document.getElementById('f-comment').value        = item.Comment || '';
    if (item.Status === 'Paid') document.getElementById('pay-amount-row').classList.remove('d-none');
    setChecked('opp',     item.OpportunityTypes);
    setChecked('collect', item.CollectApplications);
    setChecked('major',   item.TargetMajors);
    setChecked('cls',     item.ClassLevels);
  } else {
    updateContactDropdown('');
    document.getElementById('f-date').value = todayStr();
    document.getElementById('f-hired').value = 'Not Reported';
  }
  document.getElementById('btn-save').classList.toggle('d-none', readOnly);
  document.getElementById('btn-save').disabled = readOnly;
  setFormReadOnly(form, readOnly);
  new bootstrap.Modal(document.getElementById('the-modal')).show();
}

async function handleSave(e) {
  e.preventDefault();
  if (isViewerRole()) return showToast('Viewers cannot make changes. Contact an admin.', 'danger');
  if (!validateForm(document.getElementById('recruitment-form'))) return;
  const payload = {
    CompanyID: document.getElementById('f-company').value,
    ContactID: document.getElementById('f-contact').value,
    DatePosted: document.getElementById('f-date').value,
    OpportunityTitle: document.getElementById('f-title').value.trim(),
    Duration: document.getElementById('f-duration').value.trim(),
    HiringStartDate: document.getElementById('f-hire-start').value,
    HiringEndDate: document.getElementById('f-hire-end').value,
    Country: document.getElementById('f-country').value.trim(),
    Mode: document.getElementById('f-mode').value,
    Status: document.getElementById('f-pay-status').value,
    PayAmount: document.getElementById('f-pay-amount').value.trim(),
    TargetGroup: document.getElementById('f-target-group').value,
    ArabicSpeaker: document.getElementById('f-arabic').checked,
    HiredStudentAlumni: document.getElementById('f-hired').value,
    Comment: document.getElementById('f-comment').value.trim(),
    OpportunityTypes: getChecked('opp'),
    CollectApplications: getChecked('collect'),
    TargetMajors: getChecked('major'),
    ClassLevels: getChecked('cls'),
  };
  if (editingId) payload.UpdatedAt = editingUpdatedAt;
  const btn = document.getElementById('btn-save');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving…';
  try {
    editingId
      ? await fetchAPI(`/api/recruitment/${editingId}`, { method: 'PUT', body: payload })
      : await fetchAPI('/api/recruitment', { method: 'POST', body: payload });
    bootstrap.Modal.getInstance(document.getElementById('the-modal')).hide();
    showToast('Record saved successfully');
    await loadItems();
  } catch (err) { showFormError('recruitment-form', err.message); }
  finally { btn.disabled = false; btn.innerHTML = 'Save'; }
}

async function handleDelete() {
  if (isViewerRole()) return showToast('Viewers cannot make changes. Contact an admin.', 'danger');
  if (!editingId) return;
  showConfirmModal('Delete Recruitment', '<p>Delete this recruitment record? This cannot be undone.</p>', async () => {
    try {
      bootstrap.Modal.getInstance(document.getElementById('the-modal'))?.hide();
      await fetchAPI(`/api/recruitment/${editingId}`, { method: 'DELETE' });
      showToast('Record deleted', 'danger');
      await loadItems();
    } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
  });
}

async function handleDeleteById(id) {
  showConfirmModal('Delete Recruitment', '<p>Delete this recruitment record? This cannot be undone.</p>', async () => {
    try {
      await fetchAPI(`/api/recruitment/${id}`, { method: 'DELETE' });
      showToast('Record deleted', 'danger');
      await loadItems();
    } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
  });
}
