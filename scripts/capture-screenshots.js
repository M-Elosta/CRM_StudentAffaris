#!/usr/bin/env node
'use strict';

/**
 * Capture the screenshots used in the README into docs/screenshots/.
 *
 * Screenshots must only ever show the fictional demo data. This script
 * therefore builds its own throwaway database with `seed-demo`, starts the
 * application against it on a spare port, captures every screen at the same
 * window size, and removes the database afterwards. It never touches the
 * database configured in your environment.
 *
 *   npm run screenshots
 *
 * Playwright is not a dependency of this project. Install it once, anywhere,
 * and point NODE_PATH at it (see CONTRIBUTING.md), or run in an environment
 * that already provides it.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots');
const PORT = Number(process.env.SCREENSHOT_PORT || 3190);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1440, height: 900 };
const ADMIN_PASSWORD = 'Screenshot-Admin-Pass-2026';
// A fixed anchor date keeps the demo data, and so the pictures, identical between runs.
const ANCHOR = process.env.SCREENSHOT_ANCHOR || '';

/** [file name, path, optional preparation run in the page before the picture is taken] */
const SHOTS = [
  ['dashboard', '/dashboard'],
  ['employers-list', '/employers'],
  ['employers-search-arabic', '/employers?q=' + encodeURIComponent('مجموعة')],
  ['employer-profile', null],
  ['employer-form', '/employers/new'],
  ['contacts', '/contacts'],
  ['interactions', '/interactions'],
  ['postings', '/postings'],
  ['events', '/events'],
  ['follow-ups', '/follow-ups'],
  ['reports', '/reports'],
  ['report-employers-by-sector', '/reports/companies-by-sector'],
  ['report-new-employers', '/reports/new-companies'],
  ['report-opportunities-per-semester', '/reports/opportunities-per-semester'],
  ['admin-users', '/admin/users'],
  ['import', '/import'],
];

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    throw new Error('Playwright was not found. Install it and set NODE_PATH to its node_modules folder.');
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${BASE}/healthz`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The application did not start');
}

async function main() {
  const { chromium } = loadPlaywright();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ero-screenshots-'));
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_PATH: path.join(workDir, 'demo.db'),
    BACKUP_DIR: path.join(workDir, 'backups'),
    PORT: String(PORT),
    BOOTSTRAP_ADMIN_USERNAME: 'admin',
    BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASSWORD,
    LOG_LEVEL: 'error',
  };

  const seedArgs = ['scripts/seed-demo.js', ...(ANCHOR ? [`--anchor=${ANCHOR}`] : [])];
  const seeded = spawnSync(process.execPath, seedArgs, { cwd: ROOT, env, stdio: 'ignore' });
  if (seeded.status !== 0) throw new Error('Seeding the demo database failed');

  const server = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: 'en-GB' });
    const page = await context.newPage();
    fs.mkdirSync(OUT_DIR, { recursive: true });

    await page.goto(`${BASE}/login`);
    await page.screenshot({ path: path.join(OUT_DIR, 'sign-in.png') });
    await page.fill('#f-username', 'admin');
    await page.fill('#f-password', ADMIN_PASSWORD);
    await Promise.all([page.waitForURL(/\/dashboard/), page.click('button[type="submit"]')]);

    // The profile shown is the first employer in the list, whichever it is.
    await page.goto(`${BASE}/employers`);
    const profilePath = await page.locator('#results tbody a').first().getAttribute('href');

    for (const [name, target] of SHOTS) {
      await page.goto(`${BASE}${target ?? profilePath}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400); // let charts finish drawing
      await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
      console.log(`captured ${name}.png`);
    }
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`Screenshots failed: ${err.message}`);
  process.exit(1);
});
