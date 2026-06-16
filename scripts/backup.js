#!/usr/bin/env node
const fs   = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH     = path.join(__dirname, '..', 'data', 'employer.db');
const BACKUP_DIR  = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(__dirname, '..', 'data', 'backups');
const MAX_BACKUPS = Math.max(1, Number(process.env.MAX_BACKUPS || 10));

if (!fs.existsSync(DB_PATH)) {
  console.error('Database not found:', DB_PATH);
  process.exit(1);
}

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(BACKUP_DIR, `employer-${timestamp}.db`);
  const db = new Database(DB_PATH, { fileMustExist: true });

  try {
    await db.backup(dest);
  } finally {
    db.close();
  }

  console.log('Backup created:', dest);

  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('employer-') && f.endsWith('.db'))
    .sort();

  if (files.length > MAX_BACKUPS) {
    const toDelete = files.slice(0, files.length - MAX_BACKUPS);
    for (const f of toDelete) {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
      console.log('Removed old backup:', f);
    }
  }
}

main().catch((err) => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});
