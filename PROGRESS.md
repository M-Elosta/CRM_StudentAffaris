# Progress

Single source of truth for where the production-readiness work stands. Updated at the end of every work session.

## Current phase

**Phase 2 — Clean up and restructure: in progress.**

All work is on `claude/busy-bohr-0gad6e`. No remote branch other than this one has been touched. No real data has been touched.

## Done

### Phase 1 (complete, 2026-11-14)

- Audited all seven remote branches; wrote `AUDIT.md` and `DECISIONS.md`.

### Phase 2 (2026-11-15)

- Removed committed tool runtime files; `.gitignore` now blocks databases, backups, exports, env files, keys, logs.
- Application moved under `src/` (config, db, middleware, routes, services, lib). `src/app.js` is an app factory; `src/server.js` is the entry point with graceful shutdown.
- Configuration from environment variables only, validated at start, with per-environment defaults (`src/config`). `.env.example` documents every variable.
- Data layer foundation: one connection module (WAL, foreign keys on, busy timeout, synchronous FULL), integrity check, verified single-file backups.
- Versioned forward-only migrations with checksum protection, automatic pre-migration backup, and rollback if a table would lose rows. `0001_baseline` adopts databases created by any earlier version; `0002` adds foreign key indexes. Verified against databases created by `main`, `final_version…` and the oldest branch: identical row counts, integrity ok.
- Fixed C1 (create failed on all nine record types) and C2 (stale edits accepted).
- Fixed C3 (global rate limit locked everyone out): only `/api` is limited now.
- Fixed C4 (seed wiped the live database path): moved to `scripts/seed-demo.js`, refuses staging/production and non-empty databases.
- Fixed C6 (database inside the app folder): path is configurable and mandatory outside development.
- Dependencies pinned to exact versions and updated; `npm audit` reports 0 vulnerabilities. Node pinned to 22.
- ESLint, Prettier, EditorConfig, Dependabot configuration added. `/healthz` added.
- Smoke test of the restructured app: 160 of 160 checks pass.

## In progress

- Test suite (delegated, see log).
- Fictional demo data (delegated, see log).

## Next

1. Review and merge the two delegated branches.
2. Delegate the layered refactor of the route modules (routes, services, repositories, zod validation, transactions, shared date handling, dead report-builder API removed), verified by the new tests.
3. Format the whole codebase with Prettier and make lint pass; add the CI workflow file.
4. Phase 3: security schema migration (users, roles, audit log, soft delete, record versions, sessions), then auth providers and RBAC.

Blocked on owner approval (not started): archive tags, `develop`, branch deletions and renames, merging `main`'s history. See `DECISIONS.md` entry 13.

## Open questions for the owner

See `AUDIT.md` section 12. Short form:

1. Which version runs in production, and what are its schema and row counts?
2. Approve base branch and branch plan (includes permission to push tags, create `develop`, delete or rename branches).
3. Approve SQLite.
4. Approve server-rendered pages with htmx.
5. Rotate the hardcoded session secret and `admin123` if in use; confirm no history purge is needed.
6. Keep all nine record types?
7. Role mapping for existing users.

## Delegation log

| Phase | Task | Delegated to | Branch | Status |
| --- | --- | --- | --- | --- |
| 1 | Audit | Not delegated (lead work) | `claude/busy-bohr-0gad6e` | Complete |
| 2 | Foundation: config, data layer, migrations, app factory, critical fixes | Not delegated (lead work) | `claude/busy-bohr-0gad6e` | Complete |
| 2 | Integration and unit test suite (owns `tests/`) | Opus subagent | `phase2/api-tests` (local worktree) | Running |
| 2 | Fully fictional demo seed data (owns `scripts/seed-demo.js`, `scripts/seed/`) | Opus subagent | `phase2/fictional-seed` (local worktree) | Running |

## Notes for the next session

- Working branch: `claude/busy-bohr-0gad6e`. Delegated work happens on local branches in separate worktrees and is merged here after review; those branches are not pushed.
- Run locally: `npm ci`, `npm run seed:demo`, `npm start` (development defaults; database at `./data/dev/employer.db`). `npm run migrate:status` shows applied migrations.
- The current static UI still loads Bootstrap and Chart.js from a public CDN; it is replaced in Phase 4.
- Lint currently reports errors in legacy route files; they are fixed by the layered refactor.
- Pushing is only authorised to the working branch until the owner approves the branch plan.
