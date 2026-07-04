const express = require('express');
const bcrypt  = require('bcrypt');
const router  = express.Router();
const { asyncRoute, requiredTrimmed } = require('./_helpers');

// POST /api/auth/login
router.post('/login', asyncRoute(async (req, res) => {
  const db = req.app.locals.db;
  const { username, password } = req.body;

  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required' });

  const trimmedUsername = requiredTrimmed(username, 'Username');
  const user = db.prepare('SELECT * FROM Users WHERE Username = ?').get(trimmedUsername);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });

  const match = await bcrypt.compare(password, user.PasswordHash);
  if (!match) return res.status(401).json({ error: 'Invalid username or password' });

  req.session.userId   = user.UserID;
  req.session.username = user.Username;
  req.session.role     = user.Role || 'admin';
  // Successful login: clear this IP's login rate-limit counter so only
  // failed attempts count toward the limit.
  if (req.loginRateLimit) req.loginRateLimit.success();
  res.json({ success: true, username: user.Username, role: req.session.role });
}));

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// GET /api/auth/check
router.get('/check', (req, res) => {
  if (req.session?.userId) {
    res.json({ authenticated: true, username: req.session.username, role: req.session.role || 'admin', userId: req.session.userId });
  } else {
    res.status(401).json({ authenticated: false });
  }
});

// POST /api/auth/change-password
router.post('/change-password', asyncRoute(async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });

  const db = req.app.locals.db;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Both current and new password are required' });
  if (newPassword.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });

  const user = db.prepare('SELECT * FROM Users WHERE UserID = ?').get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const match = await bcrypt.compare(currentPassword, user.PasswordHash);
  if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE Users SET PasswordHash = ? WHERE UserID = ?').run(hash, req.session.userId);
  res.json({ success: true });
}));

module.exports = router;
