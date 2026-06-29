const express = require('express');
const bcrypt  = require('bcrypt');
const router  = express.Router();
const { requirePassword, requireString, requireTrimmedString, sendValidationError } = require('./_validation');
const { isInsecurePassword } = require('../lib/password-policy');

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'viewer';
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const db = req.app.locals.db;
  try {
    const username = requireTrimmedString(req.body.username, 'Username', 64);
    const password = requireString(req.body.password, 'Password');

    const user = (await db.prepare('SELECT * FROM Users WHERE Username = ?').get(username));
    const match = user ? await bcrypt.compare(password, user.PasswordHash) : false;
    if (!user || !match) return res.status(401).json({ error: 'Invalid username or password' });
    const role = normalizeRole(user.Role);
    const mustChangePassword = Boolean(user.MustChangePassword) || isInsecurePassword(password);

    if (mustChangePassword && !user.MustChangePassword) {
      (await db.prepare('UPDATE Users SET MustChangePassword = 1 WHERE UserID = ?').run(user.UserID));
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Unable to start session' });
      req.session.userId = user.UserID;
      req.session.username = user.Username;
      req.session.role = role;
      req.session.mustChangePassword = mustChangePassword;
      res.json({ success: true, username: user.Username, role, mustChangePassword });
    });
  } catch (err) {
    sendValidationError(res, err);
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ero.sid');
    res.json({ success: true });
  });
});

// GET /api/auth/check
router.get('/check', async (req, res) => {
  if (req.session?.userId) {
    res.json({
      authenticated: true,
      username: req.session.username,
      role: normalizeRole(req.session.role),
      userId: req.session.userId,
      mustChangePassword: Boolean(req.session.mustChangePassword),
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
    if (isInsecurePassword(newPassword)) {
      return res.status(400).json({ error: 'Choose a stronger password than the default one.' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: 'New password must be different from the current password.' });
    }

    const user = (await db.prepare('SELECT * FROM Users WHERE UserID = ?').get(req.session.userId));
    const match = user ? await bcrypt.compare(currentPassword, user.PasswordHash) : false;
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    (await db.prepare('UPDATE Users SET PasswordHash = ?, MustChangePassword = 0 WHERE UserID = ?').run(hash, req.session.userId));
    req.session.mustChangePassword = false;
    res.json({ success: true });
  } catch (err) {
    sendValidationError(res, err);
  }
});

module.exports = router;
