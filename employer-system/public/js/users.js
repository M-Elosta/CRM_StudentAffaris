let pageInited = false;

function applyRole(role) {
  if (pageInited) return;
  if (role !== 'admin') {
    document.getElementById('access-denied').classList.remove('d-none');
    document.getElementById('btn-add-user').classList.add('d-none');
    return;
  }
  pageInited = true;
  initUsersPage();
}

document.addEventListener('approleready', e => applyRole(e.detail.role));

// Safety net: if role was already resolved synchronously (cache hit) before this listener registered
document.addEventListener('DOMContentLoaded', () => {
  if (window.appRole) applyRole(window.appRole);
});

function initUsersPage() {
  document.getElementById('users-content').classList.remove('d-none');
  loadUsers();

  document.getElementById('btn-add-user').addEventListener('click', () => {
    document.getElementById('add-user-form').reset();
    document.getElementById('add-user-error').classList.add('d-none');
    new bootstrap.Modal(document.getElementById('add-user-modal')).show();
  });

  document.getElementById('add-user-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('add-user-error');
    errEl.classList.add('d-none');
    const btn = document.getElementById('btn-save-user');
    btn.disabled = true;
    try {
      await fetchAPI('/api/users', {
        method: 'POST',
        body: {
          username: document.getElementById('new-username').value.trim(),
          password: document.getElementById('new-password').value,
          role:     document.getElementById('new-role').value,
        },
      });
      bootstrap.Modal.getInstance(document.getElementById('add-user-modal')).hide();
      showToast('User created successfully');
      loadUsers();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('d-none');
    } finally {
      btn.disabled = false;
    }
  });
}

async function loadUsers() {
  try {
    const users = await fetchAPI('/api/users');
    renderUsers(users);
  } catch (err) {
    showToast('Failed to load users: ' + err.message, 'danger');
  }
}

function renderUsers(users) {
  const tbody = document.getElementById('users-tbody');
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">No users found.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map(u => {
    const roleBadge = u.Role === 'admin'
      ? `<span class="badge bg-primary">Admin</span>`
      : `<span class="badge bg-secondary">Viewer</span>`;

    const roleSwitch = u.Role === 'admin'
      ? `<button class="btn btn-sm btn-outline-secondary" onclick="changeRole(${u.UserID}, 'viewer')" title="Demote to Viewer"><i class="bi bi-arrow-down-circle me-1"></i>Set Viewer</button>`
      : `<button class="btn btn-sm btn-outline-primary" onclick="changeRole(${u.UserID}, 'admin')" title="Promote to Admin"><i class="bi bi-arrow-up-circle me-1"></i>Set Admin</button>`;

    const deleteBtn = `<button class="btn btn-sm btn-outline-danger ms-1" onclick="deleteUser(${u.UserID}, '${escHtml(u.Username)}')" title="Delete"><i class="bi bi-trash"></i></button>`;

    const created = u.CreatedAt ? new Date(u.CreatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

    return `
      <tr>
        <td class="px-3 fw-semibold"><i class="bi bi-person-circle me-2 text-muted"></i>${escHtml(u.Username)}</td>
        <td>${roleBadge}</td>
        <td class="text-muted small">${created}</td>
        <td class="text-end px-3">${roleSwitch}${deleteBtn}</td>
      </tr>`;
  }).join('');
}

async function changeRole(userId, newRole) {
  try {
    await fetchAPI(`/api/users/${userId}/role`, { method: 'PATCH', body: { role: newRole } });
    showToast(`Role updated to ${newRole}`);
    loadUsers();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

function deleteUser(userId, username) {
  showConfirmModal(
    'Delete User',
    `<p>Delete user <strong>${escHtml(username)}</strong>? This cannot be undone.</p>`,
    async () => {
      try {
        await fetchAPI(`/api/users/${userId}`, { method: 'DELETE' });
        showToast('User deleted');
        loadUsers();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    },
    'Delete',
    'btn-danger'
  );
}

function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
