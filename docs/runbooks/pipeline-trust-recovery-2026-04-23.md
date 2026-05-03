# Pipeline Trust Recovery Report — 2026-04-23

## Scope
Production-trust recovery for engineering pipeline discipline in GitHub Actions + Replit deployment + nightly PROD→DEV database refresh.

## Root causes found
1. **PR gate duplication with drift:** both `ci.yml` and `pr-checks.yml` ran on PRs, but with divergent behavior (`pr-checks.yml` skipped `npm run test:api`). This created contradictory trust signals.
2. **Stale branch trigger assumptions:** workflows referenced `develop` despite no local branch evidence in this repository clone (`git branch -a` only showed `work`).
3. **Nightly sync observability gaps:** no explicit secret preflight in workflow, brittle client install path, and sentinel metadata incorrectly recorded DEV as source instead of PROD.
4. **Nightly sync verification ambiguity:** restore verification could fail generically without clearly separating “required tables missing” from “row-count query failed”.
5. **Compile gate failures were real, not cosmetic:** lint had hard errors (React hooks rule violations) in `admin-quickbooks.tsx` and `phase-templates.tsx`, causing compile stage to fail.

## What was actually broken
- PR checks were not a single authoritative path because two workflows ran with overlapping-but-different gates.
- `pr-checks.yml` could pass release gate without directly running `test:api` in that workflow.
- Nightly sync failure diagnostics were weaker than needed for rapid operator response.
- Sentinel provenance was incorrect (`source_host`/`source_db` from DEV instead of PROD).
- Hook-order lint violations caused `npm run ci:compile` to fail.

## What was misleading but not broken
- Replit deploy remained green (`npm run build` + `npm run start`) but does not validate full CI quality gates.
- `CLAUDE.md` stated branch-protection/required-check intent, but this is not enforceable from repository code and must be verified in GitHub settings.

## Fixes applied
1. **CI/Pipeline discipline**
   - `ci.yml` now runs only on `push` to `main`.
   - `pr-checks.yml` now runs only on `pull_request` to `main` and includes `npm run test:api`.
   - Removed stale `develop` workflow triggers.

2. **Nightly PROD→DEV sync hardening**
   - Added explicit workflow secret preflight (`PROD_DATABASE_URL`, `DEV_DATABASE_URL`) with actionable errors.
   - Simplified PostgreSQL client install to standard `postgresql-client` package.
   - Kept strict shell failure behavior via `set -euo pipefail` in preflight/install steps.
   - Corrected sentinel provenance to record PROD host/database.
   - Added explicit critical-table existence verification with dedicated failure codes (`51`, `52`) before row-count verification.

3. **Compile gate root-cause fixes**
   - Fixed React hook ordering in:
     - `client/src/pages/admin-quickbooks.tsx`
     - `client/src/pages/phase-templates.tsx`

4. **Guidance alignment**
   - Updated `CLAUDE.md` CI section to reflect authoritative PR workflow and explicit deploy-vs-CI distinction.
   - Updated dev-data runbook with new sentinel semantics and troubleshooting exit codes.

5. **Migration metadata reconciliation (long-term CI stability)**
   - Rebuilt `migrations/meta/_journal.json` so every committed migration SQL file is tracked in journal order.
   - Added a current-state schema snapshot (`migrations/meta/0025_snapshot.json`) so `db:check` compares against the real latest schema state instead of stale historical metadata.
   - Result: `npm run db:check` now passes without masking drift.

## Manual repo-admin actions still required
1. **GitHub Branch Protection verification/update (UI):**
   - Confirm required checks align to the intended authoritative workflow (`PR Checks` jobs) on `main`.
   - Remove stale required checks tied to obsolete branch/workflow assumptions if present.
2. **Secrets-backed runtime validation:**
   - Execute `Nightly Prod → Dev Sync` in Actions with real secrets to confirm end-to-end health after these changes.
3. **Branch model confirmation:**
   - Confirm whether `develop` exists in upstream operating model. If not, keep all triggers/docs main-only.

## Remaining risks
- In this environment, upstream branch protection and remote branch topology cannot be authoritatively inspected (no remote auth).
- Nightly sync cannot be fully validated without production/dev secret-backed connectivity.
