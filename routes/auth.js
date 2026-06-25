const express = require('express');
const bcrypt  = require('bcrypt');
const router  = express.Router();
const { requirePassword, requireString, requireTrimmedString, sendValidationError } = require('./_validation');

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'viewer';
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const db = req.app.locals.db;
  try {
    const username = requireTrimmedString(req.body.username, 'Username', 64);
    const password = requireString(req.body.password, 'Password');

    const user = db.prepare('SELECT * FROM Users WHERE Username = ?').get(username);
    const match = user ? await bcrypt.compare(password, user.PasswordHash) : false;
    if (!user || !match) return res.status(401).json({ error: 'Invalid username or password' });
    const role = normalizeRole(user.Role);

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Unable to start session' });
      req.session.userId = user.UserID;
      req.session.username = user.Username;
      req.session.role = role;
      res.json({ success: true, username: user.Username, role });
    });
  } catch (err) {
    sendValidationError(res, err);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ero.sid');
    res.json({ success: true });
  });
});

// GET /api/auth/check
router.get('/check', (req, res) => {
  if (req.session?.userId) {
    res.json({
      authenticated: true,
      username: req.session.username,
      role: normalizeRole(req.session.role),
      userId: req.session.userId,
    });
  } else {
    res.status(401).json({ authenticated: false });
  }
});

// POST /api/auth/change-password
router.post('/change-password', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });

  const db = req.app.locals.db;
  try {
    const currentPassword = requireString(req.body.currentPassword, 'Current password');
    const newPassword = requirePassword(req.body.newPassword, 'New password');

    const user = db.prepare('SELECT * FROM Users WHERE UserID = ?').get(req.session.userId);
    const match = user ? await bcrypt.compare(currentPassword, user.PasswordHash) : false;
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    db.prepare('UPDATE Users SET PasswordHash = ? WHERE UserID = ?').run(hash, req.session.userId);
    res.json({ success: true });
  } catch (err) {
    sendValidationError(res, err);
  }
});

module.exports = router;
