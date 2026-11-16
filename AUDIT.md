# Phase 1 Audit — Employer Relations CRM (CMU-Q ERO)

Audit date: 2026-11-14. Scope: every branch of `M-Elosta/CRM_StudentAffaris`.
Nothing in the repository was changed, renamed, merged or deleted to produce this report.
No real data was touched: every test ran against throwaway databases built from the repo's own seed script.

## 1. Summary

The app is a working prototype with a sound domain model, but it is not safe to put in front of the office as it stands.

- **The newest "secure" branch cannot create records.** On `final_version_secure_and_proper_code`, every "Add" button on all nine record types fails with "not found". A concurrency check was pasted into the create handlers instead of the update handlers. The update handlers have no check at all, so two people editing the same record silently overwrite each other.
- **The same branch locks the whole office out.** A global limit of 400 requests per 15 minutes counts every stylesheet, script and API call. One active user reaches it in about 30 page views; after that every page, including the login page, returns an error for 15 minutes.
- **There are three ways to lose data permanently.** The demo seed script deletes every table in the production database file. Deleting a company or contact hard-deletes its whole history through cascading foreign keys. The import "overwrite" option deletes a record and then inserts its replacement without a transaction.
- **The page flashing and jumping has one root cause**: static HTML pages that build their sidebar, role-dependent controls and table rows in the browser after load, with all styling fetched from a public CDN. It needs a different rendering approach (section 8), not more patches.
- **No branch has tests, linting or CI.** Every branch has high or critical `npm audit` findings.
- **No real data and no live credentials were found in git history.** One hardcoded session secret and a default `admin123` password are in history and should be treated as burned (section 6).

Recommendation in one line: build on `final_version_secure_and_proper_code`, port specific fixes from three other branches, stay on SQLite behind a proper data layer, and move the UI to server-rendered pages.

## 2. How the audit was done

| Check            | Method                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch inventory | `git ls-remote`, full commit graph, per-branch diff stats                                                                                                                                                                         |
| Does it run      | Each distinct tree exported to a scratch directory, `npm ci`, seeded, booted                                                                                                                                                      |
| API behaviour    | Scripted smoke test, about 155 checks per branch: auth, CRUD on all nine record types, stale-write detection, dashboard, every report and export, import templates, user management, viewer-role restrictions, cross-origin write |
| UI behaviour     | Playwright (Chromium, 1440x900) visiting all 13 pages as admin and as viewer: console errors, failed requests, cumulative layout shift, screenshots, and an add / search / edit flow through the real forms                       |
| CDN dependency   | Same Playwright run with `cdn.jsdelivr.net` blocked                                                                                                                                                                               |
| Upgrade safety   | A database created by `main` opened by the `final_version` code; row counts, `integrity_check` and `foreign_key_check` compared before and after                                                                                  |
| Dependencies     | `npm audit` per branch                                                                                                                                                                                                            |
| History          | Every path ever committed, plus a pattern scan of all patches for secrets                                                                                                                                                         |
| Code             | Read `server.js`, all route modules, schema, seed, import, export, and the client scripts on the recommended base branch                                                                                                          |

Limits of this audit: I have not seen the production database or server, so findings about real data are inferred from the code. The Postgres branch was run against a local Postgres 16.

## 3. Branch inventory

Seven remote branches, five distinct code states.

| Branch                                                            | Tip                    | Last commit | Relationship                     | Runs                                     | Smoke test               | `npm audit`                    |
| ----------------------------------------------------------------- | ---------------------- | ----------- | -------------------------------- | ---------------------------------------- | ------------------------ | ------------------------------ |
| `main`                                                            | `d975fa9`              | 2026-06-30  | Fork point `45a7d28` + 3 commits | Yes                                      | 144/154                  | 2 critical, 5 high, 1 moderate |
| `final_version_secure_and_proper_code`                            | `1db3d09`              | 2026-06-25  | Fork point `45a7d28` + 8 commits | Yes                                      | 133/151                  | 1 critical, 4 high, 1 moderate |
| `feat/issue-5-fix-badgetag-positioning-and-color-semantics-consi` | `1db3d09`              | 2026-06-25  | Identical to `final_version…`    | —                                        | —                        | —                              |
| `claude/busy-bohr-0gad6e`                                         | `1db3d09` + audit docs | 2026-11-14  | This session's working branch    | —                                        | —                        | —                              |
| `postgresql-version`                                              | `daf8e0b`              | 2026-06-30  | `final_version…` + 3 commits     | Boots, cannot log in on a fresh database | 146/160 after manual fix | 1 critical, 4 high, 1 moderate |
| `claude/ero-usability-audit-3vv4z1`                               | `26dc135`              | 2026-07-04  | `main` + 3 commits               | Yes                                      | 157/158                  | 2 critical, 5 high, 1 moderate |
| `claude/help-coding-task-Bucx3`                                   | `fc8c778`              | 2026-06-15  | Ancestor of every other branch   | Yes                                      | 144/154                  | 2 critical, 5 high, 1 moderate |

No branch has automated tests, a lint configuration or a CI workflow, so "test status" is "none" everywhere. The numbers above are from my own smoke test.

`main` and `final_version…` split on 2026-06-15 and were then developed separately. Each rewrote the same route and client files, so they conflict heavily. Neither contains the other's work.

### 3.1 `main` (`d975fa9`)

- Adds over the fork point: `routes/_helpers.js` (validation helpers, the rule that contacts of a blacklisted company are forced to Non-mailable), SQLite bug fixes, standardised badge colours.
- Works end to end through the UI (add, Arabic search, edit all succeed).
- Bugs and gaps: session secret hardcoded as `ero-system-secret-2025`; default login `admin` / `admin123` printed to the log; no security headers; no cross-origin write protection (a POST from another origin created a record); no stale-write detection; the port is hardcoded to 3000; import fails with HTTP 413 above roughly 300–1,000 rows because of the 100 KB JSON limit; uses the `xlsx` package, which has unfixable high-severity advisories.

### 3.2 `final_version_secure_and_proper_code` (`1db3d09`)

- Adds over the fork point: helmet with CSP and HSTS, origin check on writes, rate limiting, `routes/_validation.js` used on every route, forced password rotation, production refusal to start without a session secret, `exceljs` instead of `xlsx`, bcrypt 6, much larger reports module (semester and academic-year views), a systemd unit, a backup script, `.env.example`.
- Bugs:
  - Create is broken for all nine record types (finding C1). Confirmed through the API and through the real form: the modal stays open showing "Company not found".
  - Stale edits are never rejected (C2).
  - The global rate limit takes the site down for normal use (C3).
  - The blacklisted-company contact rule from `main` is missing.
  - Commits tool runtime files (`.claude/runtime/*`, `.github/hooks/*`).
- Opening a database created by `main` works: all 16 tables kept identical row counts, integrity and foreign-key checks passed, and the old `admin123` password was correctly forced to rotate.

### 3.3 `postgresql-version` (`daf8e0b`)

- Adds: `lib/db.js`, a 414-line layer that rewrites SQLite SQL into Postgres SQL with regular expressions at runtime, an async route patch, a Postgres schema and seed, client fixes.
- Its create and update handlers are correct here: the stale check is in the update path and works (all nine pass).
- Bugs: on a fresh database no admin user is ever created, because Postgres returns `COUNT(*)` as the string `"0"` and the code tests `count === 0`. Nobody can log in. After I inserted an admin by hand, seven reports and `/api/reports/periods` return HTTP 500 (empty-string dates, a `0000-01-01` date, a broken destructuring).
- The translation layer is the main problem: every new query is a chance for a silent mistranslation.

### 3.4 `claude/ero-usability-audit-3vv4z1` (`26dc135`)

- Adds over `main`: working stale-write detection on update (409 with a clear message), a migration step that runs before the schema so old databases upgrade cleanly, environment-based secret and port, sortable column headers, labels on every form field (unlabelled inputs drop from 10–19 per page to zero), a URL safety check before rendering links, an executive summary and academic-year comparison in Reports.
- Best functional score (157/158), but it inherits `main`'s weak security base: no security headers, no cross-origin write protection, default `admin123`, vulnerable `xlsx` and `bcrypt` 5.

### 3.5 `claude/help-coding-task-Bucx3` (`fc8c778`)

Fully contained in every other branch. Nothing unique.

## 4. Recommended base and what to salvage

**Base: `final_version_secure_and_proper_code` (`1db3d09`).**

It has the only serious security baseline, validation on every route, the non-vulnerable Excel library and the most complete reporting code. Its three blocking bugs are small and well understood. Starting from `main` instead would mean redoing all of that security and validation work.

Salvage list:

| From                                | Commit    | What                                                                                                                                                             | How it will be used                                          |
| ----------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `postgresql-version`                | `095740c` | Stale check placed in the update handlers; `withTransaction` around multi-table writes in `routes/recruitment.js`, `routes/collaboration.js`, `routes/import.js` | Port the logic into the new service layer                    |
| `claude/ero-usability-audit-3vv4z1` | `d22abf3` | `checkUpdateConflict` in `routes/_helpers.js`; pre-schema migration ordering in `server.js`                                                                      | Reference for the versioned migrations and concurrency check |
| `claude/ero-usability-audit-3vv4z1` | `26dc135` | Sortable headers with `aria-sort`, label/`for` wiring, `safeUrl`                                                                                                 | Requirements for the rebuilt UI components                   |
| `claude/ero-usability-audit-3vv4z1` | `39f99f9` | Executive summary, previous-period deltas, academic-year comparison, date presets                                                                                | Input to Phase 6 reporting                                   |
| `main`                              | `b28afd3` | `resolveContactStatus` (blacklisted company forces Non-mailable), tolerant boolean parsing for imports (`yes`/`no`/`y`/`n`)                                      | Port as business rules with tests                            |

Not salvaged: the regex SQL translator (`lib/db.js` on the Postgres branch), the `.github/hooks` and `.claude/runtime` files, the hardcoded credentials.

## 5. Proposed branch plan

Nothing below has been done. Step 1 is non-destructive; steps 3 and 4 delete or rename remote branches and need your approval.

1. Tag every branch tip so nothing can be lost: tag `archive/<branch-name>` at each of the seven tips.
2. Create `develop` from `final_version_secure_and_proper_code`, then merge `main` into it with a normal merge commit. Conflicts are resolved in favour of the `final_version` code, and the two `main` business rules above are ported by hand. This keeps both histories and rewrites nothing.
3. Dead branches, deleted after tagging:
   - `feat/issue-5-fix-badgetag-positioning-and-color-semantics-consi` (duplicate pointer to `1db3d09`)
   - `claude/help-coding-task-Bucx3` (fully merged ancestor)
   - `postgresql-version` (kept only as the tag `archive/postgresql-version`)
   - `final_version_secure_and_proper_code` (once it is merged into `develop`)
4. Still useful, renamed: `claude/ero-usability-audit-3vv4z1` becomes `feature/usability-a11y-reports` until its items are ported, then tagged and deleted.
5. `main` stays as production and is only updated by pull requests from `develop` that pass CI. No force-push, no history rewrite. `main` protection has to be switched on by you in GitHub settings; I will give you the exact settings in Phase 7.
6. `claude/busy-bohr-0gad6e` is this session's working branch. Work lands on `develop` through pull requests from it or from short-lived `feature/*` branches.

## 6. Secrets and data in git history

| Item                                    | Where                                                                        | Assessment                                                                                                                                                                     | Action                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Session secret `ero-system-secret-2025` | `server.js` from `5eb6a1b`; still on `main`, `claude/help-coding-task-Bucx3` | Real secret in history. Anyone with repo access can forge session cookies for any instance still using it                                                                      | Rotate: set a new random `SESSION_SECRET` on any running instance           |
| Default login `admin` / `admin123`      | `server.js` on `main`, `claude/ero-usability-audit-3vv4z1`, base branch      | Publicly guessable default                                                                                                                                                     | Confirm the production admin password is not `admin123`; change it if it is |
| `data/Company.csv`                      | Added in `53e70b5`, deleted in `d34b9a1`                                     | 10 rows. Real company names combined with generated addresses and URLs (e.g. "8660 Amy Junction, South Shelbyfort"). No emails, no phone numbers, no people. Not real ERO data | No purge needed, in my assessment. Please confirm you agree                 |
| `.claude/runtime/*`, `.github/hooks/*`  | Base and Postgres branches                                                   | AI tool session logs and hook scripts with absolute paths (`/projects/CRM_StudentAffaris`) and prompts. No credentials                                                         | Remove from the tree in Phase 2 and ignore                                  |
| Database files, `.env`, keys            | —                                                                            | None ever committed                                                                                                                                                            | —                                                                           |

One related problem in the current tree: `database/seed.js` uses real organisations (Qatar Airways, QNB, Ooredoo and others) with invented people at those organisations' real email domains, and marks "Gulf Bridge Intl" — close to a real Qatari company's name — as blacklisted with a negative comment. That is not acceptable for screenshots or demos. Phase 9 replaces it with fully fictional employers.

## 7. Findings, ranked

References are to the recommended base branch unless stated.

### Critical

| ID  | Finding                                                                                                                                                                                                                                                                                                                     | Evidence                                                                                                                                                                                                                    | Fix in        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| C1  | Creating any record fails. `ensureRecordNotStale` is called in every POST handler with an undefined id, which returns 404                                                                                                                                                                                                   | `routes/companies.js:60`, `contacts.js:83`, `outreach.js:82`, `recruitment.js:98`, `career-events.js:63`, `collaboration.js:49`, `academic.js:61`, `student-events.js:55`, `hiring-feedback.js:56`. Verified via API and UI | Phase 2       |
| C2  | Lost updates. No PUT handler checks the record version, so the later save silently overwrites the earlier one                                                                                                                                                                                                               | A PUT with `UpdatedAt` of year 2000 returns 200 on all nine record types                                                                                                                                                    | Phase 2       |
| C3  | Self-inflicted outage. Global limiter of 400 requests / 15 min per IP is mounted before static files. The dashboard alone is about 13 requests. After the limit every URL returns `{"error":"Too many requests"}` for 15 minutes, including `/login.html`. Behind a proxy or campus NAT the whole office shares one counter | `server.js:274-280`. Verified: request 401 for `/css/style.css` returns 429 with `Retry-After: 900`                                                                                                                         | Phase 2       |
| C4  | The demo seed script wipes production. It opens `data/employer.db` — the live database path — and runs `DELETE FROM` on every table. The README tells the reader to run it, and `scripts/start.sh` runs it whenever the file is missing                                                                                     | `database/seed.js:5,15-36`, `README.md`, `scripts/start.sh`                                                                                                                                                                 | Phase 2       |
| C5  | Deletes are permanent and cascade. Deleting a company removes its contacts, outreach, postings, events and feedback. Deleting a contact removes every interaction, posting and event that referenced that person. There is no undo, no soft delete and no record of who did it                                              | `database/schema.sql:33,63,78-79,92-93,138-139,151-152,164-165,181-182`; `routes/companies.js:144`, `contacts.js:180`                                                                                                       | Phase 3       |
| C6  | The database lives inside the application folder at a hardcoded path. A re-clone, `git clean` or careless redeploy destroys it. Backups go to the same folder on the same disk, unencrypted, with no schedule and no restore procedure                                                                                      | `server.js:97-98`, `scripts/backup.js`                                                                                                                                                                                      | Phase 2 and 7 |

### High

| ID  | Finding                                                                                                                                                                                                                                                                                | Evidence                                                                      | Fix in        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------- |
| H1  | Import can lose data. No transaction around the batch, so a failure leaves a partial import. "Overwrite" deletes the existing record and then inserts; if the insert fails the original is gone. The record id to overwrite is taken from the browser                                  | `routes/import.js:448-560`                                                    | Phase 5       |
| H2  | Import fails on larger files. All rows are sent back as JSON; the 256 KB body limit rejects them. 3,000 simple company rows return HTTP 413 (on `main`, 1,000 rows fail). CSV is not accepted at all on the base branch                                                                | `server.js:282`. Verified                                                     | Phase 5       |
| H3  | Sessions are held in memory. Every restart or deploy logs everyone out and discards unsaved work; fixed 24-hour lifetime, no idle timeout, no warning                                                                                                                                  | `server.js:285-298`                                                           | Phase 3       |
| H4  | Access cannot be revoked immediately. The role is copied into the session at login and never re-checked. A deleted or demoted user keeps their old access until the session ends                                                                                                       | `routes/auth.js:31-34`, `server.js:312-319,358-366`, `routes/users.js:58-99`  | Phase 3       |
| H5  | Only two roles (`admin`, `viewer`), enforced by HTTP method. A viewer can read and export every contact's personal details (verified: export returns 200), and is served the HTML of admin pages                                                                                       | `server.js:358-384`                                                           | Phase 3       |
| H6  | No audit trail. No record of who created, changed, deleted or exported anything; tables have no `created_by` / `updated_by`                                                                                                                                                            | `database/schema.sql`                                                         | Phase 3       |
| H7  | All UI libraries load from a public CDN with no integrity hashes, and Chart.js is unpinned (`/npm/chart.js` is "latest"). With the CDN unreachable the pages render unstyled and every modal, toast and chart is dead. It also sends each staff member's IP and usage to a third party | `public/index.html:8-9,177-178` and every page. Verified with the CDN blocked | Phase 4       |
| H8  | The CSP allows inline scripts, and pages rely on them: 43–50 inline `onclick` handlers on list pages, plus page markup built with `innerHTML`. Escaping is applied consistently today, but one missed call is a stored XSS                                                             | `server.js:244`, `public/js/*.js`                                             | Phase 3 and 4 |
| H9  | Schema changes are applied by trial and error at boot: `ALTER TABLE` inside `try {} catch {}` with errors swallowed, followed by full-table `UPDATE`s on every start. No versions, no record of what ran, no backup first                                                              | `server.js:106-201`                                                           | Phase 2       |
| H10 | No tests, no lint, no CI on any branch                                                                                                                                                                                                                                                 | —                                                                             | Phase 2 and 8 |
| H11 | Dependency vulnerabilities. Base branch: `proxy-addr` (critical), `multer`, `body-parser`, `brace-expansion`, `ip-address` (high), `qs` (moderate). All fixable by updating the lockfile. `main` additionally has `xlsx` (high, no fix exists) and `bcrypt` 5 pulling a critical `tar` | `npm audit`                                                                   | Phase 2       |
| H12 | Multi-table writes are not transactional (posting plus its four child tables, collaboration plus opportunities). A failure midway leaves half a record                                                                                                                                 | `routes/recruitment.js:95-145`, `collaboration.js:46-60`                      | Phase 2       |

### Medium

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                          | Evidence                                                                                                    | Fix in        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------- |
| M1  | Dates are computed in UTC in 34 places (`date('now')`, `toISOString().slice(0,10)`). Between midnight and 03:00 Qatar time, new records get yesterday's date and "this month" totals are off                                                                                                                                                                                                     | `routes/*.js`, `database/schema.sql` defaults                                                               | Phase 5       |
| M2  | Three date formats in one screen: tables show `dd/mm/yy`, date inputs show the browser locale (`mm/dd/yyyy`), charts show `yyyy-mm`                                                                                                                                                                                                                                                              | `public/js/app.js:279-284`                                                                                  | Phase 5       |
| M3  | List endpoints return whole tables; filtering, sorting and paging happen in the browser. Postings and collaborations run extra queries per row (N+1). This will not hold at 30,000 contacts or 100,000 interactions                                                                                                                                                                              | `routes/contacts.js:29-64`, `recruitment.js:16-35`                                                          | Phase 2 and 5 |
| M4  | Missing indexes on most foreign keys (`OutreachEngagement.CompanyID/ContactID`, `CareerEvent.CompanyID`, `HiringFeedback`, `StudentLedEvent`, `AcademicClassroomEngagement`, child tables)                                                                                                                                                                                                       | `database/schema.sql:208-228`                                                                               | Phase 2       |
| M5  | Arabic gaps. Storage and substring search work (verified). Missing: search normalisation (أ / إ / آ / ا, ة / ه, ى / ي, diacritics, tatweel); locale-aware sorting (binary order puts all Arabic after Latin and `Zebra` before `apple`); `dir="auto"` on fields and cells; the import's full-name split takes the last word as the surname, which is wrong for names such as عبد الله or آل ثاني | `routes/companies.js:36`, `routes/import.js:291-300`                                                        | Phase 4 and 5 |
| M6  | Closing a form with Escape or the X discards edits without warning (verified). A session expiry during editing redirects to login and loses the form                                                                                                                                                                                                                                             | `public/js/app.js:13-16`                                                                                    | Phase 5       |
| M7  | Stale-write detection, once enabled, compares timestamps with one-second resolution, so two saves in the same second are not detected                                                                                                                                                                                                                                                            | `routes/_records.js`                                                                                        | Phase 2       |
| M8  | Accessibility: 10–19 form controls per page without a label, icon-only buttons without accessible names, status conveyed by badge colour, white text on the yellow warning toast                                                                                                                                                                                                                 | Playwright count; fixed on the usability branch                                                             | Phase 4       |
| M9  | Duplicated code: nine near-identical page scripts (about 2,400 lines) and nine near-identical route modules; `normalizeRole` defined four times; the same date-range SQL assembled by hand in each of the eight handlers in `routes/dashboard.js`; update triggers defined in both `schema.sql` and `server.js`                                                                                  | `public/js/*.js`, `routes/*.js`, `server.js:20,115-201`, `routes/auth.js:7`, `users.js:13`, `reports.js:14` | Phase 2       |
| M10 | Dead code: the report builder and saved-report API (`/api/reports/schema`, `/builder`, `/saved`) and the `SavedReports` table are no longer called by the UI; the `cors` middleware serves no purpose in a same-origin app; `scripts/start.bat`; `.github/hooks/*`; `.claude/runtime/*`                                                                                                          | `routes/reports.js:1575-1735`, `server.js:259-272`                                                          | Phase 2       |
| M11 | Operations: no health endpoint, no graceful shutdown, logging through `console.log` with full stack traces and request URLs (which contain search terms, i.e. names)                                                                                                                                                                                                                             | `server.js:229-233`                                                                                         | Phase 7       |
| M12 | The systemd unit runs `npm start` as `www-data` with no sandboxing, and assumes Debian paths                                                                                                                                                                                                                                                                                                     | `ops/employer-system.service`                                                                               | Phase 7       |
| M13 | The CSV export path has no UTF-8 BOM (Excel shows Arabic as garbage) and no protection against formula injection (a name starting with `=` runs as a formula when opened). It is only reachable through the unused report-builder API today, but any future CSV export must handle both. Excel exports write text cells and are not affected                                                     | `routes/reports.js:1747-1758`                                                                               | Phase 6       |
| M14 | Errors on page URLs return JSON (429, 403) instead of a readable page; only a 404 page exists                                                                                                                                                                                                                                                                                                    | `server.js:274-280,390-401`                                                                                 | Phase 5       |

### Low

| ID  | Finding                                                                                                              | Fix in  |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------- |
| L1  | Visual design reads as a template (section 8.2)                                                                      | Phase 4 |
| L2  | README is out of date (says exports use `xlsx`; screenshot placeholders)                                             | Phase 9 |
| L3  | `package.json`: caret ranges, no `engines`, no `.nvmrc`, non-standard `allowScripts` key, version already `1.0.0`    | Phase 2 |
| L4  | Login reveals timing difference between unknown user and wrong password; password change does not end other sessions | Phase 3 |
| L5  | Seed data uses real organisations (section 6)                                                                        | Phase 9 |

## 8. Why the app glitches and fails

### 8.1 Failures ("buttons do nothing")

In order of likely impact on the base branch:

1. Every Add form fails with "not found" (C1).
2. After a spell of normal use, everything returns "Too many requests" for 15 minutes (C3). The client shows this as a failed load or a generic toast, so it looks like random breakage.
3. Imports above a few thousand rows fail with a size error (H2).
4. If `cdn.jsdelivr.net` is slow or blocked on the campus network, Bootstrap's JavaScript never loads: no modal opens, no toast shows, no chart draws (H7).
5. A restart logs everyone out; the next click on any button silently redirects to login (H3, M6).

### 8.2 Flashing and jumping

The UI is 13 separate static HTML files. Every navigation is a full page load, and each page then assembles itself in the browser:

- The sidebar is an empty dark placeholder that JavaScript fills in after `DOMContentLoaded`.
- The user's role is only known after `/api/auth/check` returns, so admin-only items and buttons appear or disappear after first paint.
- Table rows, counters, "last updated" lines and pagination are inserted after separate API calls, pushing content down. Measured cumulative layout shift: up to 0.11 on the base branch, 0.13 on `main`, 0.18 on the usability branch (Contacts page). Google's threshold for "needs improvement" is 0.1.
- CSS for layout comes from a third-party CDN, so the first paint depends on an external round trip.
- Earlier commits tried to hide this with an inline background colour and the View Transitions API (`<meta name="view-transition">`), which masks the symptom in Chromium only.

**Proposed fix (needs your approval): server-rendered pages with htmx.** The server sends complete HTML — sidebar, role-specific controls and the first page of table rows already in place — so there is nothing to pop in. htmx swaps only the changed region on navigation, filtering, sorting and paging, which removes the full-page flicker without a single-page-app build chain. All CSS, fonts and scripts are served from the app itself. It also makes a strict CSP, CSRF tokens and server-side pagination straightforward. The cost is that the view layer (HTML pages and client scripts) is rewritten; the route logic, validation and SQL are kept and reorganised. Given nine copies of the same page script and the root cause above, I consider the rewrite of the view layer justified. A lightweight SPA was the alternative; it would keep the "data arrives after the page" problem and add a build step.

### 8.3 Why it looks generated

Observed in screenshots: stock Bootstrap 5 with a dark sidebar; six KPI numbers in six different colours; a reports page made of a grid of pastel icon tiles; a pink, purple and cyan chart palette; pill badges on almost every row; three button treatments in one sidebar; heavy rounded cards with shadows; decorative coloured icons inside forms and headings; no CMU identity. Phase 4 replaces this with a small custom design system (neutral greys, Carnegie Red as the single accent, one typeface with Arabic coverage, one table, one button set).

## 9. Database: stay on SQLite

**Recommendation: SQLite, behind a clean data-access layer with versioned migrations.**

| Consideration                                                      | SQLite                                                                                      | Postgres                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Load: under 20 staff, low write concurrency                        | Comfortable. WAL mode gives concurrent readers with one writer                              | Far more than needed                                           |
| Target size: 10k employers, 30k contacts, 100k interactions        | Small for SQLite with proper indexes and server-side paging                                 | Fine                                                           |
| Operations on a VM you may not have root on, Docker not guaranteed | No server process, nothing for IT to install, patch or monitor                              | IT must install, secure, upgrade and back up a database server |
| Backup and restore                                                 | One consistent file via the online backup API; restore is "put the file back"; easy to test | `pg_dump` / restore, roles, credentials                        |
| Attack surface                                                     | No network listener, no database password                                                   | Listener and credentials to manage                             |
| Full-text and Arabic search                                        | FTS5 with our own normalisation                                                             | Good built-in options                                          |
| Main risks                                                         | Single writer; must sit on local disk, never a network share; no row-level permissions      | Operational overhead; depends on IT                            |

The existing Postgres branch does not change this: it is a runtime SQL translator that cannot bootstrap an admin and breaks seven reports.

Conditions I will implement: WAL mode, `foreign_keys=ON` and a `busy_timeout` on every connection; `synchronous=FULL`; a nightly `integrity_check` and `foreign_key_check` with alerting; the database stored outside the application directory at a configurable path; all access through repository modules so a later move to Postgres means writing one new adapter, not touching routes.

## 10. Schema review

What is good: a sensible normalised core (Company, Contact, six activity tables), `CHECK` constraints on enumerations, foreign keys declared, WAL already on.

Problems:

- `ON DELETE CASCADE` everywhere (C5). Replace with soft delete and `RESTRICT`.
- Every activity row requires a contact (`ContactID NOT NULL`), so an interaction with a company where the contact is unknown cannot be recorded, and removing a contact removes history.
- No `created_by`, `updated_by`, record owner, or version column.
- `Users` has only username, hash and a free-text role; no email, display name, active flag, last login, SSO subject or MFA secret.
- No uniqueness or duplicate protection (contact email, company name); child tables allow duplicate values.
- Booleans, dates and money are loosely typed (`PayAmount TEXT`, dates as free text guarded only in application code).
- `CareerEvent` is one row per company per event with a free-text event name, so there is no event record to attach attendance or details to, and a typo creates a "new" event.
- `HiringFeedback.HiredStudentName` is student personal data in a free-text field with no access restriction.
- Missing foreign-key indexes (M4).

Missing for the reporting you want (proposed additions, all additive):

| Need                                         | Addition                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Relationship owner, contacts per owner       | `owner_user_id` on Company                                                                                        |
| Active vs dormant, "not contacted in X days" | Derived `last_contacted_at` from all activity types; configurable dormancy threshold                              |
| Location (Qatar / GCC / international)       | Country normalised to a reference list with a region                                                              |
| Employer size                                | `size_band` on Company                                                                                            |
| By CMU-Q program                             | Majors normalised to CS, IS, BA, BIO (currently free text such as "Business Administration")                      |
| Internship vs full-time, by term             | Posting type as a proper field; term and academic year derived from dates by one shared function                  |
| Events and attendance                        | An `Event` table (name, date, type, expected and actual student attendance) with company participation as a child |
| Outcomes and conversions                     | Structured hires: posting, student program, class year, outcome type (interview, offer, hire), date               |
| Tasks and follow-ups                         | A `Task` table (due date, assignee, status, linked record), seeded from existing `FollowUpDate` / `ActionPlan`    |
| Notes and tags                               | `Note` and `Tag` tables                                                                                           |
| Saved report filters and saved list views    | Per-user saved filter table                                                                                       |
| Audit and history                            | Append-only `AuditLog`; soft-delete columns                                                                       |

Existing tables and column names stay as they are in the first migrations (additive changes only), so the real data is never reshaped in a risky way. The UI will say "Employers" while the table remains `Company`.

## 11. Proposed plan for the next phases

Lead work stays with me; execution is delegated to subagents on separate branches, one at a time for anything touching schema, migrations, auth or security. Every delegated diff is reviewed and tested before merge.

| Phase             | Lead (me)                                                                                                                                                                                                       | Delegated                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 Clean up        | Apply branch plan; target structure; data-layer and migration design; baseline migration verified against a `main`-era database; fix C1–C4, C6, H9, H12                                                         | Move code into the new structure; ESLint and Prettier; remove dead code; pin dependencies and Node; `.env.example` and per-environment config; Dependabot; first unit tests |
| 3 Security        | Auth architecture (OIDC and SAML adapters, break-glass local login with TOTP); RBAC matrix for four roles; session, CSRF and CSP design; audit-log and soft-delete schema; retention and subject-request design | Implement to spec, one task at a time; `SSO_SETUP.md` and `PRIVACY.md` drafts; ZAP baseline run and fixes                                                                   |
| 4 UI              | Design system, page templates, navigation model, mapping of the nine record types onto the requested screens                                                                                                    | Build each screen to spec in parallel on separate branches                                                                                                                  |
| 5 Solid           | QA plan; review of `QA_REPORT.md`; performance budget                                                                                                                                                           | All-routes Playwright test; bug fixes from the QA report; import with preview; duplicate detection and merge; global search; reminders; load test and Lighthouse            |
| 6 Reporting       | Report definitions and metric semantics; schema additions                                                                                                                                                       | Build reports, exports, print views                                                                                                                                         |
| 7 Reliability     | Backup, restore and deploy design; rollback rules                                                                                                                                                               | systemd, nginx, logrotate, install and deploy scripts; Docker Compose; CI workflows; restore test                                                                           |
| 8 Tests and docs  | Review                                                                                                                                                                                                          | Test suites; documentation drafts                                                                                                                                           |
| 9 Repo and README | Review; final wording                                                                                                                                                                                           | Fictional seed data; screenshot and GIF scripts                                                                                                                             |
| 10 Launch         | Final verification; release notes; `v1.0.0` tag (with your approval)                                                                                                                                            | Checklist draft                                                                                                                                                             |

Constraints found in this environment that affect later phases: outbound access to public CDNs is blocked here (irrelevant once assets are self-hosted); I can only push to this session's branch unless you authorise more; `main` protection and repository settings must be changed by you.

## 12. Decisions needed from you

1. **Which version is in production, and where is the real database?** I need the schema and row counts, not the data: the output of `sqlite3 employer.db ".schema"` and a `SELECT COUNT(*)` per table. Migrations will be tested against that exact shape before they ever run on real data.
2. **Approve the base branch and the branch plan** in section 5, including permission to push tags, create `develop`, and delete or rename the listed branches.
3. **Approve staying on SQLite** (section 9).
4. **Approve server-rendered pages with htmx** as the fix for flashing (section 8.2).
5. **Rotate the two exposed credentials** if either is in use (section 6), and confirm the fake `Company.csv` in history does not need purging.
6. **Keep all nine record types?** I recommend yes, grouped as: Employers, Contacts, Interactions (outreach), Postings (recruitment), Events (career, student-led, academic), Outcomes (hiring feedback), Opportunities (potential collaboration), plus new Tasks.
7. **Role mapping for existing users**: `admin` becomes Admin and `viewer` becomes Read-only, unless you tell me who should be Staff or Student Worker.
