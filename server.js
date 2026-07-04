const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const Database = require('better-sqlite3');
const session  = require('express-session');
const bcrypt   = require('bcrypt');

const app  = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;

// ── Database init ──────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH  = path.join(DATA_DIR, 'employer.db');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
const schema = fs.readFileSync(path.join(__dirname, 'database', 'schema.sql'), 'utf8');

// ── Pre-schema migrations for existing databases ───────────────────────────────
// schema.sql defines AFTER UPDATE triggers that reference UpdatedAt. On an old
// database those tables already exist WITHOUT the column, so the column must be
// added before db.exec(schema) creates the triggers. SQLite cannot ADD COLUMN
// with a non-constant default, so we add it bare and backfill from CreatedAt.
const UPDATED_AT_TABLES = [
  'Company', 'Contact', 'OutreachEngagement', 'Recruitment',
  'PotentialCollaboration', 'HiringFeedback', 'CareerEvent',
  'StudentLedEvent', 'AcademicClassroomEngagement',
];
for (const table of UPDATED_AT_TABLES) {
  const columns = db.pragma(`table_info(${table})`);
  if (columns.length === 0) continue; // table doesn't exist yet — schema.sql will create it with UpdatedAt
  if (!columns.some(col => col.name === 'UpdatedAt')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN UpdatedAt DATETIME`);
    db.exec(`UPDATE ${table} SET UpdatedAt = COALESCE(CreatedAt, datetime('now')) WHERE UpdatedAt IS NULL`);
  }
}

db.exec(schema);
app.locals.db = db;

// ── Schema migrations for existing databases ───────────────────────────────────
try { db.exec("ALTER TABLE Users ADD COLUMN Role TEXT NOT NULL DEFAULT 'admin'"); } catch (_) {}

// ── Seed default admin user on first run ───────────────────────────────────────
(async () => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM Users').get().n;
  if (count === 0) {
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(adminPassword, 12);
    db.prepare("INSERT INTO Users (Username, PasswordHash, Role) VALUES ('admin', ?, 'admin')").run(hash);
    if (process.env.ADMIN_PASSWORD) {
      console.log('Default user created — username: admin (password taken from ADMIN_PASSWORD env)');
    } else {
      console.log('Default user created — username: admin, password: admin123');
    }
  }
})();

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: SESSION_SECRET is not set — using a random secret generated at boot. ' +
    'Sessions will NOT survive restarts. Set SESSION_SECRET in the environment.');
}

const cookieSecure = process.env.COOKIE_SECURE === '1' || process.env.COOKIE_SECURE === 'true';
if (cookieSecure) app.set('trust proxy', 1);

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: cookieSecure, maxAge: 24 * 60 * 60 * 1000 }, // 24h
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
  // Let the auth route clear this IP's counter on a successful login, so only
  // failed attempts accumulate toward the limit.
  req.loginRateLimit = { success: () => loginAttempts.delete(ip) };
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
    const role = req.session?.role || 'viewer';
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
app.use('/api/meta',             require('./routes/meta'));

// Root redirect
app.get('/', (req, res) => res.redirect('/index.html'));

// 404 fallback
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    return res.status(status).json({ error: err?.message || 'Internal server error' });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`Employer Relations System running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});

module.exports = { app, db };
