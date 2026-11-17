'use strict';

const { loadConfig, loadDotEnv } = require('./config');
const { openDatabase } = require('./db/connection');
const { migrate } = require('./db/migrate');
const { backupDatabase } = require('./db/backup');
const { bootstrapAdmin } = require('./services/bootstrap-admin');
const { createApp } = require('./app');

async function start() {
  loadDotEnv();
  const config = loadConfig();
  const logger = console;

  if (config.sessionSecretIsEphemeral) {
    logger.warn(
      'SESSION_SECRET is not set; using a temporary secret. Everyone is signed out when the server restarts.'
    );
  }

  const db = openDatabase(config.databasePath);

  // Schema changes run here, before the server accepts traffic. If the
  // database already holds data it is backed up first.
  const migration = await migrate(db, {
    logger,
    backup: (label) => backupDatabase(db, config.backupDir, label).then((result) => result.path),
  });
  if (migration.applied.length) {
    logger.info(`Database migrated (${migration.applied.length} step${migration.applied.length === 1 ? '' : 's'}).`);
  }

  await bootstrapAdmin(db, config, logger);

  const app = createApp({ config, db, logger });
  const server = app.listen(config.port, config.host, () => {
    logger.info(`Employer Relations CRM listening on http://${config.host}:${config.port} (${config.env})`);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down.`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { app, server, db, config };
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { start };
