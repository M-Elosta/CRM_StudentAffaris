const express = require('express');
const bcrypt  = require('bcrypt');
const router  = express.Router();
const {
  requireEnum,
  requirePassword,
  requirePositiveInt,
  requireUsername,
  sendValidationError,
} = require('./_validation');
const { isInsecurePassword } = require('../lib/password-policy');

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'viewer';
}

function requireAdminSession(req, res, next) {
  if (normalizeRole(req.session?.role) !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

function adminCount(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM Users WHERE Role='admin'").get().n;
}

// GET /api/users
router.get('/', requireAdminSession, (req, res) => {
  const rows = req.app.locals.db.prepare(
    "SELECT UserID, Username, Role, CreatedAt FROM Users ORDER BY CreatedAt"
  ).all();
  res.json(rows);
});

// POST /api/users — create user
router.post('/', requireAdminSession, async (req, res) => {
  const db = req.app.locals.db;
  try {
    const username = requireUsername(req.body.username);
    const password = requirePassword(req.body.password);
    const role = requireEnum(req.body.role, 'Role', ['admin', 'viewer']);

    if (db.prepare('SELECT UserID FROM Users WHERE Username=?').get(username)) {
      return res.status(409).json({ error: 'Username already exists.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO Users (Username,PasswordHash,Role,MustChangePassword) VALUES (?,?,?,?)')
      .run(username, hash, role, isInsecurePassword(password) ? 1 : 0);
    res.status(201).json({ UserID: result.lastInsertRowid, Username: username, Role: role });
  } catch (err) {
    sendValidationError(res, err);
  }
});

// PATCH /api/users/:id/role — change role
router.patch('/:id/role', requireAdminSession, (req, res) => {
  const db = req.app.locals.db;
  try {
    const id = requirePositiveInt(req.params.id, 'User ID');
    const role = requireEnum(req.body.role, 'Role', ['admin', 'viewer']);
    if (id === req.session.userId) return res.status(403).json({ error: 'Cannot change your own role.' });

    if (role === 'viewer') {
      const target = db.prepare('SELECT Role FROM Users WHERE UserID=?').get(id);
      if (!target) return res.status(404).json({ error: 'User not found.' });
      if (target.Role === 'admin' && adminCount(db) <= 1) {
        return res.status(403).json({ error: 'Cannot remove the last admin account.' });
      }
    }

    const result = db.prepare('UPDATE Users SET Role=? WHERE UserID=?').run(role, id);
    if (!result.changes) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true });
  } catch (err) {
    sendValidationError(res, err);
  }
});

// DELETE /api/users/:id — delete user
router.delete('/:id', requireAdminSession, (req, res) => {
  const db = req.app.locals.db;
  try {
    const id = requirePositiveInt(req.params.id, 'User ID');
    if (id === req.session.userId) return res.status(403).json({ error: 'Cannot delete your own account.' });

    const target = db.prepare('SELECT Role FROM Users WHERE UserID=?').get(id);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.Role === 'admin' && adminCount(db) <= 1) {
      return res.status(403).json({ error: 'Cannot remove the last admin account.' });
    }

    db.prepare('DELETE FROM Users WHERE UserID=?').run(id);
    res.json({ success: true });
  } catch (err) {
    sendValidationError(res, err);
  }
});

module.exports = router;
