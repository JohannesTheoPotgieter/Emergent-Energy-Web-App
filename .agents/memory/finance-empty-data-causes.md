---
name: Finance page empty-data / 500 root causes
description: Why the Finance home recon board shows "No data" and why /api/company-overview 500s — both are dev-DB data/schema drift, not code bugs.
---

# Recon board "No data" everywhere → empty fiscal calendar

The Finance home "Project GP & reconciliation health" board reads the
`financial_reconciliation` snapshot table (via `getReconciliationPortfolio`).
That table is populated by `refreshReconciliationForProjects` (runs on every
smart-import commit). The refresh buckets each finance line into a **fiscal
period** by its recognition date and **skips any line whose date matches no
period**. If `fiscal_periods` (and its parent `fiscal_years`) is empty, every
line is skipped → "0 row(s) written" on every import → board shows "No data"
for all projects even though finance lines exist.

**Fix:** seed the calendar with `scripts/seed-fiscal-years.sql` (idempotent;
seeds FY26+FY27 fiscal_years + 24 monthly fiscal_periods), then run the recon
refresh (`refreshReconciliationForProjects(db, null)` or
`POST /api/finance/reconciliation/refresh`). The refresh needs `initializeDatabase()`
called first — `db` in `server/db.ts` is a mutable binding set after async init.

**Note:** the QB column (`tracker_vs_qb_*`) stays null after this refresh — it's
populated by a separate QB-sync path, not the import-time refresh.

# /api/company-overview 500 → handover_packs missing columns

`[CompanyOverview] Error: Failed query: select ... from "handover_packs"` means
the query selects columns that don't physically exist in the table. Schema
(`shared/schema/handover.ts`) and migration 0071 define
`client_submitted_by_user_id`, `client_accepted_by_user_id`,
`matriarch_accepted_by_user_id`, but the dev table was missing them even though
startup reported "97/97 migrations applied".

**Why:** migration journal marked 0071 applied but the ALTERs never physically
ran (db:push-vs-migration drift — same class as the 0090–0096 canary-probe fix).
**How to apply:** re-run the migration's `ADD COLUMN IF NOT EXISTS` + FK `DO`
blocks against the affected DB (safe, additive). Raw Drizzle queries pick up the
new columns immediately — no server restart needed.

# Production caveat
These were applied to the DEV DB only. Prod needs: (a) migration 0071 to have
actually added the handover columns (verify — prod may share the drift), and
(b) the fiscal-year/period seed run (it's data, not a migration).
