// ── Constants ──────────────────────────────────────────────────────────────────
const PALETTE = [
  '#4361ee','#f72585','#4cc9f0','#2ec4b6','#ff9f1c',
  '#e71d36','#3a0ca3','#7209b7','#06d6a0','#118ab2','#ffd166','#ef476f',
];

const ENTITY_ICONS = {
  'Companies':              'bi-buildings',
  'Contacts':               'bi-person-lines-fill',
  'Outreach & Engagement':  'bi-chat-dots',
  'Recruitment':            'bi-briefcase',
  'Career Events':          'bi-calendar-event',
  'Student-Led Events':     'bi-megaphone',
  'Academic Engagement':    'bi-mortarboard',
  'Hiring Feedback':        'bi-person-check',
  'Potential Collaboration':'bi-handshake',
};

// ── State ──────────────────────────────────────────────────────────────────────
let quickChart         = null;
let builderChart       = null;
let activeQuickType    = null;
let builderSchema      = {};
let builderEntity      = null;
let lastBuilderPayload = null;
let lastBuilderRows    = null;
let filterRowCounter   = 0;

const CONDITIONS_TEXT   = ['contains','equals','not_equals','starts_with','is_empty','is_not_empty'];
const CONDITIONS_DATE   = ['is','is_not','is_before','is_after','is_between','is_empty','is_not_empty','in_last_days'];
const CONDITIONS_ENUM   = ['is','is_not','is_empty','is_not_empty'];
const CONDITIONS_BOOL   = ['is_true','is_false'];
const CONDITIONS_NUMBER = ['equals','not_equals','gt','lt','is_between','is_empty','is_not_empty'];
const CONDITION_LABELS  = {
  contains:'contains', equals:'equals', not_equals:'does not equal',
  starts_with:'starts with', is_empty:'is empty', is_not_empty:'is not empty',
  is_before:'is before', is_after:'is after', is_between:'is between',
  in_last_days:'in last N days', is_true:'is true', is_false:'is false',
  gt:'greater than', lt:'less than', is:'is', is_not:'is not',
};

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tab-quick-link').addEventListener('click', e => { e.preventDefault(); switchTab('quick'); });
  document.getElementById('tab-builder-link').addEventListener('click', e => { e.preventDefault(); switchTab('builder'); });

  document.querySelectorAll('.report-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.report-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      runQuickReport(card.dataset.type, card.dataset.label);
    });
  });

  document.getElementById('q-show-all').addEventListener('change', e => {
    document.getElementById('q-from').disabled = e.target.checked;
    document.getElementById('q-to').disabled   = e.target.checked;
    if (activeQuickType) runQuickReport(activeQuickType, document.querySelector('.report-card.active')?.dataset.label || '');
  });
  document.getElementById('btn-clear-dates').addEventListener('click', () => {
    document.getElementById('q-from').value = '';
    document.getElementById('q-to').value   = '';
    if (activeQuickType) runQuickReport(activeQuickType, document.querySelector('.report-card.active')?.dataset.label || '');
  });
  ['q-from','q-to'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if (activeQuickType) runQuickReport(activeQuickType, document.querySelector('.report-card.active')?.dataset.label || '');
    });
  });

  document.getElementById('btn-quick-export').addEventListener('click', exportQuickExcel);
  document.getElementById('btn-download-png').addEventListener('click', () => downloadChartPNG('quick-chart', activeQuickType));
  document.getElementById('btn-print-quick').addEventListener('click', () => window.print());

  loadBuilderSchema();

  document.getElementById('btn-run-builder').addEventListener('click', runBuilder);
  document.getElementById('btn-select-all-cols').addEventListener('click', () => {
    document.querySelectorAll('#builder-columns input[type="checkbox"]').forEach(cb => { cb.checked = true; });
  });
  document.getElementById('btn-clear-all-cols').addEventListener('click', () => {
    document.querySelectorAll('#builder-columns input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  });
  document.getElementById('btn-add-filter').addEventListener('click', addFilterRow);
  document.getElementById('btn-br-excel').addEventListener('click', () => exportBuilderData('excel'));
  document.getElementById('btn-br-csv').addEventListener('click',   () => exportBuilderData('csv'));
  document.getElementById('btn-br-png').addEventListener('click',   () => downloadChartPNG('builder-chart', 'custom-report'));
  document.getElementById('btn-save-report').addEventListener('click', openSaveModal);
  document.getElementById('btn-confirm-save').addEventListener('click', confirmSaveReport);

  document.getElementById('br-chart-type').addEventListener('change', () => {
    const t = document.getElementById('br-chart-type').value;
    document.getElementById('br-group-by').classList.toggle('d-none', t === 'none');
    rerenderBuilderChart();
  });
  document.getElementById('br-group-by').addEventListener('change', rerenderBuilderChart);
});

// ── Tab Switching ──────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.getElementById('pane-quick').classList.toggle('d-none', tab !== 'quick');
  document.getElementById('pane-builder').classList.toggle('d-none', tab !== 'builder');
  document.getElementById('tab-quick-link').classList.toggle('active', tab === 'quick');
  document.getElementById('tab-builder-link').classList.toggle('active', tab === 'builder');
  if (tab === 'quick') loadSavedReportsQuickTab();
}

// ── Quick Reports ──────────────────────────────────────────────────────────────
async function runQuickReport(type, label) {
  activeQuickType = type;
  const showAll = document.getElementById('q-show-all').checked;
  const from    = showAll ? '' : (document.getElementById('q-from').value || '');
  const to      = showAll ? '' : (document.getElementById('q-to').value   || '');

  document.getElementById('quick-empty').classList.add('d-none');
  document.getElementById('quick-results').classList.add('d-none');
  document.getElementById('quick-loading').classList.remove('d-none');

  try {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to)   qs.set('to',   to);
    const data = await fetchAPI(`/api/reports/quick/${type}?${qs}`);

    document.getElementById('qr-title').textContent = label;
    document.getElementById('qr-count').textContent = `${data.count} record${data.count !== 1 ? 's' : ''}`;

    renderQuickTable(data.rows);
    renderQuickChart(data.chartData);

    document.getElementById('quick-results').classList.remove('d-none');
  } catch (err) {
    showToast('Failed to load report: ' + err.message, 'danger');
    document.getElementById('quick-empty').classList.remove('d-none');
  } finally {
    document.getElementById('quick-loading').classList.add('d-none');
  }
}

function renderQuickTable(rows) {
  const thead = document.getElementById('quick-thead');
  const tbody = document.getElementById('quick-tbody');

  if (!rows || !rows.length) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td class="text-center text-muted py-4">No records found for the selected period.</td></tr>';
    return;
  }

  const cols = Object.keys(rows[0]).filter(k => !k.startsWith('_'));
  thead.innerHTML = '<tr>' + cols.map(c => `<th>${escHtml(c)}</th>`).join('') + '</tr>';

  const urgencyClass = { overdue: 'table-danger', 'this-week': 'table-warning', upcoming: '' };
  tbody.innerHTML = rows.map(r => {
    const cls = r._urgency ? (urgencyClass[r._urgency] || '') : '';
    return `<tr class="${cls}">` + cols.map(c => `<td title="${escHtml(String(r[c] ?? ''))}">${escHtml(String(r[c] ?? '—'))}</td>`).join('') + '</tr>';
  }).join('');
}

function renderQuickChart(chartData) {
  const wrapper = document.getElementById('chart-wrapper');
  const pngBtn  = document.getElementById('btn-download-png');
  if (!chartData || !chartData.labels || !chartData.labels.length) {
    wrapper.classList.add('d-none');
    pngBtn.classList.add('d-none');
    return;
  }
  wrapper.classList.remove('d-none');
  pngBtn.classList.remove('d-none');
  if (quickChart) { quickChart.destroy(); quickChart = null; }
  quickChart = new Chart(document.getElementById('quick-chart').getContext('2d'), buildChartConfig(chartData));
}

async function exportQuickExcel() {
  if (!activeQuickType) return;
  const showAll = document.getElementById('q-show-all').checked;
  const from    = showAll ? '' : (document.getElementById('q-from').value || '');
  const to      = showAll ? '' : (document.getElementById('q-to').value   || '');
  const qs = new URLSearchParams({ export: '1' });
  if (from) qs.set('from', from);
  if (to)   qs.set('to',   to);
  triggerDownload(`/api/reports/quick/${activeQuickType}?${qs}`);
  showToast('Downloading Excel…');
}

// ── Report Builder ─────────────────────────────────────────────────────────────
async function loadBuilderSchema() {
  try {
    const raw = await fetchAPI('/api/reports/schema');
    // Transform [{key, label, type, values}] arrays → {key: {label, type, values}} objects
    for (const [entity, cols] of Object.entries(raw)) {
      builderSchema[entity] = {};
      for (const col of cols) {
        builderSchema[entity][col.key] = { label: col.label, type: col.type, values: col.values };
      }
    }
    buildEntityButtons();
    loadSavedReportsQuickTab();
  } catch (err) {
    showToast('Failed to load report schema: ' + err.message, 'danger');
  }
}

function buildEntityButtons() {
  document.getElementById('builder-entities').innerHTML = Object.keys(builderSchema).map(entity => `
    <div class="card entity-card shadow-sm" data-entity="${escHtml(entity)}"
         onclick="selectBuilderEntity(${JSON.stringify(entity)})">
      <div class="card-body">
        <i class="bi ${ENTITY_ICONS[entity] || 'bi-table'} d-block mb-1 text-primary e-icon"></i>
        <div class="e-label">${escHtml(entity)}</div>
      </div>
    </div>`).join('');
}

function selectBuilderEntity(entity) {
  builderEntity = entity;
  const schema  = builderSchema[entity];

  document.querySelectorAll('.entity-card').forEach(c => {
    c.classList.toggle('active', c.dataset.entity === entity);
  });

  // Columns
  document.getElementById('builder-columns').innerHTML = Object.entries(schema).map(([key, col]) => {
    const safeId = `col-${key.replace(/[^a-z0-9]/gi, '-')}`;
    return `<div class="col">
      <label class="col-check-label w-100" for="${safeId}">
        <input type="checkbox" id="${safeId}" value="${escHtml(key)}" checked>
        <span class="small">${escHtml(col.label)}</span>
      </label>
    </div>`;
  }).join('');

  // Sort dropdown
  document.getElementById('builder-sort-col').innerHTML = '<option value="">Default order</option>' +
    Object.entries(schema).map(([k, c]) => `<option value="${escHtml(k)}">${escHtml(c.label)}</option>`).join('');

  // Clear filters
  filterRowCounter = 0;
  document.getElementById('builder-filters').innerHTML =
    '<p class="text-muted small mb-0 p-2" id="no-filters-msg">No filters — results include all records.</p>';

  // Show steps using classList (d-none removal is reliable unlike style.removeProperty)
  ['builder-col-card','builder-filter-card','builder-sort-card'].forEach(id =>
    document.getElementById(id).classList.remove('d-none')
  );
  document.getElementById('btn-run-builder').classList.remove('d-none');

  // Reset results panel
  document.getElementById('builder-results-area').classList.add('d-none');
  document.getElementById('builder-results-placeholder').classList.remove('d-none');
}

function addFilterRow() {
  if (!builderEntity) return;
  const schema   = builderSchema[builderEntity];
  const rowId    = ++filterRowCounter;
  const firstKey = Object.keys(schema)[0];
  const firstCol = schema[firstKey];

  document.getElementById('no-filters-msg')?.remove();

  const rowDiv      = document.createElement('div');
  rowDiv.className  = 'filter-row mb-2';
  rowDiv.dataset.id = rowId;
  rowDiv.innerHTML  = buildFilterRowHtml(rowId, schema, firstKey, firstCol);
  document.getElementById('builder-filters').appendChild(rowDiv);

  rowDiv.querySelector('.filter-field').addEventListener('change', e => onFilterFieldChange(rowId, e.target.value));
  rowDiv.querySelector('.filter-condition').addEventListener('change', e => onFilterConditionChange(rowId, e.target.value));
  rowDiv.querySelector('.btn-remove-filter').addEventListener('click', () => removeFilterRow(rowId));
}

function buildFilterRowHtml(rowId, schema, defaultKey, defaultCol) {
  const conditions = getConditionsForType(defaultCol.type);
  return `
    <div class="d-flex gap-1 align-items-start flex-wrap">
      <select class="form-select form-select-sm filter-field" style="max-width:150px">
        ${Object.entries(schema).map(([k, c]) => `<option value="${escHtml(k)}" ${k===defaultKey?'selected':''}>${escHtml(c.label)}</option>`).join('')}
      </select>
      <select class="form-select form-select-sm filter-condition" style="max-width:160px">
        ${conditions.map(c => `<option value="${c}">${CONDITION_LABELS[c]||c}</option>`).join('')}
      </select>
      <div class="filter-value-wrap flex-grow-1">${buildValueInput(defaultCol, conditions[0])}</div>
      <button class="btn btn-sm btn-outline-danger btn-remove-filter"><i class="bi bi-x"></i></button>
    </div>`;
}

function getConditionsForType(type) {
  switch (type) {
    case 'date':    return CONDITIONS_DATE;
    case 'enum':    return CONDITIONS_ENUM;
    case 'boolean': return CONDITIONS_BOOL;
    case 'number':  return CONDITIONS_NUMBER;
    default:        return CONDITIONS_TEXT;
  }
}

function buildValueInput(colDef, condition) {
  if (['is_empty','is_not_empty','is_true','is_false'].includes(condition)) return '';
  if (condition === 'is_between') {
    const t = colDef.type === 'date' ? 'date' : (colDef.type === 'number' ? 'number' : 'text');
    return `<div class="d-flex gap-1">
      <input type="${t}" class="form-control form-control-sm filter-val1" placeholder="from">
      <input type="${t}" class="form-control form-control-sm filter-val2" placeholder="to">
    </div>`;
  }
  if (condition === 'in_last_days') {
    return `<input type="number" class="form-control form-control-sm filter-val1" placeholder="days" min="1" value="30" style="max-width:100px">`;
  }
  if (colDef.type === 'enum' && colDef.values) {
    return `<select class="form-select form-select-sm filter-val1">
      ${colDef.values.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('')}
    </select>`;
  }
  if (colDef.type === 'date')   return `<input type="date" class="form-control form-control-sm filter-val1">`;
  if (colDef.type === 'number') return `<input type="number" class="form-control form-control-sm filter-val1" placeholder="value">`;
  return `<input type="text" class="form-control form-control-sm filter-val1" placeholder="value">`;
}

function onFilterFieldChange(rowId, fieldKey) {
  const schema = builderSchema[builderEntity];
  const colDef = schema[fieldKey];
  const rowDiv = document.querySelector(`.filter-row[data-id="${rowId}"]`);
  if (!rowDiv || !colDef) return;
  const conditions = getConditionsForType(colDef.type);
  rowDiv.querySelector('.filter-condition').innerHTML =
    conditions.map(c => `<option value="${c}">${CONDITION_LABELS[c]||c}</option>`).join('');
  rowDiv.querySelector('.filter-value-wrap').innerHTML = buildValueInput(colDef, conditions[0]);
  rowDiv.querySelector('.filter-condition').addEventListener('change', e => onFilterConditionChange(rowId, e.target.value));
}

function onFilterConditionChange(rowId, condition) {
  const schema = builderSchema[builderEntity];
  const rowDiv = document.querySelector(`.filter-row[data-id="${rowId}"]`);
  if (!rowDiv) return;
  const colDef = schema[rowDiv.querySelector('.filter-field').value];
  if (!colDef) return;
  rowDiv.querySelector('.filter-value-wrap').innerHTML = buildValueInput(colDef, condition);
}

function removeFilterRow(rowId) {
  document.querySelector(`.filter-row[data-id="${rowId}"]`)?.remove();
  if (!document.querySelector('#builder-filters .filter-row')) {
    document.getElementById('builder-filters').innerHTML =
      '<p class="text-muted small mb-0 p-2" id="no-filters-msg">No filters — results include all records.</p>';
  }
}

function collectFilters() {
  return [...document.querySelectorAll('#builder-filters .filter-row')].map(row => ({
    field:     row.querySelector('.filter-field')?.value,
    condition: row.querySelector('.filter-condition')?.value,
    value:     row.querySelector('.filter-val1')?.value?.trim() ?? '',
    value2:    row.querySelector('.filter-val2')?.value?.trim() ?? '',
  })).filter(f => f.field && f.condition);
}

async function runBuilder() {
  if (!builderEntity) { showToast('Please select a data source first.', 'warning'); return; }
  const columns = [...document.querySelectorAll('#builder-columns input[type="checkbox"]:checked')].map(cb => cb.value);
  if (!columns.length) { showToast('Please select at least one column.', 'warning'); return; }

  lastBuilderPayload = {
    entity:    builderEntity,
    columns,
    filters:   collectFilters(),
    sortBy:    document.getElementById('builder-sort-col').value || null,
    sortOrder: document.getElementById('builder-sort-order').value,
    from:      document.getElementById('builder-from').value || null,
    to:        document.getElementById('builder-to').value   || null,
  };

  document.getElementById('builder-results-placeholder').classList.add('d-none');
  document.getElementById('builder-results-area').classList.add('d-none');
  document.getElementById('builder-results-loading').classList.remove('d-none');

  try {
    const data = await fetchAPI('/api/reports/builder', { method: 'POST', body: lastBuilderPayload });

    lastBuilderRows = data.rows;
    document.getElementById('br-count').textContent = `${data.count} record${data.count !== 1 ? 's' : ''}`;

    // Populate group-by dropdown from result columns
    const groupSel = document.getElementById('br-group-by');
    groupSel.innerHTML = '<option value="">Group by…</option>' +
      Object.keys(data.rows[0] || {}).map(k => `<option value="${escHtml(k)}">${escHtml(k)}</option>`).join('');

    // Reset chart controls
    document.getElementById('br-chart-type').value = 'none';
    document.getElementById('br-group-by').classList.add('d-none');
    document.getElementById('builder-chart-wrapper').classList.add('d-none');
    document.getElementById('btn-br-png').classList.add('d-none');
    if (builderChart) { builderChart.destroy(); builderChart = null; }

    renderBuilderTable(data.rows);
    document.getElementById('builder-results-area').classList.remove('d-none');
  } catch (err) {
    showToast('Query failed: ' + err.message, 'danger');
    document.getElementById('builder-results-placeholder').classList.remove('d-none');
  } finally {
    document.getElementById('builder-results-loading').classList.add('d-none');
  }
}

function renderBuilderTable(rows) {
  const thead = document.getElementById('builder-thead');
  const tbody = document.getElementById('builder-tbody');
  if (!rows || !rows.length) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td class="text-center text-muted py-4">No records found.</td></tr>';
    return;
  }
  const cols = Object.keys(rows[0]);
  thead.innerHTML = '<tr>' + cols.map(c => `<th>${escHtml(c)}</th>`).join('') + '</tr>';
  tbody.innerHTML = rows.map(r =>
    '<tr>' + cols.map(c => `<td title="${escHtml(String(r[c]??''))}">${escHtml(String(r[c]??'—'))}</td>`).join('') + '</tr>'
  ).join('');
}

function rerenderBuilderChart() {
  const chartType = document.getElementById('br-chart-type').value;
  const groupBy   = document.getElementById('br-group-by').value;
  const pngBtn    = document.getElementById('btn-br-png');
  const wrapper   = document.getElementById('builder-chart-wrapper');

  if (chartType === 'none' || !groupBy || !lastBuilderRows?.length) {
    wrapper.classList.add('d-none');
    pngBtn.classList.add('d-none');
    return;
  }

  // Client-side aggregation: count occurrences per group-by value
  const agg = {};
  lastBuilderRows.forEach(r => {
    const v = r[groupBy] != null ? String(r[groupBy]) : 'None';
    agg[v] = (agg[v] || 0) + 1;
  });
  const sorted = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 20);

  const chartData = {
    type: chartType,
    labels: sorted.map(x => x[0]),
    datasets: [{
      label: groupBy,
      data: sorted.map(x => x[1]),
      backgroundColor: sorted.map((_, i) => PALETTE[i % PALETTE.length]),
      borderRadius: 4,
    }],
  };

  wrapper.classList.remove('d-none');
  pngBtn.classList.remove('d-none');
  if (builderChart) { builderChart.destroy(); builderChart = null; }
  builderChart = new Chart(document.getElementById('builder-chart').getContext('2d'), buildChartConfig(chartData));
}

async function exportBuilderData(fmt) {
  if (!lastBuilderPayload) return;
  const qs = new URLSearchParams({ export: fmt === 'csv' ? 'csv' : '1' });
  try {
    const resp = await fetch('/api/reports/builder?' + qs, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(lastBuilderPayload),
    });
    if (!resp.ok) throw new Error('Export failed');
    const blob = await resp.blob();
    const cd   = resp.headers.get('Content-Disposition') || '';
    const name = cd.match(/filename="(.+?)"/)?.[1] || `report.${fmt === 'csv' ? 'csv' : 'xlsx'}`;
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
    showToast('Download started');
  } catch (err) {
    showToast('Export failed: ' + err.message, 'danger');
  }
}

// ── Saved Reports ──────────────────────────────────────────────────────────────
async function loadSavedReportsQuickTab() {
  try {
    const reports = await fetchAPI('/api/reports/saved');
    const section = document.getElementById('saved-reports-quick-section');
    const list    = document.getElementById('saved-reports-quick-list');
    if (!reports.length) { section.classList.add('d-none'); return; }
    section.classList.remove('d-none');
    list.innerHTML = reports.map(r => `
      <div class="col-auto">
        <div class="card report-card shadow-sm" style="min-width:130px;position:relative"
             onclick="openSavedReport(${r.ReportID})">
          <div class="card-body text-center">
            <i class="bi bi-bookmark-fill report-icon text-primary d-block mb-1"></i>
            <div class="report-label">${escHtml(r.ReportName)}</div>
            <div class="text-muted" style="font-size:.65rem">${escHtml(r.Entity)}</div>
          </div>
          <button class="btn btn-sm btn-outline-danger position-absolute top-0 end-0 m-1 p-0"
                  style="width:1.3rem;height:1.3rem;font-size:.65rem;line-height:1"
                  onclick="event.stopPropagation();deleteSavedReport(${r.ReportID})"
                  title="Delete">
            <i class="bi bi-x"></i>
          </button>
        </div>
      </div>`).join('');
  } catch (_) { /* silently ignore */ }
}

async function openSavedReport(id) {
  try {
    const reports = await fetchAPI('/api/reports/saved');
    const r = reports.find(x => x.ReportID === id);
    if (!r) return;
    switchTab('builder');
    selectBuilderEntity(r.Entity);
    const cols    = JSON.parse(r.Columns || '[]');
    const filters = JSON.parse(r.Filters || '[]');
    document.querySelectorAll('#builder-columns input[type="checkbox"]').forEach(cb => {
      cb.checked = !cols.length || cols.includes(cb.value);
    });
    if (r.SortBy) document.getElementById('builder-sort-col').value = r.SortBy;
    document.getElementById('builder-sort-order').value = r.SortOrder || 'ASC';
    filters.forEach(f => {
      addFilterRow();
      const rows    = document.querySelectorAll('#builder-filters .filter-row');
      const lastRow = rows[rows.length - 1];
      if (!lastRow) return;
      lastRow.querySelector('.filter-field').value = f.field;
      onFilterFieldChange(lastRow.dataset.id, f.field);
      lastRow.querySelector('.filter-condition').value = f.condition;
      onFilterConditionChange(lastRow.dataset.id, f.condition);
      const v1 = lastRow.querySelector('.filter-val1');
      const v2 = lastRow.querySelector('.filter-val2');
      if (v1) v1.value = f.value  || '';
      if (v2) v2.value = f.value2 || '';
    });
    await runBuilder();
  } catch (err) {
    showToast('Failed to load saved report: ' + err.message, 'danger');
  }
}

function openSaveModal() {
  if (!lastBuilderPayload) { showToast('Run a report first.', 'warning'); return; }
  document.getElementById('save-report-name').value = '';
  new bootstrap.Modal(document.getElementById('save-modal')).show();
}

async function confirmSaveReport() {
  const name = document.getElementById('save-report-name').value.trim();
  if (!name) { showToast('Please enter a report name.', 'warning'); return; }
  if (!lastBuilderPayload) return;
  try {
    await fetchAPI('/api/reports/saved', { method: 'POST', body: {
      ReportName: name,
      Entity:     lastBuilderPayload.entity,
      Columns:    lastBuilderPayload.columns,
      Filters:    lastBuilderPayload.filters,
      SortBy:     lastBuilderPayload.sortBy,
      SortOrder:  lastBuilderPayload.sortOrder,
    }});
    bootstrap.Modal.getInstance(document.getElementById('save-modal')).hide();
    showToast(`"${name}" saved to Quick Reports`);
    loadSavedReportsQuickTab();
  } catch (err) {
    showToast('Save failed: ' + err.message, 'danger');
  }
}

async function deleteSavedReport(id) {
  showConfirmModal('Delete Saved Report', '<p>Delete this saved report? This cannot be undone.</p>', async () => {
    try {
      await fetchAPI(`/api/reports/saved/${id}`, { method: 'DELETE' });
      showToast('Report deleted', 'danger');
      loadSavedReportsQuickTab();
    } catch (err) { showToast('Delete failed: ' + err.message, 'danger'); }
  });
}

// ── Chart.js ───────────────────────────────────────────────────────────────────
function buildChartConfig(chartData) {
  const isPie = ['pie','doughnut'].includes(chartData.type);
  return {
    type: chartData.type,
    data: { labels: chartData.labels, datasets: chartData.datasets },
    options: {
      responsive: true, maintainAspectRatio: true,
      animation: { duration: 400 },
      plugins: {
        legend: { display: isPie || chartData.datasets.length > 1, position: 'bottom' },
        tooltip: { callbacks: {
          label: ctx => {
            if (isPie) {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct   = total ? Math.round(ctx.parsed / total * 100) : 0;
              return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
            }
            const val = ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed;
            return ` ${ctx.dataset.label || ''}: ${val}`;
          },
        }},
      },
      scales: isPie ? {} : {
        x: { ticks: { maxRotation: 45 } },
        y: { beginAtZero: true },
      },
      indexAxis: chartData.indexAxis || 'x',
    },
  };
}

function downloadChartPNG(canvasId, name) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const a = document.createElement('a');
  a.download = `${name || 'chart'}-${Date.now()}.png`;
  a.href     = canvas.toDataURL('image/png');
  a.click();
  showToast('Chart downloaded');
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function triggerDownload(url) {
  const a = document.createElement('a');
  a.href = url; a.click();
}

function escHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
