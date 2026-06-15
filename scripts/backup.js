#!/usr/bin/env node
const fs   = require('fs');
const path = require('path');

const DB_PATH     = path.join(__dirname, '..', 'data', 'employer.db');
const BACKUP_DIR  = path.join(__dirname, '..', 'data', 'backups');
const MAX_BACKUPS = 10;

if (!fs.existsSync(DB_PATH)) {
  console.error('Database not found:', DB_PATH);
  process.exit(1);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest      = path.join(BACKUP_DIR, `employer-${timestamp}.db`);

fs.copyFileSync(DB_PATH, dest);
console.log('Backup created:', dest);

// Prune old backups
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
