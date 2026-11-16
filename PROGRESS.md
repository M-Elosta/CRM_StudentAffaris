# Progress

Single source of truth for where the production-readiness work stands. Updated at the end of every work session.

## Current phase

**Phase 2 — Clean up and restructure: complete, except the branch plan, which waits for owner approval.**
**Phase 3 — Security: starting.**

All work is on `claude/busy-bohr-0gad6e`. No remote branch other than this one has been touched. No real data has been touched.

## Done

### Phase 1 (complete, 2026-11-14)

- Audited all seven remote branches; wrote `AUDIT.md` and `DECISIONS.md`.

### Phase 2 (complete, 2026-11-16)

- Removed committed tool runtime files; `.gitignore` now blocks databases, backups, exports, env files, keys, logs.
- Application moved under `src/` in clear layers: `routes` (HTTP only), `services` (rules), `db/repositories` (all SQL), `validation` (zod schemas), `domain` (record definitions), `middleware`, `config`, `lib`. `src/app.js` is an app factory; `src/server.js` is the entry point with graceful shutdown.
- Configuration from environment variables only, validated at start, with per-environment defaults. `.env.example` documents every variable.
- One connection module (WAL, foreign keys on, busy timeout, synchronous FULL), integrity check, verified single-file backups.
- Versioned forward-only migrations with checksum protection, automatic pre-migration backup, and rollback if a table would lose rows. Verified against databases created by `main`, `final_version…` and the oldest branch: identical row counts, integrity ok.
- Audit findings fixed: C1 (create failed), C2 (stale edits accepted), C3 (rate limit lockout), C4 (seed wiped the live path), C6 (database inside the app folder), H9 (ad hoc schema changes), H11 (dependency vulnerabilities: `npm audit` reports 0), H12 (non-transactional writes), M1 (UTC dates: now office time zone), M4 (missing indexes), M9 (duplication), M10 (dead code).
- Further defects found by the new tests and fixed: invalid enum values and unknown employer or contact ids returned 500; impossible dates accepted; import accepted invalid rows and unchecked ids; `last-updated` ignored edits; reserved names such as `constructor` crashed report and import lookups; contacts of a blacklisted employer could be set back to Mailable.
- Test suite: 773 tests (771 pass, 2 marked todo for the session defects fixed in Phase 3).
- Demo data replaced with a fully fictional, deterministic dataset (80 employers, 240 contacts, 600 interactions, Arabic and English, `.example` domains only).
- ESLint and Prettier pass for the whole repository. Dependabot, CI workflow, PR and issue templates added.
- Groundwork for later phases: design-system stylesheet and icon sprite (Phase 4), role and permission matrix with tests (Phase 3).

## Next

Phase 3, in this order (schema and auth work runs one task at a time):

1. Migration 0003: user accounts, four roles, audit log, soft delete, record versions, sessions, settings (lead).
2. Sessions in the database, user loaded on every request, RBAC enforced in services with field redaction, user deactivation.
3. Audit log, soft delete and restore, record history.
4. Pluggable sign-in: OIDC, SAML, local break-glass with TOTP and lockout; `SSO_SETUP.md`.
5. CSRF tokens, privacy tools (export or erase a person, retention), `PRIVACY.md`.
6. ZAP baseline scan once the rebuilt UI exists.

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

| Phase | Task                                                                                                                                                                                | Delegated to              | Branch                    | Status                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------- | ---------------------- |
| 1     | Audit                                                                                                                                                                               | Not delegated (lead work) | `claude/busy-bohr-0gad6e` | Complete               |
| 2     | Foundation: config, data layer, migrations, app factory, critical fixes                                                                                                             | Not delegated (lead work) | `claude/busy-bohr-0gad6e` | Complete               |
| 2     | Integration and unit test suite (owns `tests/`)                                                                                                                                     | Opus subagent             | `phase2/api-tests`        | Reviewed and merged    |
| 2     | Fully fictional demo seed data (owns `scripts/seed-demo.js`, `scripts/seed/`)                                                                                                       | Opus subagent             | `phase2/fictional-seed`   | Reviewed and merged    |
| 2     | Layered refactor of the API code, nine defects, dead code, lint and format                                                                                                          | Opus subagent             | `phase2/layered-refactor` | Reviewed and merged    |
| 3     | Role and permission matrix (`src/security/permissions.js`)                                                                                                                          | Not delegated (lead work) | `claude/busy-bohr-0gad6e` | Complete               |
| 3     | Migration 0003: accounts, roles, audit log, soft delete, versions, sessions, settings                                                                                               | Not delegated (lead work) | `claude/busy-bohr-0gad6e` | Complete               |
| 3     | Database sessions, per-request user, RBAC enforcement with field redaction, user deactivation                                                                                       | Opus subagent             | `phase3/sessions-rbac`    | Running                |
| 4     | UI specification as templates: page shell, component macros, reference list screen (`src/views/`)                                                                                   | Not delegated (lead work) | `claude/busy-bohr-0gad6e` | Complete, not wired in |
| 7     | Encrypted backups with retention and off-server copy, restore, systemd, nginx, logrotate, install and deploy scripts with rollback, monitoring, Docker alternative, operations docs | Opus subagent             | `phase7/ops-tooling`      | Running                |

## Notes for the next session

- Working branch: `claude/busy-bohr-0gad6e`. Delegated work happens on local branches in separate worktrees and is merged here after review; those branches are not pushed.
- Run locally: `npm ci`, `npm run seed:demo`, `npm start` (development defaults; database at `./data/dev/employer.db`). `npm run migrate:status` shows applied migrations.
- The current static UI still loads Bootstrap and Chart.js from a public CDN; it is replaced in Phase 4.
- Subagent worktrees start from the repository's default branch, not from the working branch. Every brief must tell the subagent to create its branch from an explicit commit.
- Commands: `npm run lint`, `npm run format:check`, `npm test`.
- Pushing is only authorised to the working branch until the owner approves the branch plan.
