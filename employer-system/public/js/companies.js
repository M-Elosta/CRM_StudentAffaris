// ── State ──────────────────────────────────────────────────────────────────────
let allCompanies = [];
let editingId    = null;

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadCompanies();

  document.getElementById('search-input').addEventListener('input', e => {
    renderTable(filterCompanies(e.target.value.trim()));
  });

  document.getElementById('btn-add').addEventListener('click', () => openModal(null));

  document.getElementById('company-form').addEventListener('submit', handleSave);

  document.getElementById('btn-delete').addEventListener('click', handleDelete);

  // Show/hide Pay Amount based on Blacklisted toggle label
  document.getElementById('f-blacklisted').addEventListener('change', e => {
    const warn = document.getElementById('blacklist-warning');
    warn.classList.toggle('d-none', !e.target.checked);
  });
});

// ── Data loading ───────────────────────────────────────────────────────────────
async function loadCompanies() {
  setTableLoading(true);
  try {
    allCompanies = await fetchAPI('/api/companies');
    renderTable(allCompanies);
  } catch (err) {
    showToast('Failed to load companies: ' + err.message, 'danger');
  } finally {
    setTableLoading(false);
  }
}

function filterCompanies(q) {
  if (!q) return allCompanies;
  const lower = q.toLowerCase();
  return allCompanies.filter(c =>
    c.CompanyName.toLowerCase().includes(lower) ||
    (c.Country || '').toLowerCase().includes(lower) ||
    (c.Industry || '').toLowerCase().includes(lower) ||
    (c.Sector || '').toLowerCase().includes(lower)
  );
}

// ── Table rendering ────────────────────────────────────────────────────────────
function renderTable(companies) {
  const tbody = document.getElementById('companies-tbody');

  if (companies.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-muted py-4">
          No companies found. <a href="#" id="empty-add-link">Add your first company</a>.
        </td>
      </tr>`;
    document.getElementById('empty-add-link')?.addEventListener('click', e => {
      e.preventDefault();
      openModal(null);
    });
    return;
  }

  tbody.innerHTML = companies.map(c => {
    const blacklistedBadge = c.Blacklisted
      ? '<span class="badge bg-danger ms-1">Blacklisted</span>'
      : '';
    const moUBadge = c.SignedMoU ? '<span class="badge bg-success ms-1">MoU</span>' : '';
    const favBadge = c.FavoriteEmployer ? '<i class="bi bi-star-fill text-warning ms-1" title="Favorite"></i>' : '';
    const rowClass = c.Blacklisted ? 'table-secondary text-muted' : '';

    return `
      <tr class="${rowClass}" style="cursor:pointer" data-id="${c.CompanyID}">
        <td>
          ${escHtml(c.CompanyName)}${blacklistedBadge}${moUBadge}${favBadge}
        </td>
        <td>${escHtml(c.Industry)}</td>
        <td>${escHtml(c.Sector)}</td>
        <td>${escHtml(c.Country)}</td>
        <td>${formatDate(c.DateAdded)}</td>
        <td>${c.Website ? `<a href="${escHtml(c.Website)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><i class="bi bi-box-arrow-up-right"></i></a>` : '—'}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-primary me-1" onclick="event.stopPropagation();openModal(allCompanies.find(x=>x.CompanyID==${c.CompanyID}))"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation();handleDeleteById(${c.CompanyID})"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => {
      const company = allCompanies.find(c => c.CompanyID == row.dataset.id);
      if (company) openModal(company);
    });
  });
}

function setTableLoading(loading) {
  const tbody = document.getElementById('companies-tbody');
  if (loading) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div> Loading…</td></tr>`;
  }
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function openModal(company) {
  editingId = company ? company.CompanyID : null;

  const form = document.getElementById('company-form');
  form.reset();
  document.getElementById('blacklist-warning').classList.add('d-none');

  const title = document.getElementById('modal-title');
  const deleteBtn = document.getElementById('btn-delete');

  if (company) {
    title.textContent = 'Edit Company';
    deleteBtn.classList.remove('d-none');
    populateForm(company);
  } else {
    title.textContent = 'Add Company';
    deleteBtn.classList.add('d-none');
    // Default date to today
    document.getElementById('f-date-added').value = todayStr();
  }

  new bootstrap.Modal(document.getElementById('company-modal')).show();
}

function populateForm(c) {
  document.getElementById('f-name').value         = c.CompanyName || '';
  document.getElementById('f-date-added').value   = typeof c.DateAdded === 'string' ? c.DateAdded.slice(0,10) : todayStr();
  document.getElementById('f-industry').value     = c.Industry || '';
  document.getElementById('f-sector').value       = c.Sector || '';
  document.getElementById('f-country').value      = c.Country || '';
  document.getElementById('f-address').value      = c.Address || '';
  document.getElementById('f-website').value      = c.Website || '';
  document.getElementById('f-linkedin').value     = c.LinkedInURL || '';
  document.getElementById('f-handshake').value    = c.HandshakeURL || '';
  document.getElementById('f-mou').checked        = !!c.SignedMoU;
  document.getElementById('f-favorite').checked   = !!c.FavoriteEmployer;
  document.getElementById('f-blacklisted').checked = !!c.Blacklisted;
  document.getElementById('f-comment').value      = c.Comment || '';

  if (c.Blacklisted) {
    document.getElementById('blacklist-warning').classList.remove('d-none');
  }
}

function formToPayload() {
  return {
    CompanyName:     document.getElementById('f-name').value.trim(),
    DateAdded:       document.getElementById('f-date-added').value,
    Industry:        document.getElementById('f-industry').value.trim(),
    Sector:          document.getElementById('f-sector').value,
    Country:         document.getElementById('f-country').value.trim(),
    Address:         document.getElementById('f-address').value.trim(),
    Website:         document.getElementById('f-website').value.trim(),
    LinkedInURL:     document.getElementById('f-linkedin').value.trim(),
    HandshakeURL:    document.getElementById('f-handshake').value.trim(),
    SignedMoU:       document.getElementById('f-mou').checked,
    FavoriteEmployer:document.getElementById('f-favorite').checked,
    Blacklisted:     document.getElementById('f-blacklisted').checked,
    Comment:         document.getElementById('f-comment').value.trim(),
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
      await fetchAPI(`/api/companies/${editingId}`, { method: 'PUT', body: payload });
    } else {
      await fetchAPI('/api/companies', { method: 'POST', body: payload });
    }
    bootstrap.Modal.getInstance(document.getElementById('company-modal')).hide();
    showToast('Record saved successfully');
    await loadCompanies();
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

  try {
    const counts = await fetchAPI(`/api/companies/${editingId}/related-counts`);
    const parts = [];
    if (counts.contacts)     parts.push(`${counts.contacts} contact(s)`);
    if (counts.outreach)     parts.push(`${counts.outreach} outreach record(s)`);
    if (counts.recruitment)  parts.push(`${counts.recruitment} recruitment posting(s)`);
    if (counts.events)       parts.push(`${counts.events} career event(s)`);
    if (counts.academic)     parts.push(`${counts.academic} academic engagement(s)`);
    if (counts.studentEvents)parts.push(`${counts.studentEvents} student-led event(s)`);

    const detail = parts.length
      ? `<p class="text-danger mt-2 mb-0"><i class="bi bi-exclamation-triangle-fill me-1"></i>This will also permanently delete: ${parts.join(', ')}.</p>`
      : '';

    showConfirmModal(
      'Delete Company',
      `<p>Delete <strong>${escHtml(counts.companyName)}</strong>? This action cannot be undone.</p>${detail}`,
      async () => {
        try {
          bootstrap.Modal.getInstance(document.getElementById('company-modal'))?.hide();
          await fetchAPI(`/api/companies/${editingId}`, { method: 'DELETE' });
          showToast('Company deleted', 'danger');
          await loadCompanies();
        } catch (err) {
          showToast('Delete failed: ' + err.message, 'danger');
        }
      }
    );
  } catch (err) {
    showToast('Could not load company details: ' + err.message, 'danger');
  }
}

async function handleDeleteById(id) {
  try {
    const counts = await fetchAPI(`/api/companies/${id}/related-counts`);
    const parts = [];
    if (counts.contacts)      parts.push(`${counts.contacts} contact(s)`);
    if (counts.outreach)      parts.push(`${counts.outreach} outreach record(s)`);
    if (counts.recruitment)   parts.push(`${counts.recruitment} recruitment posting(s)`);
    if (counts.events)        parts.push(`${counts.events} career event(s)`);
    if (counts.academic)      parts.push(`${counts.academic} academic engagement(s)`);
    if (counts.studentEvents) parts.push(`${counts.studentEvents} student-led event(s)`);
    const detail = parts.length
      ? `<p class="text-danger mt-2 mb-0"><i class="bi bi-exclamation-triangle-fill me-1"></i>This will also permanently delete: ${parts.join(', ')}.</p>`
      : '';
    showConfirmModal('Delete Company',
      `<p>Delete <strong>${escHtml(counts.companyName)}</strong>? This action cannot be undone.</p>${detail}`,
      async () => {
        try {
          await fetchAPI(`/api/companies/${id}`, { method: 'DELETE' });
          showToast('Company deleted', 'danger');
          await loadCompanies();
        } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
      }
    );
  } catch (err) { showToast('Could not load company details: ' + err.message, 'danger'); }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(str) {
  if (str === null || str === undefined || str === '') return '—';
  return String(str).slice(0, 10);
}
