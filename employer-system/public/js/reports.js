let currentRows = [];
let currentType = '';

const REPORT_LABELS = {
  companies:          'Companies (non-blacklisted)',
  mailable:           'Mailable Contacts',
  event_invitation:   'Event Invitation List',
  resume_book:        'Resume Book Contacts',
  non_mailable:       'Non-Mailable Contacts',
  follow_up:          'Follow-Up Action Items',
  engagement_summary: 'Employer Engagement Summary',
  recruitment:        'Recruitment Postings',
  career_events:      'Career Event Attendance',
  hiring_feedback:    'Hiring Feedback',
  job_outreach:       'Contacts for Job/Internship Outreach',
};

// Highlight overdue rows in follow_up report
const OVERDUE_TYPE = 'follow_up';
const TODAY = new Date().toISOString().slice(0, 10);

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-preview').addEventListener('click', handlePreview);
  document.getElementById('btn-export').addEventListener('click', handleExport);
});

async function handlePreview() {
  const type = document.getElementById('report-type').value;
  if (!type) { showToast('Please select a report type', 'warning'); return; }

  const from = document.getElementById('filter-from').value;
  const to   = document.getElementById('filter-to').value;

  const btn = document.getElementById('btn-preview');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Loading…';

  try {
    const params = new URLSearchParams({ ...(from && { from }), ...(to && { to }) });
    const data = await fetchAPI(`/api/reports/${type}?${params}`);
    currentRows = data.rows;
    currentType = type;

    renderResults(type, data.rows, data.count);
    document.getElementById('btn-export').disabled = data.rows.length === 0;
  } catch (err) {
    showToast('Failed to load report: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-eye me-1"></i>Preview';
  }
}

function renderResults(type, rows, count) {
  document.getElementById('empty-state').classList.add('d-none');
  document.getElementById('results-section').classList.remove('d-none');
  document.getElementById('results-title').textContent = REPORT_LABELS[type] || type;
  document.getElementById('results-count').textContent = `${count} row${count !== 1 ? 's' : ''}`;

  if (rows.length === 0) {
    document.getElementById('results-thead').innerHTML = '';
    document.getElementById('results-tbody').innerHTML =
      '<tr><td class="text-center text-muted py-4">No data found for the selected filters.</td></tr>';
    return;
  }

  const cols = Object.keys(rows[0]);

  document.getElementById('results-thead').innerHTML =
    '<tr>' + cols.map(c => `<th>${escHtml(c)}</th>`).join('') + '</tr>';

  document.getElementById('results-tbody').innerHTML = rows.map(row => {
    // Highlight overdue follow-ups
    const rowClass = (type === OVERDUE_TYPE && row['Follow-up Date'] && row['Follow-up Date'] < TODAY)
      ? 'table-danger'
      : '';
    const cells = cols.map(c => {
      let val = row[c];
      if (val === null || val === undefined) val = '';
      if (typeof val === 'number' && (c.toLowerCase().includes('mou') || c.toLowerCase().includes('alumni') || c.toLowerCase().includes('speaker') || c.toLowerCase().includes('arabic'))) {
        val = val ? 'Yes' : 'No';
      }
      return `<td>${escHtml(String(val))}</td>`;
    }).join('');
    return `<tr class="${rowClass}">${cells}</tr>`;
  }).join('');
}

async function handleExport() {
  if (!currentType || currentRows.length === 0) return;

  const from = document.getElementById('filter-from').value;
  const to   = document.getElementById('filter-to').value;
  const params = new URLSearchParams({ export: '1', ...(from && { from }), ...(to && { to }) });

  const btn = document.getElementById('btn-export');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Exporting…';

  try {
    const res = await fetch(`/api/reports/${currentType}?${params}`);
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `report-${currentType}-${TODAY}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Report exported successfully');
  } catch (err) {
    showToast('Export failed: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-download me-1"></i>Export Excel';
  }
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
