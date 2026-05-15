const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3000;

// ── Database init ──────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH  = path.join(DATA_DIR, 'employer.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);

// Apply schema on every startup (CREATE TABLE IF NOT EXISTS is idempotent)
const schema = fs.readFileSync(path.join(__dirname, 'database', 'schema.sql'), 'utf8');
db.exec(schema);

// Make db accessible to route modules
app.locals.db = db;

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/companies',  require('./routes/companies'));
app.use('/api/contacts',   require('./routes/contacts'));

// ── Fallback: serve index.html for unknown HTML requests ───────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Employer Relations System running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});

module.exports = { app, db };
