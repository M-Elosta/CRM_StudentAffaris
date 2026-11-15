'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');

const { rejectPoisonedKeys } = require('./middleware/poison-keys');
const { createOriginGuard } = require('./middleware/trusted-origin');
const { requireAuth, requirePasswordRotation, blockWritesForViewers } = require('./middleware/auth');
const { notFoundHandler, createErrorHandler, respondServerError } = require('./middleware/errors');
const { createServices } = require('./services');
const { createRecordRouter } = require('./routes/record-router');
const { createCompaniesRouter } = require('./routes/companies');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * Build the Express application. Nothing here opens a port or touches the
 * file system besides serving static files, so tests can create an app around
 * an in-memory database.
 *
 * @param {object} deps
 * @param {object} deps.config   result of loadConfig()
 * @param {import('better-sqlite3').Database} deps.db
 * @param {{info: Function, warn: Function, error: Function}} [deps.logger]
 * @param {import('express-session').Store} [deps.sessionStore]
 */
function createApp({ config, db, logger = console, sessionStore }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.locals.db = db;
  app.locals.config = config;
  app.locals.logger = logger;
  app.locals.respondServerError = (req, res, err) => respondServerError(logger, req, res, err);

  const services = createServices({ db, config, logger });

  // ── Health check: no auth, no session, no rate limit ──────────────────────
  app.get('/healthz', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
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

  app.use(express.json({ limit: config.jsonBodyLimit }));
  app.use(rejectPoisonedKeys);

  app.use(
    session({
      name: 'ero.sid',
      secret: config.sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      proxy: config.trustProxy !== false,
      unset: 'destroy',
      cookie: {
        httpOnly: true,
        sameSite: 'strict',
        secure: config.sessionCookieSecure,
        maxAge: config.sessionMaxAgeMinutes * 60 * 1000,
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
  app.use(requireAuth);
  app.use(requirePasswordRotation);
  app.use(express.static(PUBLIC_DIR, { index: false }));

  // ── Routes ────────────────────────────────────────────────────────────────
  app.use('/api/auth/login', loginLimiter);
  app.use('/api/auth', require('./routes/auth'));
  for (const [recordPath, { service, schema }] of services.records) {
    const options = { listQuerySchema: schema.listQuerySchema, idLabel: service.definition.idLabel };
    const router =
      recordPath === 'companies' ? createCompaniesRouter(service, options) : createRecordRouter(service, options);
    app.use(`/api/${recordPath}`, blockWritesForViewers, router);
  }
  app.use('/api/reports', require('./routes/reports'));
  app.use('/api/dashboard', require('./routes/dashboard'));
  app.use('/api/import', blockWritesForViewers, require('./routes/import'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/meta', require('./routes/meta'));

  app.get('/', (_req, res) => res.redirect('/index.html'));

  app.use(notFoundHandler(PUBLIC_DIR));
  app.use(createErrorHandler(logger));

  return app;
}

module.exports = { createApp };
