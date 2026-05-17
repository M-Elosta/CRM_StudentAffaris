let allItems     = [];
let allCompanies = [];
let allContacts  = [];
let editingId    = null;

const OPP_TYPES    = ['Internship','Part-time Job','Full-time Job','Graduate Program','Summer Research Program','Training Program','Mentorship Program','Fellowship','Competition/Hackathon','Volunteering','Others'];
const COLLECT_CH   = ['Resume book','Handshake','Email','Other'];
const MAJORS       = ['Computer Science','Information Systems','Biological Sciences','Business Administration','Artificial Intelligence','Computational Biology'];
const CLASS_LEVELS = ['Freshman','Sophomore','Junior','Senior','Alumni'];

document.addEventListener('DOMContentLoaded', async () => {
  buildCheckboxGroups();
  await Promise.all([loadCompanies(), loadContacts()]);
  await loadItems();

  document.getElementById('search-input').addEventListener('input', applyFilters);
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
    renderTable(allItems);
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
  renderTable(allItems.filter(r => {
    if (q && !r.CompanyName?.toLowerCase().includes(q) && !r.OpportunityTitle?.toLowerCase().includes(q)) return false;
    if (mode   && r.Mode   !== mode)   return false;
    if (status && r.Status !== status) return false;
    if (from   && r.DatePosted < from) return false;
    if (to     && r.DatePosted > to)   return false;
    return true;
  }));
}

function renderTable(items) {
  const tbody = document.getElementById('tbody');
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No records found.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(r => {
    const hired = { 'Yes':'bg-success','No':'bg-secondary','Not Reported':'bg-warning text-dark' }[r.HiredStudentAlumni] || 'bg-secondary';
    return `<tr style="cursor:pointer" data-id="${r.RecruitmentID}">
      <td>${escHtml(r.CompanyName)}</td>
      <td>${escHtml(r.OpportunityTitle)}</td>
      <td>${r.DatePosted}</td>
      <td><span class="badge bg-secondary">${r.Mode}</span></td>
      <td><span class="badge ${r.Status==='Paid'?'bg-success':'bg-secondary'}">${r.Status}</span></td>
      <td>${r.TargetGroup}</td>
      <td><span class="badge ${hired}">${r.HiredStudentAlumni}</span></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(row =>
    row.addEventListener('click', () => openModal(allItems.find(r => r.RecruitmentID == row.dataset.id)))
  );
}

function setLoading(on) {
  if (on) document.getElementById('tbody').innerHTML =
    `<tr><td colspan="7" class="text-center py-4"><div class="spinner-border spinner-border-sm"></div> Loading…</td></tr>`;
}

function openModal(item) {
  editingId = item ? item.RecruitmentID : null;
  document.getElementById('recruitment-form').reset();
  document.querySelectorAll('input[type="checkbox"]').forEach(el => el.checked = false);
  document.getElementById('pay-amount-row').classList.add('d-none');

  document.getElementById('modal-title').textContent = item ? 'Edit Recruitment' : 'Add Recruitment';
  document.getElementById('btn-delete').classList.toggle('d-none', !item);

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
    document.getElementById('f-date').value = new Date().toISOString().slice(0,10);
    document.getElementById('f-hired').value = 'Not Reported';
  }
  new bootstrap.Modal(document.getElementById('the-modal')).show();
}

async function handleSave(e) {
  e.preventDefault();
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
  const btn = document.getElementById('btn-save');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving…';
  try {
    editingId
      ? await fetchAPI(`/api/recruitment/${editingId}`, { method: 'PUT', body: payload })
      : await fetchAPI('/api/recruitment', { method: 'POST', body: payload });
    bootstrap.Modal.getInstance(document.getElementById('the-modal')).hide();
    showToast('Record saved successfully');
    await loadItems();
  } catch (err) { showToast('Save failed: ' + err.message, 'danger'); }
  finally { btn.disabled = false; btn.innerHTML = 'Save'; }
}

async function handleDelete() {
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

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
