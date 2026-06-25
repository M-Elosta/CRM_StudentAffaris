const crypto   = require('crypto');
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');
const cors     = require('cors');
const helmet   = require('helmet');
const session  = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt   = require('bcrypt');

const app  = express();
const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || (!IS_PRODUCTION ? crypto.randomBytes(32).toString('hex') : null);
const DEFAULT_ADMIN_USERNAME = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || null;

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'viewer';
}

function parseConfiguredOrigins(port) {
  const configured = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const defaults = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
  return new Set([...defaults, ...configured].map((origin) => {
    try {
      return new URL(origin).origin;
    } catch (_) {
      return null;
    }
  }).filter(Boolean));
}

function runtimeOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function normalizeOrigin(origin) {
  try {
    return new URL(origin).origin;
  } catch (_) {
    return null;
  }
}

function isTrustedOrigin(origin, req, allowedOrigins) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return normalized === runtimeOrigin(req) || allowedOrigins.has(normalized);
}

function createPoisonKeyGuard() {
  const poisonKeys = new Set(['__proto__', 'constructor', 'prototype']);

  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(inspect);
      return;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      if (poisonKeys.has(key)) {
        const err = new Error('Unsupported field in request payload');
        err.statusCode = 400;
        throw err;
      }
      inspect(nestedValue);
    }
  }

  return (req, _res, next) => {
    try {
      inspect(req.body);
      inspect(req.query);
      next();
    } catch (err) {
      next(err);
    }
  };
}

if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set when NODE_ENV=production');
}

if (!process.env.SESSION_SECRET && !IS_PRODUCTION) {
  console.warn('SESSION_SECRET not set; using an ephemeral development secret.');
}

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
try { db.exec("ALTER TABLE PotentialCollaboration ADD COLUMN UpdatedAt DATETIME"); } catch (_) {}
try { db.exec("ALTER TABLE HiringFeedback ADD COLUMN UpdatedAt DATETIME"); } catch (_) {}
try { db.exec("ALTER TABLE CareerEvent ADD COLUMN UpdatedAt DATETIME"); } catch (_) {}
try { db.exec("ALTER TABLE StudentLedEvent ADD COLUMN UpdatedAt DATETIME"); } catch (_) {}
try { db.exec("ALTER TABLE AcademicClassroomEngagement ADD COLUMN UpdatedAt DATETIME"); } catch (_) {}

db.exec(`
  UPDATE PotentialCollaboration SET UpdatedAt = COALESCE(UpdatedAt, CreatedAt, datetime('now'));
  UPDATE HiringFeedback SET UpdatedAt = COALESCE(UpdatedAt, CreatedAt, datetime('now'));
  UPDATE CareerEvent SET UpdatedAt = COALESCE(UpdatedAt, CreatedAt, datetime('now'));
  UPDATE StudentLedEvent SET UpdatedAt = COALESCE(UpdatedAt, CreatedAt, datetime('now'));
  UPDATE AcademicClassroomEngagement SET UpdatedAt = COALESCE(UpdatedAt, CreatedAt, datetime('now'));

  CREATE TRIGGER IF NOT EXISTS collaboration_inserted
  AFTER INSERT ON PotentialCollaboration
  BEGIN
      UPDATE PotentialCollaboration
      SET UpdatedAt = COALESCE(NEW.UpdatedAt, datetime('now'))
      WHERE PotentialCollaborationID = NEW.PotentialCollaborationID;
  END;

  CREATE TRIGGER IF NOT EXISTS collaboration_updated
  AFTER UPDATE ON PotentialCollaboration
  BEGIN
      UPDATE PotentialCollaboration
      SET UpdatedAt = datetime('now')
      WHERE PotentialCollaborationID = NEW.PotentialCollaborationID;
  END;

  CREATE TRIGGER IF NOT EXISTS hiring_feedback_inserted
  AFTER INSERT ON HiringFeedback
  BEGIN
      UPDATE HiringFeedback
      SET UpdatedAt = COALESCE(NEW.UpdatedAt, datetime('now'))
      WHERE HiringFeedbackID = NEW.HiringFeedbackID;
  END;

  CREATE TRIGGER IF NOT EXISTS hiring_feedback_updated
  AFTER UPDATE ON HiringFeedback
  BEGIN
      UPDATE HiringFeedback
      SET UpdatedAt = datetime('now')
      WHERE HiringFeedbackID = NEW.HiringFeedbackID;
  END;

  CREATE TRIGGER IF NOT EXISTS career_event_inserted
  AFTER INSERT ON CareerEvent
  BEGIN
      UPDATE CareerEvent
      SET UpdatedAt = COALESCE(NEW.UpdatedAt, datetime('now'))
      WHERE CareerEventID = NEW.CareerEventID;
  END;

  CREATE TRIGGER IF NOT EXISTS career_event_updated
  AFTER UPDATE ON CareerEvent
  BEGIN
      UPDATE CareerEvent
      SET UpdatedAt = datetime('now')
      WHERE CareerEventID = NEW.CareerEventID;
  END;

  CREATE TRIGGER IF NOT EXISTS student_event_inserted
  AFTER INSERT ON StudentLedEvent
  BEGIN
      UPDATE StudentLedEvent
      SET UpdatedAt = COALESCE(NEW.UpdatedAt, datetime('now'))
      WHERE StudentLedEventID = NEW.StudentLedEventID;
  END;

  CREATE TRIGGER IF NOT EXISTS student_event_updated
  AFTER UPDATE ON StudentLedEvent
  BEGIN
      UPDATE StudentLedEvent
      SET UpdatedAt = datetime('now')
      WHERE StudentLedEventID = NEW.StudentLedEventID;
  END;

  CREATE TRIGGER IF NOT EXISTS academic_engagement_inserted
  AFTER INSERT ON AcademicClassroomEngagement
  BEGIN
      UPDATE AcademicClassroomEngagement
      SET UpdatedAt = COALESCE(NEW.UpdatedAt, datetime('now'))
      WHERE EngagementID = NEW.EngagementID;
  END;

  CREATE TRIGGER IF NOT EXISTS academic_engagement_updated
  AFTER UPDATE ON AcademicClassroomEngagement
  BEGIN
      UPDATE AcademicClassroomEngagement
      SET UpdatedAt = datetime('now')
      WHERE EngagementID = NEW.EngagementID;
  END;
`);

// ── Seed default admin user on first run ───────────────────────────────────────
async function bootstrapDefaultAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM Users').get().n;
  if (count === 0) {
    if (IS_PRODUCTION && !DEFAULT_ADMIN_PASSWORD) {
      throw new Error('DEFAULT_ADMIN_PASSWORD must be set before first production start');
    }

    const bootstrapPassword = DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url');
    const hash = await bcrypt.hash(bootstrapPassword, 12);
    db.prepare('INSERT INTO Users (Username, PasswordHash, Role) VALUES (?, ?, ?)')
      .run(DEFAULT_ADMIN_USERNAME, hash, 'admin');
    if (IS_PRODUCTION) {
      console.log(`Bootstrap admin created for username: ${DEFAULT_ADMIN_USERNAME}. Rotate the bootstrap password after first login.`);
    } else {
      console.log(`Bootstrap admin created — username: ${DEFAULT_ADMIN_USERNAME}, password: ${bootstrapPassword}`);
    }
  }
}

// ── Middleware ─────────────────────────────────────────────────────────────────
app.disable('x-powered-by');
app.set('trust proxy', IS_PRODUCTION ? 1 : false);

const allowedOrigins = parseConfiguredOrigins(PORT);

app.locals.respondServerError = (req, res, err) => {
  console.error(`[${req.method} ${req.originalUrl}]`, err?.stack || err);
  if (res.headersSent) return;
  return res.status(500).json({ error: 'An unexpected error occurred' });
};

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
      connectSrc: ["'self'"],
    },
  },
  hsts: IS_PRODUCTION ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false,
  referrerPolicy: { policy: 'no-referrer' },
}));

app.use((req, res, next) => cors({
  origin(origin, callback) {
    if (!origin || isTrustedOrigin(origin, req, allowedOrigins)) {
      return callback(null, true);
    }

    const err = new Error('Origin not allowed');
    err.statusCode = 403;
    return callback(err);
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type'],
})(req, res, next));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 400,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
}));

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use(createPoisonKeyGuard());
app.use(session({
  name: 'ero.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: IS_PRODUCTION,
  unset: 'destroy',
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: IS_PRODUCTION,
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// ── Auth middleware ────────────────────────────────────────────────────────────
const PUBLIC_PATHS = ['/login.html', '/api/auth/login', '/css/', '/js/', '/favicon'];

function requireAuth(req, res, next) {
  const p = req.path;
  if (PUBLIC_PATHS.some(pub => p.startsWith(pub))) return next();
  if (req.session?.userId) return next();

  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  res.redirect('/login.html');
}

function requireTrustedOrigin(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.path.startsWith('/api/')) {
    return next();
  }

  const origin = req.get('origin');
  if (origin && isTrustedOrigin(origin, req, allowedOrigins)) return next();

  const referer = req.get('referer');
  if (referer && isTrustedOrigin(referer, req, allowedOrigins)) return next();

  return res.status(403).json({ error: 'Untrusted request origin' });
}

app.use(requireTrustedOrigin);
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// ── Viewer role: block all state-changing requests ────────────────────────────
function requireAdmin(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const role = normalizeRole(req.session?.role);
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
  if (err?.statusCode && err.statusCode < 500) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  return app.locals.respondServerError(req, res, err);
});

async function startServer() {
  await bootstrapDefaultAdmin();

  app.listen(PORT, () => {
    console.log(`Employer Relations System running at http://localhost:${PORT}`);
    if (!IS_PRODUCTION) {
      console.log(`Database: ${DB_PATH}`);
    }
  });
}

startServer().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

module.exports = { app, db, normalizeRole, startServer };
