# Decisions

Choices made where the brief was ambiguous, and recommendations waiting for the owner. Newest at the bottom.

Status values: **Decided** (made by the lead engineer, reversible), **Proposed** (needs owner approval), **Approved**, **Rejected**.

| # | Date | Decision | Status | Reasoning |
| --- | --- | --- | --- | --- |
| 1 | 2026-11-14 | Phase 1 deliverables (`AUDIT.md`, `PROGRESS.md`, `DECISIONS.md`) are committed to the session branch `claude/busy-bohr-0gad6e` only. No other branch is touched until the branch plan is approved | Decided | Adding documents is not destructive; everything else waits for approval |
| 2 | 2026-11-14 | Audit tooling was kept in a scratch directory and not committed | Decided | Avoids leaving one-off scripts in the repo; proper tests replace it in Phases 5 and 8 |
| 3 | 2026-11-14 | Base branch for `main`: `final_version_secure_and_proper_code` (`1db3d09`) | Proposed | Only branch with a real security baseline, validation on every route, non-vulnerable Excel library and the fullest reporting code. See `AUDIT.md` section 4 |
| 4 | 2026-11-14 | Bring the two diverged lines together with a merge commit on a new `develop` branch (no rebase, no force-push), resolving conflicts toward the base branch and porting two business rules from `main` by hand | Proposed | Keeps both histories intact and never rewrites `main` |
| 5 | 2026-11-14 | Archive by tag (`archive/<branch-name>`) then delete dead branches, rather than renaming them to `archive/*` branches | Proposed | A tag preserves the commits permanently, and avoids having a tag and a branch with the same name |
| 6 | 2026-11-14 | Stay on SQLite (WAL, foreign keys enforced, integrity checks), behind repository modules with versioned forward-only migrations | Proposed | Small office, single VM, no guaranteed root or Docker. See `AUDIT.md` section 9 |
| 7 | 2026-11-14 | Replace the static-HTML-plus-fetch front end with server-rendered pages and htmx; self-host all assets | Proposed | Removes the root cause of flashing and layout shift and allows a strict CSP. See `AUDIT.md` section 8.2 |
| 8 | 2026-11-14 | Keep existing table and column names; first migrations are additive only. UI wording changes ("Employers") without renaming `Company` | Proposed | Lowest risk to real data |
| 9 | 2026-11-14 | Keep all nine existing record types and regroup them under the requested screens; add Tasks, Notes, Tags, Events | Proposed | Nothing the office already records is dropped |
| 10 | 2026-11-14 | Existing `admin` users become Admin, existing `viewer` users become Read-only | Proposed | Closest match; Staff and Student Worker are assigned by an admin afterwards |
| 11 | 2026-11-14 | `data/Company.csv` in early history is generated sample data and does not need purging | Proposed | 10 rows, generated addresses and URLs, no people or contact details. Owner to confirm |
| 12 | 2026-11-14 | No licence file will be added. A placeholder note will flag that ownership (CMU-Q) must be confirmed first | Decided | Explicit instruction in the brief |
