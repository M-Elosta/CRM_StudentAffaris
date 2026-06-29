#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(__dirname, '..', 'data', 'backups');
const MAX_BACKUPS = Math.max(1, Number(process.env.MAX_BACKUPS || 10));
const PG_DUMP_BIN = process.env.PG_DUMP_PATH || 'pg_dump';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function runPgDump(dest) {
  return new Promise((resolve, reject) => {
    const child = spawn(PG_DUMP_BIN, [
      '--format=plain',
      '--file', dest,
      '--host', requiredEnv('DB_HOST'),
      '--port', String(process.env.DB_PORT || 5432),
      '--username', requiredEnv('DB_USER'),
      requiredEnv('DB_NAME'),
    ], {
      env: {
        ...process.env,
        PGPASSWORD: requiredEnv('DB_PASSWORD'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr.trim() || `pg_dump exited with code ${code}`));
    });
  });
}

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(BACKUP_DIR, `employer-${timestamp}.sql`);

  await runPgDump(dest);
  console.log('Backup created:', dest);

  const files = fs.readdirSync(BACKUP_DIR)
    .filter((file) => file.startsWith('employer-') && file.endsWith('.sql'))
    .sort();

  if (files.length > MAX_BACKUPS) {
    const toDelete = files.slice(0, files.length - MAX_BACKUPS);
    for (const file of toDelete) {
      fs.unlinkSync(path.join(BACKUP_DIR, file));
      console.log('Removed old backup:', file);
    }
  }
}

main().catch((err) => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});
