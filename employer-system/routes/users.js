const express = require('express');
const bcrypt  = require('bcrypt');
const router  = express.Router();

function requireAdminSession(req, res, next) {
  if ((req.session?.role || 'admin') !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

// GET /api/users — list all users (admin only)
router.get('/', requireAdminSession, (req, res) => {
  const db = req.app.locals.db;
  const rows = db.prepare(
    "SELECT UserID, Username, Role, CreatedAt FROM Users ORDER BY CreatedAt"
  ).all();
  res.json(rows);
});

// POST /api/users — create user (admin only)
router.post('/', requireAdminSession, async (req, res) => {
  const db = req.app.locals.db;
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
  if (password.length < 6)    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (!['admin', 'viewer'].includes(role)) return res.status(400).json({ error: 'Role must be admin or viewer.' });

  const existing = db.prepare('SELECT UserID FROM Users WHERE Username = ?').get(username.trim());
  if (existing) return res.status(409).json({ error: 'Username already exists.' });

  const hash = await bcrypt.hash(password, 12);
  const result = db.prepare(
    "INSERT INTO Users (Username, PasswordHash, Role) VALUES (?, ?, ?)"
  ).run(username.trim(), hash, role);
  res.status(201).json({ UserID: result.lastInsertRowid, Username: username.trim(), Role: role });
});

// PATCH /api/users/:id/role — change role (admin only, cannot change own role)
router.patch('/:id/role', requireAdminSession, (req, res) => {
  const db  = req.app.locals.db;
  const id  = Number(req.params.id);
  const { role } = req.body;
  if (!['admin', 'viewer'].includes(role)) return res.status(400).json({ error: 'Role must be admin or viewer.' });
  if (id === req.session.userId) return res.status(403).json({ error: 'Cannot change your own role.' });
  const result = db.prepare('UPDATE Users SET Role = ? WHERE UserID = ?').run(role, id);
  if (!result.changes) return res.status(404).json({ error: 'User not found.' });
  res.json({ success: true });
});

// DELETE /api/users/:id — delete user (admin only, cannot delete self)
router.delete('/:id', requireAdminSession, (req, res) => {
  const db = req.app.locals.db;
  const id = Number(req.params.id);
  if (id === req.session.userId) return res.status(403).json({ error: 'Cannot delete your own account.' });
  const result = db.prepare('DELETE FROM Users WHERE UserID = ?').run(id);
  if (!result.changes) return res.status(404).json({ error: 'User not found.' });
  res.json({ success: true });
});

module.exports = router;
