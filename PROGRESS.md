# Progress

Single source of truth for where the production-readiness work stands. Updated at the end of every work session.

## Current phase

**Phase 1 — Audit: complete. Waiting for approval before Phase 2.**

Nothing destructive has been done. No branch was merged, renamed, tagged or deleted. No code was changed. No schema was changed. No real data was touched.

## Done

- 2026-11-14 — Inspected all seven remote branches (five distinct code states).
- 2026-11-14 — Installed, seeded and ran each state against throwaway databases; API smoke test (about 155 checks per branch); Playwright pass over all 13 pages as admin and viewer; CDN-blocked run; `npm audit` per branch.
- 2026-11-14 — Scanned full git history for secrets and data files.
- 2026-11-14 — Verified that a `main`-era database opens under the `final_version` code with identical row counts and clean integrity checks.
- 2026-11-14 — Wrote `AUDIT.md` (findings ranked by severity, branch recommendation, branch plan, database recommendation, phase plan) and `DECISIONS.md`.

## Next (blocked on approval)

Phase 2 starts only after the owner answers the decisions in `AUDIT.md` section 12. In order:

1. Tag every branch tip as `archive/<branch-name>` (non-destructive).
2. Create `develop` from `final_version_secure_and_proper_code`, merge `main` into it with a merge commit.
3. Fix C1 (create broken), C2 (stale edits accepted), C3 (global rate limit), C4 (seed wipes production path), C6 (database path) with tests.
4. Introduce the data-access layer and versioned migrations; baseline migration equals the current schema.
5. Restructure folders, lint and format, pin dependencies and Node, environment config, Dependabot.
6. Delete or rename the old branches as approved.

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

## Notes for the next session

- Working branch for this effort: `claude/busy-bohr-0gad6e`. It sits on `1db3d09` (same commit as `final_version_secure_and_proper_code`) plus the audit documents.
- The audit harness (API smoke test, Playwright page sweep, row-count checker) lived in a temporary scratch directory and was not committed. It will be rebuilt as proper tests in Phases 5 and 8. The method is described in `AUDIT.md` section 2.
- The sandbox used for the audit blocks public CDNs, so the current UI only renders there when library files are served locally. This stops mattering once assets are self-hosted (Phase 4).
- Pushing is only authorised to the working branch until the owner approves the branch plan.
