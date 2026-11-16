#!/usr/bin/env node
'use strict';

/**
 * Visit every page of the running application as each of the four roles and
 * fail on anything a person would notice: a console error, a script error, a
 * failed request, an HTTP error on a page the role may open, or layout shift
 * (cumulative layout shift above 0.02).
 *
 *   NODE_PATH=/opt/node-tools/node_modules node scripts/check-routes.js \
 *     --base http://localhost:3120 --user admin --password '...'
 *
 * The administrator account is used to create one account per role
 * (check-staff, check-readonly, check-student_worker) on the first run, with
 * the password in CHECK_ROUTES_PASSWORD (default below). Playwright is not a
 * dependency of the project; it is resolved through NODE_PATH.
 */

const { chromium } = require('playwright');

const CLS_LIMIT = 0.02;
const ROLES = ['admin', 'staff', 'readonly', 'student_worker'];
const ROLE_PASSWORD = process.env.CHECK_ROUTES_PASSWORD || 'Check-Routes-Pass-2026';

/** Lists whose first row leads to a detail page worth visiting. */
const DETAIL_SOURCES = [
  '/employers',
  '/contacts',
  '/interactions',
  '/postings',
  '/events',
  '/events?tab=student-led',
  '/events?tab=academic',
  '/hiring-outcomes',
  '/collaboration-ideas',
];

function parseArgs(argv) {
  const args = { base: 'http://localhost:3120', user: 'admin', password: process.env.ADMIN_PASSWORD || '' };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index].replace(/^--/, '');
    args[key] = argv[index + 1];
  }
  if (!args.password) throw new Error('Give the administrator password with --password.');
  return args;
}

/** Measure layout shift from the start of every page. */
const CLS_SCRIPT = `
  window.__cls = 0;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (err) { window.__cls = -1; }
`;

async function signIn(page, base, username, password) {
  await page.goto(`${base}/login`);
  await page.fill('#f-username', username);
  await page.fill('#f-password', password);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith('/login')), page.click('button[type=submit]')]);
}

/** Create the per-role accounts through the JSON API, as the administrator. */
async function ensureRoleAccounts(browser, args) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, args.base, args.user, args.password);
  for (const role of ROLES.filter((candidate) => candidate !== 'admin')) {
    const res = await context.request.post(`${args.base}/api/users`, {
      headers: { Origin: new URL(args.base).origin },
      data: { username: `check-${role}`, password: ROLE_PASSWORD, role },
    });
    if (![201, 409].includes(res.status())) throw new Error(`Could not create check-${role}: ${res.status()}`);
  }
  await context.close();
}

/** Visit one page and report what went wrong on it. */
async function visit(page, base, path, problems) {
  problems.length = 0;
  const response = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const cls = await page.evaluate(() => window.__cls);
  const status = response ? response.status() : 0;
  if (status >= 400) problems.push(`HTTP ${status}`);
  if (cls > CLS_LIMIT) problems.push(`layout shift ${cls.toFixed(3)}`);
  return { status, cls, problems: [...problems] };
}

async function checkRole(browser, args, role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(CLS_SCRIPT);
  const page = await context.newPage();
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`script error: ${error.message}`));
  page.on('requestfailed', (request) =>
    problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`)
  );
  page.on('response', (response) => {
    if (response.status() >= 400 && response.request().resourceType() !== 'document') {
      problems.push(`HTTP ${response.status()} for ${response.url()}`);
    }
  });

  const username = role === 'admin' ? args.user : `check-${role}`;
  await signIn(page, args.base, username, role === 'admin' ? args.password : ROLE_PASSWORD);

  const navLinks = await page.$$eval('#nav a.nav__link', (links) => links.map((link) => link.getAttribute('href')));
  const paths = [...new Set([...navLinks, '/account', '/search?q=al'])];
  const results = [];
  for (const path of paths) results.push({ role, path, ...(await visit(page, args.base, path, problems)) });

  const details = [];
  for (const source of DETAIL_SOURCES) {
    const base = source.split('?')[0];
    if (!navLinks.includes(base)) continue;
    await page.goto(`${args.base}${source}`, { waitUntil: 'networkidle' });
    const href = await page
      .$eval('#results tbody tr td.cell--primary a', (link) => link.getAttribute('href'))
      .catch(() => null);
    if (href) details.push(href);
  }
  if (navLinks.includes('/reports')) {
    await page.goto(`${args.base}/reports`, { waitUntil: 'networkidle' });
    const href = await page.$eval('.report-list__item', (link) => link.getAttribute('href')).catch(() => null);
    if (href) details.push(href);
  }
  if (navLinks.includes('/employers') && details[0]) {
    details.push(`${details[0]}?tab=contacts`);
    // The edit form on its own page, when the role is offered it.
    await page.goto(`${args.base}${details[0]}`, { waitUntil: 'networkidle' });
    const edit = await page
      .$eval('.page-header__actions a[href$="/edit"]', (link) => link.getAttribute('href'))
      .catch(() => null);
    if (edit) details.push(edit);
  }
  for (const path of new Set(details)) {
    results.push({ role, path, ...(await visit(page, args.base, path, problems)) });
  }

  await context.close();
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch();
  try {
    await ensureRoleAccounts(browser, args);
    const results = [];
    for (const role of ROLES) results.push(...(await checkRole(browser, args, role)));

    const width = Math.max(...results.map((result) => result.path.length), 4);
    console.log(`${'ROLE'.padEnd(15)} ${'PAGE'.padEnd(width)} STATUS  CLS     RESULT`);
    for (const result of results) {
      const verdict = result.problems.length ? `FAIL ${result.problems.join('; ')}` : 'ok';
      console.log(
        `${result.role.padEnd(15)} ${result.path.padEnd(width)} ${String(result.status).padEnd(7)} ${result.cls
          .toFixed(3)
          .padEnd(7)} ${verdict}`
      );
    }
    const failed = results.filter((result) => result.problems.length);
    console.log(`\n${results.length} pages checked, ${failed.length} with problems.`);
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
