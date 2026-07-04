let allItems=[], allCompanies=[], allContacts=[], editingId=null;
let editingUpdatedAt = null;
let displayItems   = [];
let currentPage    = 1;
const PAGE_SIZE    = 25;
let sortState      = null;

function applySort(items) {
  return sortState?.key ? sortByKey(items, sortState.key, sortState.dir) : items;
}

document.addEventListener('DOMContentLoaded', async () => {
  sortState = initSortableHeaders(document.querySelector('.table thead'), applyFilters);
  await Promise.all([loadCompanies(), loadContacts()]);
  await loadItems();
  bindDebouncedInput('search-input', applyFilters);
  document.getElementById('filter-provider').addEventListener('change', applyFilters);
  document.getElementById('filter-hired').addEventListener('change', applyFilters);
  document.getElementById('filter-from').addEventListener('change', applyFilters);
  document.getElementById('filter-to').addEventListener('change', applyFilters);
  document.getElementById('btn-add').addEventListener('click', () => openModal(null));
  document.getElementById('the-form').addEventListener('submit', handleSave);
  document.getElementById('btn-delete').addEventListener('click', handleDelete);
  document.getElementById('f-company').addEventListener('change', e => updateContactDropdown(e.target.value));
  document.getElementById('f-hired').addEventListener('change', e => {
    document.getElementById('hired-name-row').classList.toggle('d-none', e.target.value !== 'Yes');
  });
});

async function loadCompanies() {
  try {
    allCompanies = await fetchAPI('/api/companies');
    document.getElementById('f-company').innerHTML = '<option value="">Select company… *</option>' +
      allCompanies.map(c=>`<option value="${c.CompanyID}">${escHtml(c.CompanyName)}</option>`).join('');
  } catch(err) { showToast('Failed to load companies','danger'); }
}
async function loadContacts() {
  try { allContacts = await fetchAPI('/api/contacts'); }
  catch(err) { showToast('Failed to load contacts','danger'); }
}
async function loadItems() {
  setLoading(true);
  try { allItems = await fetchAPI('/api/hiring-feedback'); applyFilters(); }
  catch(err) { showToast('Failed to load: '+err.message,'danger'); }
  finally { setLoading(false); }
}
function updateContactDropdown(companyId, selectedId=null) {
  const sel = document.getElementById('f-contact');
  const filtered = companyId ? allContacts.filter(c=>String(c.CompanyID)===String(companyId)) : allContacts;
  sel.innerHTML = '<option value="">Select contact… *</option>' +
    filtered.map(c=>`<option value="${c.ContactID}" ${String(c.ContactID)===String(selectedId)?'selected':''}>${escHtml(c.FirstName+' '+c.LastName)}</option>`).join('');
}
function applyFilters() {
  const q        = safeLower(document.getElementById('search-input').value);
  const provider = document.getElementById('filter-provider').value;
  const hired    = document.getElementById('filter-hired').value;
  const from     = document.getElementById('filter-from').value;
  const to       = document.getElementById('filter-to').value;
  const filtered = allItems.filter(r=>{
    if(q && !safeLower(r.CompanyName).includes(q) && !safeLower(r.ContactName).includes(q)) return false;
    if(provider && r.FeedbackProvider!==provider) return false;
    if(hired    && r.HiredStudentAlumni!==hired)   return false;
    if(from     && r.DateReported<from)            return false;
    if(to       && r.DateReported>to)              return false;
    return true;
  });
  displayItems = applySort(filtered); currentPage = 1; renderCurrentPage();
}
function renderCurrentPage() {
  const start = (currentPage - 1) * PAGE_SIZE;
  renderTable(displayItems.slice(start, start + PAGE_SIZE));
  updateRecordCountBadge(displayItems.length, allItems.length);

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
  if(!items.length){ tbody.innerHTML=`<tr><td colspan="7" class="text-center text-muted py-4">No records found. <a href="#" onclick="openModal(null);return false;">Add one</a>.</td></tr>`; return; }
  tbody.innerHTML = items.map(r=>`
    <tr style="cursor:pointer" data-id="${r.HiringFeedbackID}">
      <td>${escHtml(r.CompanyName)}</td>
      <td>${escHtml(r.ContactName)}</td>
      <td>${escHtml(r.FeedbackProvider)}</td>
      <td>${renderStatusBadge(r.HiredStudentAlumni)}</td>
      <td>${toDateDisplay(r.DateReported)}</td>
      <td>${escHtml(r.HiredStudentName||'—')}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-primary me-1" title="Edit" aria-label="Edit hiring feedback" onclick="event.stopPropagation();openModalById(${r.HiringFeedbackID})"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" title="Delete" aria-label="Delete hiring feedback" onclick="event.stopPropagation();handleDeleteById(${r.HiringFeedbackID})"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(row=>row.addEventListener('click',()=>openModal(allItems.find(r=>r.HiringFeedbackID==row.dataset.id))));
}
function setLoading(on){ if(on) document.getElementById('tbody').innerHTML=`<tr><td colspan="7" class="text-center py-4"><div class="spinner-border spinner-border-sm"></div> Loading…</td></tr>`; }
function openModalById(id){ const item=allItems.find(r=>r.HiringFeedbackID==id); if(item) openModal(item); }
function openModal(item) {
  editingId = item?item.HiringFeedbackID:null;
  editingUpdatedAt = item ? (item.UpdatedAt ?? null) : null;
  document.getElementById('the-form').reset();
  clearFormError('the-form');
  document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
  document.getElementById('hired-name-row').classList.add('d-none');
  document.getElementById('modal-title').textContent = item?'Edit Hiring Feedback':'Add Hiring Feedback';
  document.getElementById('btn-delete').classList.toggle('d-none',!item);
  if(item){
    document.getElementById('f-company').value       = item.CompanyID;
    updateContactDropdown(item.CompanyID, item.ContactID);
    document.getElementById('f-provider').value      = item.FeedbackProvider;
    document.getElementById('f-hired').value         = item.HiredStudentAlumni;
    document.getElementById('f-date').value          = toDateInputValue(item.DateReported);
    document.getElementById('f-student-name').value  = item.HiredStudentName||'';
    document.getElementById('f-comment').value        = item.Comment||'';
    if(item.HiredStudentAlumni==='Yes') document.getElementById('hired-name-row').classList.remove('d-none');
  } else {
    updateContactDropdown('');
    document.getElementById('f-date').value = todayISODate();
  }
  new bootstrap.Modal(document.getElementById('the-modal')).show();
}
async function handleSave(e) {
  e.preventDefault();
  if (!validateForm(document.getElementById('the-form'))) return;
  const payload = {
    CompanyID: document.getElementById('f-company').value,
    ContactID: document.getElementById('f-contact').value,
    FeedbackProvider: document.getElementById('f-provider').value,
    HiredStudentAlumni: document.getElementById('f-hired').value,
    DateReported: document.getElementById('f-date').value,
    HiredStudentName: document.getElementById('f-student-name').value.trim(),
    Comment: document.getElementById('f-comment').value.trim(),
  };
  const btn=document.getElementById('btn-save');
  btn.disabled=true; btn.innerHTML='<span class="spinner-border spinner-border-sm me-1"></span>Saving…';
  try {
    if (editingId) payload.UpdatedAt = editingUpdatedAt; // concurrent-edit check: server returns 409 on conflict
    editingId ? await fetchAPI(`/api/hiring-feedback/${editingId}`,{method:'PUT',body:payload}) : await fetchAPI('/api/hiring-feedback',{method:'POST',body:payload});
    bootstrap.Modal.getInstance(document.getElementById('the-modal')).hide();
    showToast('Record saved successfully');
    await loadItems();
  } catch(err){
    showFormError('the-form', 'Save failed: ' + err.message);
    showToast('Save failed: '+err.message,'danger');
  }
  finally { btn.disabled=false; btn.innerHTML='Save'; }
}
async function handleDelete() {
  if(!editingId) return;
  showConfirmModal('Delete Record','<p>Delete this hiring feedback record? This cannot be undone.</p>',async()=>{
    try {
      bootstrap.Modal.getInstance(document.getElementById('the-modal'))?.hide();
      await fetchAPI(`/api/hiring-feedback/${editingId}`,{method:'DELETE'});
      showToast('Record deleted','danger'); await loadItems();
    } catch(err){ showToast('Delete failed: '+err.message,'danger'); }
  });
}
async function handleDeleteById(id){
  showConfirmModal('Delete Record','<p>Delete this hiring feedback record? This cannot be undone.</p>',async()=>{
    try {
      await fetchAPI(`/api/hiring-feedback/${id}`,{method:'DELETE'});
      showToast('Record deleted','danger'); await loadItems();
    } catch(err){ showToast('Delete failed: '+err.message,'danger'); }
  });
}
function escHtml(s){ if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
