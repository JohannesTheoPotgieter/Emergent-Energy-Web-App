# Runbook: Deploy & Rollback

How the app deploys on Replit, and how to recover when a deploy goes wrong.

## Deploy pipeline (Replit autoscale)

Defined in [`.replit`](../../.replit) `[deployment]` — **do not change without
owner approval**:

- **Build:** `npm run build && npm run db:migrate`
- **Run:** `npm run start` (runs `dist/index.cjs`)
- **Target:** autoscale, single public port **5000**.

`npm run db:migrate` chains three steps:
`scripts/drizzle-bootstrap.ts` (marks the baseline applied on push-managed prod
DBs so it never replays) → `drizzle-kit migrate` (applies pending migrations) →
`scripts/db-verify-schema.ts --repair` (proves every declared table/column
exists; additive repair only). Because of the `--repair` step, the deploy
command cannot exit 0 while declared columns are missing.

## Before you deploy

1. PR is green: `ci:compile`, `db:check`, `check:agent-docs`, `test` all pass
   (the PR gate). For substantial changes also run `npm run qa:full-proof`
   locally (API/smoke/release-gate do **not** run in CI).
2. **Schema changes ship as a committed migration.** Edit `shared/schema/*.ts`,
   run `npm run db:generate -- --name=<short_snake_case>`, and commit the
   generated `migrations/*.sql` + `migrations/meta/*`. A `db:push`-only change
   will **not** publish — `db:push` does not run on deploy. `db:check` fails any
   PR that edits the schema without a matching migration.
3. Secrets are set in the **Replit Secrets Manager** (never in committed files).
   New required var? Add it there before deploying. See
   [`secrets-rotation.md`](secrets-rotation.md) and [`../../.env.example`](../../.env.example).

## Deploy

Publish from the Replit UI (the `[deployment]` pipeline runs build + migrate,
then start). Watch the deploy logs through the `db:migrate` step — that is where
a bad migration surfaces.

## Health check

The server exposes `/api/health`. After deploy, confirm it returns OK and spot-
check a finance page and an integrated (MS/QB/Pipedrive) page. **Replit deploy
health is not CI health** — treat the GitHub PR gate as merge authority and this
health check as deploy verification.

## Rollback

### Code rollback

Redeploy the previous known-good build from the Replit deployments UI. The exact
mechanism depends on the Replit plan — **TODO(owner): confirm the redeploy/
rollback control available on this workspace.**

### The migration caveat (read before rolling back)

Migrations are **forward-only** SQL and `db:verify-schema --repair` only *adds*
missing artifacts. Rolling code back to a commit **before** a migration does not
undo the migration — the DB keeps the newer schema. This is usually fine
(additive changes are backward-compatible), but:

- If a migration **dropped or renamed** a column the old code needs, a code-only
  rollback will break. You must restore the DB from backup (below) or hand-write
  a compensating migration.
- Never re-run the baseline (`migrations/0000_baseline_*.sql`) against prod — it
  is non-idempotent; `drizzle-bootstrap.ts` exists specifically to prevent that.

### Restore the database from backup

Backups come from `.github/workflows/db-backup.yml` (daily: dump prod → upload
as a GitHub Actions artifact → restore-drill → finance fingerprint). To restore:

1. Download the latest `db-backup-<run_id>` artifact from the workflow run
   (**30-day retention; GitHub-artifact-only — no off-GitHub copy**).
2. Restore into a scratch DB first and verify with
   `npm run db:restore:verify` (set `RESTORE_TARGET_DATABASE_URL`, optionally
   `BACKUP_SOURCE_DATABASE_URL` for a fingerprint comparison). This is the same
   check the nightly drill runs — it confirms the finance line counts/sums
   survive the round-trip.
3. Only then promote the verified restore. Coordinate with the owner —
   restoring prod is a destructive, owner-authorised action.

For finance-specific incidents (bad numbers, disputed edits) also consult
[`../finance-freeze-runbook.md`](../finance-freeze-runbook.md), which owns the
finance break-glass procedures.

## Notes for the next maintainer

- There is **no push-triggered CI** (`ci.yml` does not exist) — nothing runs
  automatically after merge to `main` except the scheduled backup workflow.
- The daily backup workflow's restore step was fixed in the handover cleanup
  (it had been red on a `SUM(text)` bug); if it goes red again, check
  `scripts/verify-backup-restore.ts` first.
