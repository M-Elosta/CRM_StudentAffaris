const express = require('express');
const bcrypt  = require('bcrypt');
const router  = express.Router();
const { asyncRoute, requiredTrimmed } = require('./_helpers');

function requireAdminSession(req, res, next) {
  if ((req.session?.role || 'admin') !== 'admin') {
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
router.post('/', requireAdminSession, asyncRoute(async (req, res) => {
  const db = req.app.locals.db;
  const { username, password, role } = req.body;
  if (!username || !password)                      return res.status(400).json({ error: 'Username and password are required.' });
  if (password.length < 6)                         return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (!['admin', 'viewer'].includes(role))          return res.status(400).json({ error: 'Role must be admin or viewer.' });
  const trimmedUsername = requiredTrimmed(username, 'Username');
  if (db.prepare('SELECT UserID FROM Users WHERE Username=?').get(trimmedUsername))
                                                    return res.status(409).json({ error: 'Username already exists.' });
  const hash   = await bcrypt.hash(password, 12);
  const result = db.prepare("INSERT INTO Users (Username,PasswordHash,Role) VALUES (?,?,?)").run(trimmedUsername, hash, role);
  res.status(201).json({ UserID: result.lastInsertRowid, Username: trimmedUsername, Role: role });
}));

// PATCH /api/users/:id/role — change role
router.patch('/:id/role', requireAdminSession, (req, res) => {
  const db   = req.app.locals.db;
  const id   = Number(req.params.id);
  const { role } = req.body;
  if (!['admin', 'viewer'].includes(role))    return res.status(400).json({ error: 'Role must be admin or viewer.' });
  if (id === req.session.userId)              return res.status(403).json({ error: 'Cannot change your own role.' });

  // Block demoting the last admin
  if (role === 'viewer') {
    const target = db.prepare('SELECT Role FROM Users WHERE UserID=?').get(id);
    if (!target)                              return res.status(404).json({ error: 'User not found.' });
    if (target.Role === 'admin' && adminCount(db) <= 1)
                                              return res.status(403).json({ error: 'Cannot remove the last admin account.' });
  }
  const result = db.prepare('UPDATE Users SET Role=? WHERE UserID=?').run(role, id);
  if (!result.changes)                        return res.status(404).json({ error: 'User not found.' });
  res.json({ success: true });
});

// DELETE /api/users/:id — delete user
router.delete('/:id', requireAdminSession, (req, res) => {
  const db = req.app.locals.db;
  const id = Number(req.params.id);
  if (id === req.session.userId)             return res.status(403).json({ error: 'Cannot delete your own account.' });

  // Block deleting the last admin
  const target = db.prepare('SELECT Role FROM Users WHERE UserID=?').get(id);
  if (!target)                               return res.status(404).json({ error: 'User not found.' });
  if (target.Role === 'admin' && adminCount(db) <= 1)
                                             return res.status(403).json({ error: 'Cannot remove the last admin account.' });

  db.prepare('DELETE FROM Users WHERE UserID=?').run(id);
  res.json({ success: true });
});

module.exports = router;
