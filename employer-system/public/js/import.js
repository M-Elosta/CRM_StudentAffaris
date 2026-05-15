let parsedRows     = [];
let validatedRows  = [];
let fileHeaders    = [];
let currentMapping = {};
let errorBase64    = null;

document.addEventListener('DOMContentLoaded', () => {
  const entitySel  = document.getElementById('entity-select');
  const fileInput  = document.getElementById('file-input');
  const btnTmpl    = document.getElementById('btn-template');
  const btnValidate = document.getElementById('btn-validate');
  const btnConfirm = document.getElementById('btn-confirm');
  const btnErrors  = document.getElementById('btn-download-errors');

  entitySel.addEventListener('change', () => {
    const hasEntity = !!entitySel.value;
    btnTmpl.disabled  = !hasEntity;
    fileInput.disabled = !hasEntity;
    hide('step-mapping'); hide('step-preview');
  });

  btnTmpl.addEventListener('click', () => {
    const entity = entitySel.value;
    if (!entity) return;
    window.location.href = `/api/import/template/${encodeURIComponent(entity)}`;
  });

  fileInput.addEventListener('change', handleFileUpload);
  btnValidate.addEventListener('click', handleValidate);
  btnConfirm.addEventListener('click', handleConfirm);
  btnErrors.addEventListener('click', downloadErrors);
});

async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/import/parse', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    fileHeaders = data.headers;
    parsedRows  = data.allRows;

    buildMappingTable(fileHeaders, document.getElementById('entity-select').value);
    show('step-mapping');
    hide('step-preview');
    document.getElementById('import-result').classList.add('d-none');
  } catch (err) {
    showToast('Parse failed: ' + err.message, 'danger');
  }
}

// Build the entity field list (client-side subset for auto-match UX)
const ENTITY_DB_FIELDS = {
  Company:                 ['CompanyName','DateAdded','Industry','Sector','Country','Address','Website','LinkedInURL','HandshakeURL','SignedMoU','FavoriteEmployer','Blacklisted','Comment','__ignore__'],
  Contact:                 ['__full_name__','CompanyID','FirstName','LastName','DateAdded','EmailAddress','JobTitle','Address','Country','WorkPhone','Mobile','LinkedInURL','HandshakeURL','CMUQGraduate','Major','GraduationYear','PrimaryContact','Status','ResumeBook','EventInvitation','ExcludeFromMailing','__ignore__'],
  Outreach:                ['CompanyID','ContactID','InteractionType','InteractionDate','DiscussionItems','ActionPlan','FollowUpDate','InteractionStatus','__ignore__'],
  Recruitment:             ['CompanyID','ContactID','DatePosted','OpportunityTitle','Duration','HiringStartDate','HiringEndDate','Country','Mode','Status','PayAmount','TargetGroup','ArabicSpeaker','HiredStudentAlumni','Comment','__ignore__'],
  'Career Event':          ['CompanyID','ContactID','EventName','EventDate','RegisteredStatus','CMUQAlumniAtBooth','Comment','__ignore__'],
  'Student-Led Event':     ['CompanyID','ContactID','ProposalDate','OrganizationName','StudentName','StudentEmail','StudentPhoneNumber','CollaborationOutcome','EventDate','EventTitle','Comment','__ignore__'],
  'Academic Engagement':   ['CompanyID','ContactID','EngagementType','GuestSpeakerName','GuestTitle','Email','PhoneNumber','FacultyName','CourseNumber','CourseTitle','TopicTheme','SessionDate','SessionTime','Comment','__ignore__'],
  'Hiring Feedback':       ['CompanyID','ContactID','FeedbackProvider','HiredStudentAlumni','DateReported','HiredStudentName','Comment','__ignore__'],
  'Potential Collaboration':['CompanyID','Comment','__ignore__'],
};

function autoMatch(fileCol, dbFields) {
  const norm = s => s.toLowerCase().replace(/[\s_\-]/g, '');
  const target = norm(fileCol);

  // Detect full-name patterns before exact matching
  const fullNamePatterns = ['fullname','contactname','contactfullname','name','fullcontactname'];
  const firstLastPatterns = ['firstname','lastname'];
  if (dbFields.includes('__full_name__') &&
      fullNamePatterns.includes(target) &&
      !firstLastPatterns.some(p => target === p)) {
    return '__full_name__';
  }

  return dbFields.find(f => norm(f) === target) || '__ignore__';
}

function buildMappingTable(headers, entity) {
  const dbFields = ENTITY_DB_FIELDS[entity] || [];
  const container = document.getElementById('mapping-table');

  const rows = headers.map(h => {
    const matched = autoMatch(h, dbFields);
    const isMatch = matched !== '__ignore__';
    const fieldLabel = f => {
      if (f === '__ignore__')    return '— Ignore —';
      if (f === '__full_name__') return 'Full Name (→ First + Last, auto-split)';
      return f;
    };
    const options = dbFields.map(f =>
      `<option value="${f}" ${f === matched ? 'selected' : ''}>${fieldLabel(f)}</option>`
    ).join('');
    return `
      <div class="row g-2 align-items-center mb-2">
        <div class="col-md-4">
          <span class="badge ${isMatch ? 'bg-success' : 'bg-secondary'} me-2"><i class="bi bi-${isMatch ? 'check' : 'x'}"></i></span>
          <span class="small fw-semibold">${escHtml(h)}</span>
        </div>
        <div class="col-auto text-muted small"><i class="bi bi-arrow-right"></i></div>
        <div class="col-md-4">
          <select class="form-select form-select-sm mapping-sel" data-file-col="${escHtml(h)}">${options}</select>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = rows;
}

function getMapping() {
  const result = {};
  document.querySelectorAll('.mapping-sel').forEach(sel => {
    result[sel.dataset.fileCol] = sel.value;
  });
  return result;
}

async function handleValidate() {
  currentMapping = getMapping();
  const entity = document.getElementById('entity-select').value;

  const btn = document.getElementById('btn-validate');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Validating…';

  try {
    validatedRows = await fetchAPI('/api/import/validate', {
      method: 'POST',
      body: { entity, rows: parsedRows, mapping: currentMapping }
    });
    renderPreview(validatedRows);
    show('step-preview');
  } catch (err) {
    showToast('Validation failed: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Validate & Preview';
  }
}

function renderPreview(rows) {
  const valid  = rows.filter(r => r.status === 'valid').length;
  const dups   = rows.filter(r => r.status === 'duplicate').length;
  const errors = rows.filter(r => r.status === 'error').length;

  document.getElementById('summary-badges').innerHTML = `
    <span class="badge bg-success fs-6">${valid} ready</span>
    <span class="badge bg-warning text-dark fs-6">${dups} duplicate${dups !== 1 ? 's' : ''}</span>
    <span class="badge bg-danger fs-6">${errors} error${errors !== 1 ? 's' : ''}</span>`;

  const cols = rows.length ? Object.keys(rows[0].row).filter(k => !k.startsWith('__')) : [];
  document.getElementById('preview-thead').innerHTML =
    '<tr>' + ['#','Status',...cols,'Action'].map(c => `<th>${escHtml(c)}</th>`).join('') + '</tr>';

  document.getElementById('preview-tbody').innerHTML = rows.map((r, i) => {
    const rowClass = r.status === 'error' ? 'table-danger' : r.status === 'duplicate' ? 'table-warning' : '';
    const statusBadge = r.status === 'error'
      ? `<span class="badge bg-danger" title="${escHtml(r.errors.join('; '))}">Error <i class="bi bi-info-circle"></i></span>`
      : r.status === 'duplicate'
        ? '<span class="badge bg-warning text-dark">Duplicate</span>'
        : '<span class="badge bg-success">Valid</span>';

    const cells = cols.map(c => `<td class="small">${escHtml(String(r.row[c] ?? ''))}</td>`).join('');

    const actionCell = r.status === 'duplicate'
      ? `<td><select class="form-select form-select-sm dup-action" data-index="${i}">
           <option value="skip">Skip</option>
           <option value="overwrite">Overwrite</option>
           <option value="create_new">Create New</option>
         </select></td>`
      : r.status === 'error'
        ? `<td><span class="text-danger small">${escHtml(r.errors.join(', '))}</span></td>`
        : '<td>—</td>';

    return `<tr class="${rowClass}"><td>${i+1}</td><td>${statusBadge}</td>${cells}${actionCell}</tr>`;
  }).join('');
}

async function handleConfirm() {
  const entity = document.getElementById('entity-select').value;

  // Build final rows with actions
  const rowsToSend = validatedRows
    .filter(r => r.status !== 'error')
    .map((r, i) => {
      let action = 'import';
      if (r.status === 'duplicate') {
        const sel = document.querySelector(`.dup-action[data-index="${r.rowIndex}"]`);
        action = sel ? sel.value : 'skip';
      }
      return { row: r.row, action };
    });

  const btn = document.getElementById('btn-confirm');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Importing…';

  try {
    const result = await fetchAPI('/api/import/confirm', { method: 'POST', body: { entity, rows: rowsToSend } });
    errorBase64 = result.errorFileBase64;

    const resultEl = document.getElementById('import-result');
    const hasFailures = result.failed > 0;
    resultEl.className = `alert ${hasFailures ? 'alert-warning' : 'alert-success'}`;

    let errorHtml = '';
    if (hasFailures && result.failedDetails && result.failedDetails.length) {
      const items = result.failedDetails.map(f => `<li>Row ${f.row}: ${escHtml(f.error)}</li>`).join('');
      errorHtml = `<ul class="mb-0 mt-2 small">${items}</ul>`;
    }

    resultEl.innerHTML = `
      <i class="bi bi-${hasFailures ? 'exclamation-triangle-fill' : 'check-circle-fill'} me-2"></i>
      <strong>Import complete:</strong> ${result.imported} imported, ${result.updated} updated,
      ${result.skipped} skipped, ${result.failed} failed.${errorHtml}`;
    resultEl.classList.remove('d-none');

    if (hasFailures && errorBase64) {
      document.getElementById('btn-download-errors').classList.remove('d-none');
    }
    showToast(`Import done: ${result.imported} imported, ${result.failed} failed`, hasFailures ? 'warning' : 'success');
  } catch (err) {
    showToast('Import failed: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-cloud-upload me-1"></i>Confirm Import';
  }
}

function downloadErrors() {
  if (!errorBase64) return;
  const binary = atob(errorBase64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'import-errors.xlsx'; a.click();
  URL.revokeObjectURL(url);
}

function show(id) { document.getElementById(id).classList.remove('d-none'); }
function hide(id) { document.getElementById(id).classList.add('d-none'); }
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
