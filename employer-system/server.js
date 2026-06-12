const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');
const session  = require('express-session');
const bcrypt   = require('bcrypt');

const app  = express();
const PORT = 3000;

// ── Database init ──────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH  = path.join(DATA_DIR, 'employer.db');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
const schema = fs.readFileSync(path.join(__dirname, 'database', 'schema.sql'), 'utf8');
db.exec(schema);
app.locals.db = db;

// ── Schema migrations for existing databases ───────────────────────────────────
try { db.exec("ALTER TABLE Users ADD COLUMN Role TEXT NOT NULL DEFAULT 'admin'"); } catch (_) {}

// ── Seed default admin user on first run ───────────────────────────────────────
(async () => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM Users').get().n;
  if (count === 0) {
    const hash = await bcrypt.hash('admin123', 12);
    db.prepare("INSERT INTO Users (Username, PasswordHash, Role) VALUES ('admin', ?, 'admin')").run(hash);
    console.log('Default user created — username: admin, password: admin123');
  }
})();

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'ero-system-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }, // 24h
}));

// ── Simple login rate limiter ──────────────────────────────────────────────────
const loginAttempts = new Map();
function loginRateLimiter(req, res, next) {
  const ip  = req.ip;
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + 15 * 60 * 1000; }
  rec.count++;
  loginAttempts.set(ip, rec);
  if (rec.count > 10) return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
  next();
}

// ── Auth middleware ────────────────────────────────────────────────────────────
const PUBLIC_PATHS = ['/login.html', '/api/auth/login', '/css/', '/js/', '/favicon'];

function requireAuth(req, res, next) {
  const p = req.path;
  if (PUBLIC_PATHS.some(pub => p.startsWith(pub))) return next();
  if (req.session?.userId) return next();

  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  res.redirect('/login.html');
}

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// ── Viewer role: block all state-changing requests ────────────────────────────
function requireAdmin(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const role = req.session?.role || 'admin';
    if (role !== 'admin') {
      return res.status(403).json({ error: 'Viewers cannot make changes. Contact an admin.' });
    }
  }
  next();
}

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/auth/login',       loginRateLimiter);
app.use('/api/auth',             require('./routes/auth'));
app.use('/api/companies',        requireAdmin, require('./routes/companies'));
app.use('/api/contacts',         requireAdmin, require('./routes/contacts'));
app.use('/api/outreach',         requireAdmin, require('./routes/outreach'));
app.use('/api/recruitment',      requireAdmin, require('./routes/recruitment'));
app.use('/api/career-events',    requireAdmin, require('./routes/career-events'));
app.use('/api/collaboration',    requireAdmin, require('./routes/collaboration'));
app.use('/api/academic',         requireAdmin, require('./routes/academic'));
app.use('/api/student-events',   requireAdmin, require('./routes/student-events'));
app.use('/api/hiring-feedback',  requireAdmin, require('./routes/hiring-feedback'));
app.use('/api/reports',          require('./routes/reports'));
app.use('/api/dashboard',        require('./routes/dashboard'));
app.use('/api/import',           requireAdmin, require('./routes/import'));
app.use('/api/users',            require('./routes/users'));

// Root redirect
app.get('/', (req, res) => res.redirect('/index.html'));

// 404 fallback
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, () => {
  console.log(`Employer Relations System running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});

module.exports = { app, db };
