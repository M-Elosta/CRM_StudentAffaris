'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');

const { rejectPoisonedKeys } = require('./middleware/poison-keys');
const { createOriginGuard } = require('./middleware/trusted-origin');
const { requestContext, createCurrentUserLoader, requireAuth, requirePasswordRotation } = require('./middleware/auth');
const { notFoundHandler, createErrorHandler } = require('./middleware/errors');
const { createServices } = require('./services');
const { DatabaseSessionStore } = require('./security/session-store');
const { createRecordRouter } = require('./routes/record-router');
const { createCompaniesRouter } = require('./routes/companies');
const { createAuthRouter } = require('./routes/auth');
const { createUsersRouter } = require('./routes/users');
const { createDashboardRouter } = require('./routes/dashboard');
const { createMetaRouter } = require('./routes/meta');
const { createImportRouter } = require('./routes/import');
const { createReportsRouter } = require('./routes/reports');
const { createWebRouter } = require('./web');
const { createNunjucksEnv } = require('./web/nunjucks');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');
const MODULES_DIR = path.join(__dirname, '..', 'node_modules');

/** Third-party browser files, served read-only from node_modules: published path -> file. */
const VENDOR_FILES = new Map([
  ['/vendor/htmx.min.js', path.join(MODULES_DIR, 'htmx.org', 'dist', 'htmx.min.js')],
  ['/vendor/chart.umd.min.js', path.join(MODULES_DIR, 'chart.js', 'dist', 'chart.umd.min.js')],
  ...['400', '500', '600'].flatMap((weight) => [
    [
      `/vendor/fonts/ibm-plex-sans-latin-${weight}-normal.woff2`,
      path.join(MODULES_DIR, '@fontsource', 'ibm-plex-sans', 'files', `ibm-plex-sans-latin-${weight}-normal.woff2`),
    ],
    [
      `/vendor/fonts/ibm-plex-sans-arabic-arabic-${weight}-normal.woff2`,
      path.join(
        MODULES_DIR,
        '@fontsource',
        'ibm-plex-sans-arabic',
        'files',
        `ibm-plex-sans-arabic-arabic-${weight}-normal.woff2`
      ),
    ],
  ]),
]);

/** Versioned static files (?v=<package version>) may be cached for a year. */
const LONG_CACHE = { maxAge: '365d', immutable: true };

/**
 * Build the Express application. Nothing here opens a port or touches the
 * file system besides serving static files, so tests can create an app around
 * an in-memory database.
 *
 * @param {object} deps
 * @param {object} deps.config   result of loadConfig()
 * @param {import('better-sqlite3').Database} deps.db
 * @param {{info: Function, warn: Function, error: Function}} [deps.logger]
 * @param {import('express-session').Store} [deps.sessionStore]  defaults to the database-backed store
 */
function createApp({ config, db, logger = console, sessionStore }) {
  const app = express();
  createNunjucksEnv(config, app);

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  // Every service is built once and handed to the router that needs it.
  const services = createServices({ db, config, logger });

  // ── Health check: no auth, no session, no rate limit ──────────────────────
  app.get('/healthz', (_req, res) => {
    try {
      services.meta.checkDatabase();
      res.set('Cache-Control', 'no-store').json({ status: 'ok' });
    } catch (err) {
      logger.error('Health check failed', err);
      res.status(503).set('Cache-Control', 'no-store').json({ status: 'unavailable' });
    }
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          // 'unsafe-inline' and the CDN are required by the current static
          // pages. Both are removed when the UI is rebuilt with self-hosted assets.
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
          connectSrc: ["'self'"],
        },
      },
      hsts: config.isProductionLike ? { maxAge: 31536000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    })
  );

  app.use(requestContext);
  app.use(express.json({ limit: config.jsonBodyLimit }));
  app.use(rejectPoisonedKeys);

  // Sessions live in the database, so a restart signs no one out and an
  // account's sessions can be ended at once. The cookie is rolling: each
  // request extends the idle window; the store enforces the absolute limit.
  const idleMs = config.sessionIdleMinutes * 60 * 1000;
  const store =
    sessionStore ?? new DatabaseSessionStore({ db, idleMs, absoluteMs: config.sessionMaxAgeMinutes * 60 * 1000 });
  app.use(
    session({
      name: 'ero.sid',
      secret: config.sessionSecret,
      store,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      proxy: config.trustProxy !== false,
      unset: 'destroy',
      cookie: {
        httpOnly: true,
        sameSite: 'strict',
        secure: config.sessionCookieSecure,
        maxAge: Math.min(idleMs, config.sessionMaxAgeMinutes * 60 * 1000),
      },
    })
  );

  // ── Rate limiting ─────────────────────────────────────────────────────────
  // Only API calls are limited. Pages, styles and scripts are never throttled,
  // so reaching the limit cannot lock anyone out of the login page.
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: config.apiRateLimitPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => config.isTest,
    message: { error: 'Too many requests in a short time. Please wait a minute and try again.' },
  });
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.loginRateLimitPer15Min,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    skip: () => config.isTest,
    message: { error: 'Too many failed sign-in attempts. Please try again in 15 minutes.' },
  });
  app.use('/api', apiLimiter);

  app.use(createOriginGuard(config));
  app.use(createCurrentUserLoader(services.auth));
  app.use(requireAuth);
  app.use(requirePasswordRotation);
  app.use('/assets', express.static(ASSETS_DIR, { index: false, fallthrough: false, ...LONG_CACHE }));
  app.get([...VENDOR_FILES.keys()], (req, res, next) => {
    res.sendFile(VENDOR_FILES.get(req.path), LONG_CACHE, (err) => err && next(err));
  });
  app.use(express.static(PUBLIC_DIR, { index: false }));

  // ── Routes ────────────────────────────────────────────────────────────────
  app.use('/api/auth/login', loginLimiter);
  app.use('/api/auth', createAuthRouter(services.auth));
  for (const [recordPath, { service, schema }] of services.records) {
    const options = { listQuerySchema: schema.listQuerySchema, idLabel: service.definition.idLabel };
    const router =
      recordPath === 'companies' ? createCompaniesRouter(service, options) : createRecordRouter(service, options);
    app.use(`/api/${recordPath}`, router);
  }
  app.use('/api/reports', createReportsRouter(services.reports));
  app.use('/api/dashboard', createDashboardRouter(services.dashboard));
  app.use('/api/import', createImportRouter(services.import));
  app.use('/api/users', createUsersRouter(services.users));
  app.use('/api/meta', createMetaRouter(services.meta));

  app.use(createWebRouter({ services, config, logger }));

  app.use(notFoundHandler(PUBLIC_DIR));
  app.use(createErrorHandler(logger));

  return app;
}

module.exports = { createApp };
