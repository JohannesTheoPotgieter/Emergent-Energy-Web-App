# Finance Removal Manifest

**Status:** DRAFT for owner sign-off. **Read-only investigation — nothing was dropped, migrated, or changed.**
**Generated:** 2026-06-09 on branch `chore/finance-removal-manifest`.

Purpose: give the owner the definitive **REMOVE-NOW / MIGRATE-FIRST / KEEP** decision for every finance
removal candidate, backed by whole-repo reference evidence + live row counts, so each line can be approved
before any `DROP`.

## Method (how each classification was reached)

1. **Reference evidence** — whole-repo `ripgrep` (client + server + shared + qa + scripts) for each
   candidate's snake_case table name **and** its Drizzle camelCase export. Counts and files are real and
   complete as of this commit.
2. **Reader triage** — references are split into:
   - **Live readers** = runtime `server/` + `client/` code (repositories, services, routes, pages).
   - **Schema definition** = `shared/schema/*.ts` (the table definition + barrel) — always present, not a reader.
   - **Schema-management / cleanup, NOT readers** = `server/db.ts` (SQLite dev-fallback `CREATE TABLE` DDL),
     `server/lifecycle-routes.ts` (project-delete `DELETE FROM …` cascade), `server/invoice-pattern-routes.ts`
     (a hard-coded table-name list), `script/full-schema-alignment.sql`, `script/pre-push-enums.sql`,
     `qa/prod-delete-projects.sql`, `script/delete-*.sql`, `scripts/drizzle-bootstrap.ts`,
     `scripts/backfill-*.ts`. These reference nearly every table and were **excluded** when judging "is it read".
   - **Reachability** = whether a backing repository is actually imported by a route/service (a repo with
     **0 importers is dead code**, so the table it reads has no live path).
3. **Live row counts** — schema provisioned with `npm run db:push` against a throwaway Postgres 16 and queried.
   ⚠️ **This sandbox has no production data, so every count below is `0`.** The exact SQL is in
   [§ Live row-count query](#live-row-count-query) — **the owner must re-run it against the production DB**
   before approving any drop. Reference evidence (the load-bearing signal) is real; row counts are pending prod.

## Headline finding

Of the 13 tables proposed as **HARD-REMOVE**, **only `fye_kpi_counters` is REMOVE-NOW** (its sole reader is a
dead repository). Every other HARD-REMOVE candidate has at least one **reachable runtime reader** and is
reclassified **MIGRATE-FIRST**, or is an **actively-used surface** reclassified **KEEP**
(`manual_edit_flags`, `qb_revenue_recon_ignores`). No other candidate is safe to drop today.

---

## A. Proposed HARD-REMOVE — tables

| Candidate (table / export) | Live readers (runtime files, refs) | Schema-mgmt only | Live rows (prod TODO) | **Class** | Canonical replacement | Parity check before drop |
|---|---|---|---|---|---|---|
| `finance_cos_monthly` / `financeCosMonthly` | `finance-temporal-repository`(5), `program-dashboard-repository`(3), `finance-core-trust-service`(5), `company-overview-service`, `financial-temporal`(2), `finance-trust/revalidation`(2), `finance-trust/exceptions`(2), `selected-truth-registry`, `temporal-helpers`, `routes/dashboard-routes`, `routes/finance-trust-routes`(2), `departments/finance-routes`(2), `excelParser`(5), `storage`(2) | db.ts DDL, lifecycle cascade, alignment SQL | 0 | **MIGRATE-FIRST** | §3.3 line-level: `normalizedCostLines` + `normalizedCostLineActuals` aggregated by recognition month (this is a **§3.1 snapshot table**, `effectiveTo`) | Σ `value` per (project, month) == Σ realised line-level COS per (project, recognition month) within **R1**, `effective_to IS NULL` |
| `finance_revenue_monthly` / `financeRevenueMonthly` | `finance-temporal-repository`(5), `program-dashboard-repository`(3), `pm-monthly-report-service`(2), `financial-temporal`(2), `finance-core-trust-service`, `company-overview-service`, `finance-trust/revalidation`(2), `selected-truth-registry`, `routes/dashboard-routes`, `departments/finance-routes`(2), `excelParser`(5), `storage`(2) | db.ts DDL, lifecycle cascade, alignment SQL | 0 | **MIGRATE-FIRST** | §3.3 per-line POC: `normalizedRevenueLines` + `categoryRevenueAllocations` (snapshot table, `effectiveTo`) | Σ `value` per (project, month) == Σ derived revenue per (project, recognition month) within **R1** |
| `tracker_monthly_manual` / `trackerMonthlyManual` | `finance-support-repository`(13) → `storage.getTrackerMonthlyManual/upsert…`, `departments/finance-routes`, `routes/finance-lines.routes`, `routes/finance-legacy-extracted-routes`, `lib/calculations/financeUtils`, `finance-trust/revalidation`(2) | drizzle-bootstrap, backfill, alignment SQL | 0 | **MIGRATE-FIRST** | Fiscal-period-scoped line-level + `manual_adjustments` (manual override path) + `0083 project_info_id` scoping | Per (trackerType, month, project) `realised`/`budget` reconcile to line-level within R1 |
| `cashflow_weekly_manual` / `cashflowWeeklyManual` | `finance-support-repository`(13) → `storage`, `departments/finance-routes`, `finance-trust/revalidation`(2) | invoice-pattern list, alignment SQL | 0 | **MIGRATE-FIRST** | Cashflow-2026 register (`server/routes/register-cashflow-2026-routes.ts`). **Confirm the `storage` call-sites are live; if none, reclassify REMOVE-NOW.** | Weekly cashflow totals reconcile with the 2026 register |
| `opex_weekly_manual` / `opexWeeklyManual` | `finance-support-repository`(7) → `storage`, `departments/finance-routes` | invoice-pattern list, alignment SQL | 0 | **MIGRATE-FIRST** | Cashflow-2026 register OPEX path. **Confirm live storage call-sites.** | Weekly OPEX totals reconcile with the 2026 register |
| `available_payment_overrides` / `availablePaymentOverrides` | `finance-support-repository`(7) → `storage`, `finance-trust/revalidation`(2) | lifecycle cascade, alignment SQL | 0 | **MIGRATE-FIRST** | Cashflow-2026 available-payment override path. **Confirm live storage call-sites.** | Available-payment overrides reconcile with the 2026 register |
| `cashflow_balance_history` / `cashflowBalanceHistory` | `finance-support-repository`(7) → `storage` | invoice-pattern list, lifecycle cascade, alignment SQL | 0 | **MIGRATE-FIRST** | Cashflow-2026 balance-history path. **Confirm live storage call-sites; likely audit-only history.** | History rows preserved or exported before drop |
| `available_payment_history` / `availablePaymentHistory` | `finance-support-repository`(5) → `storage` | lifecycle cascade, alignment SQL | 0 | **MIGRATE-FIRST** | Cashflow-2026 history path. **Confirm live storage call-sites.** | History rows preserved or exported before drop |
| `fye_revised_budget_monthly` / `fyeRevisedBudgetMonthly` | `fye-tracking-data-repository`(14) → `lib/finance/fye-tracking/service` → `departments/fye-revenue-tracking-routes` (**reachable**) | drizzle-bootstrap, backfill | 0 | **MIGRATE-FIRST** | Fiscal-period + line-level FYE revenue tracking | FYE revised-budget monthly reconciles to line-level within R1 |
| `fye_kpi_counters` / `fyeKpiCounters` | **`fye-tracking-repository` ONLY — and that repo has 0 importers (DEAD CODE)** | db.ts DDL, alignment SQL | 0 | **✅ REMOVE-NOW** | None — no live path. Drop the table **and** the dead `server/repositories/fye-tracking-repository.ts`. | Confirm prod row count; confirm the dead repo is not dynamically imported (verified: no `import` of it anywhere). If prod rows > 0, export them first. |
| `manual_edit_flags` / `manualEditFlags` | `repositories/manual-edit-flags-repository`(17) → `report-routes` + `departments/finance-routes`(11), `lib/manual-edit-flag`(9), `smart-import-routes`(11) (**heavily used**) | alignment SQL | 0 | **KEEP** | None — active cross-cutting manual-override system (Smart Import + finance edits). Not a removable snapshot. | n/a — reclassified KEEP |
| `mock_sp_items` / `mockSpItems` | `intake-connector`(6), `seed-mock-intake`(3) | db.ts DDL, invoice-pattern list, alignment SQL | 0 | **KEEP** (out of finance scope) | None — dev/mock intake fixture in `shared/schema/imports.ts`, read by the mock intake connector. Not finance data. | n/a — reclassified KEEP (remove only if the mock intake connector is retired) |
| `qb_revenue_recon_ignores` / `qbRevenueReconIgnores` | `qb-reconciliation-overrides-repository`(12), `services/qb-tracker-reconcile`(10), `services/reconciliation-service`(11), `services/quickbooks-cascade-proposals-service`(10), `departments/finance-routes` (**heavily used**) | — | 0 | **KEEP** | None — the **revenue** recon-ignores feed the company-wide R2 engine + per-project reconciliation; the revenue recon path is explicitly retained. | n/a — reclassified KEEP |

## B. Proposed HARD-REMOVE — columns

| Candidate column | Live readers | Live rows (prod TODO) | **Class** | Canonical replacement | Parity check |
|---|---|---|---|---|---|
| `financial_reconciliation.tracker_vs_qb_status` / `.tracker_vs_qb_delta` | `services/reconciliation-service`(8/10), `routes/reconciliation.routes`, **client** `finance-project-detail.tsx`(4/3) + `finance-reconciliation-board.tsx`(2/2) | 0 (count of non-null `tracker_vs_qb_status`) | **MIGRATE-FIRST** | Company-wide R2 engine `qb_recon_summary` (COS only reconciles company-level — QB bills aren't project-tagged). Migrate the per-project display, then drop both columns. | Per-project tracker-vs-QB status/delta derivable from R2 (or revenue-only) before the columns are dropped |
| `expense_task_links.expenseId` (`expense_id`) | `storage`(12: `upsert/delete/updateExpenseTaskLink`), `routes/finance-legacy-extracted-routes`, `services/scheduler-commit`(8), `smart-import-routes`(9), **client** `cashflow.tsx` | 0 (count of populated `canonical_expense_id`) | **KEEP (reclassified 2026-06-09)** | None today. `canonicalExpenseId` is **inert**, not a working canonical: it is never populated from null — the only two writers (`scheduler-commit`, `smart-import-routes`) are *remap* sites both gated behind `if (canonId == null) continue;`, and no resolver exists to derive it from `expense_id`. `expense_id` is the live **NOT NULL** key for every reader (`upsert/delete/updateExpenseTaskLink` WHERE clauses) — it drives expense↔task linking and date overrides (cashflow timing). | **STOP.** Migrating would require *building* an `expense_id → normalized_cost_lines.id` resolver **and** changing the client contract (`cashflow.tsx` / POST body) — net-new wiring on a live financial-timing feature, not repointing to an existing canonical. Per "never change a live financial number" / "if parity fails, STOP". Reclassified KEEP, same as groups 2/3/6 (live-with-no-working-canonical). |

## C. Proposed HARD-REMOVE — types & routes/files

| Candidate | Live readers | **Class** | Canonical replacement | Parity check |
|---|---|---|---|---|
| `ProgramExpense` (type) | `client/lib/api.ts`(4), `departments/finance-routes`(6), `excelParser`(4), `repositories/finance-expense-engine-repository`(5), `routes/finance-legacy-extracted-routes`(2), `services/project-cost-line-read-service`, `storage`(12) | **MIGRATE-FIRST** (large) | Line-level `normalizedCostLines` + promoted `finance.cost_lines` (see `promoted-read-compat.ts`) | `promoted-read-compat.ts` already compares legacy program-expense totals vs promoted; migrate all 9 consumers, then remove the type |
| `ProgramInflows` (type) | 18 files incl. `client/lib/api.ts`, `departments/finance-routes`(13), `repositories/finance-inflows-repository`(9), `routes/cos-control-routes`(8), `register-cashflow-2026-routes`(2), `storage`(13), + 9 more routes | **MIGRATE-FIRST** (large) | Line-level `normalizedRevenueLines` + promoted `finance.inflows` (`legacy_program_inflow_id` parity in `promoted-read-compat.ts`) | Legacy-vs-promoted inflow totals tie (parity layer exists); migrate all 18 consumers, then remove |
| `server/routes/finance-legacy-extracted-routes.ts` | Registered in `routes/route-registry.ts`; referenced by `finance-inflows-repository`, `lib/finance/validators`, `lib/finance-trust/integrity-audit`; 8 routes in `qa/fixtures/route-coverage-baseline.json` | **KEEP (reclassified 2026-06-09)** | None — re-homing is **relocation, not removal**. The file holds 32 **live, canonical** route handlers and is already in the correct `server/routes/` directory (it only uses the `-routes.ts` separator instead of `.routes.ts`). | **STOP.** Renaming the file removes zero dead/duplicate/legacy objects and churns the legacy-debt ledger: `route-permission-coverage.test.ts` keys 8 baseline entries **by file path**, so a rename produces "NEW unguarded route" strings and fails CI until the baseline is regenerated. The genuine debt reduction here is adding per-route `requirePermission` (an RBAC change to live finance routes) — a separate effort, out of scope for a HARD-removal pass. |
| `server/services/reconciliation-qb-gap.ts` (COS-project path) | `routes/reconciliation.routes`(1) | **MIGRATE-FIRST** | Company-wide R2 (`qb_recon_summary`) for the COS gap; **keep the revenue path** | Revenue gap output unchanged; COS-project gap reproduced by R2 before the COS path is removed |

## D. MIGRATE-FIRST (already correctly classified)

| Candidate | Live readers (the named reader + target) | **Class** | Canonical replacement | Parity check |
|---|---|---|---|---|
| `tracker_revenue_summary` / `trackerRevenueSummary` | `lib/import/commit-executor`(8) (writer), `lib/import/normalizer`(2), `repositories/tracker-replica-repository`(5) → `routes/tracker-replica.routes` + `reconciliation.routes` + `excel-vs-app.routes`, **client** `revenue-tracking.tsx`, `tracker-cell-format` | **MIGRATE-FIRST** ✓ | `normalizedRevenueLines` + `projectRevenueSummary` (planned vs actual) | Per-project planned revenue/expenditure/profit reconcile to line-level within R1 |
| `writeback_mappings` / `writebackMappings` | `repositories/work-management-repository`(6) → 6 importers (`working-plan-routes`, `work-items-extracted-routes`, `planning-extracted-routes`, `report-routes`, `storage`), `invoice-pattern-routes`, `lifecycle-routes` | **MIGRATE-FIRST** ✓ | QB write-back successor surface (owner to name); confirm no active write-back depends on it | Write-back mapping continuity for any live QB write-back |
| `writeback_audit_log` / `writebackAuditLog` | `repositories/work-management-repository`(5) → same importers, `engineering-routes`(2), `storage`, `invoice-pattern-routes` | **MIGRATE-FIRST** ✓ | Audit successor (or export to `audit_events`) | Audit-trail continuity (export rows before drop) |
| `client/src/components/tabs/QuickBooksReconciliationTab.tsx` | imported + rendered by `client/src/pages/project-detail.tsx` | **MIGRATE-FIRST** ✓ | `finance-reconciliation-board.tsx` / company-wide R2 surface | The tab's per-project recon data is available in the new surface before the tab is removed |

## E. DO NOT TOUCH — confirmed out of finance scope (KEEP)

Per the brief, these are **not** finance-removal candidates and were not analysed for removal. They exist in the
current schema (confirmed via `db:push`) and back the planning / tracker-replica / weekly-review / schedule
surfaces, not finance reporting: `project_plan`, `project_plan_dependency`, `working_plan_scenario`,
`working_plan_dependency_override`, `schedule_change_notice`, `milestone_task_links`, `tr_items`,
`tr_item_project_links`, `tr_item_suggestion_decisions`, `weekly_reviews`. **Classification: KEEP (out of scope).**

---

## Recommended drop order (after owner sign-off + prod row counts)

1. **`fye_kpi_counters`** — REMOVE-NOW: drop the table + the dead `fye-tracking-repository.ts` (no migration).
2. **`financial_reconciliation.tracker_vs_qb_*` columns** — small, bounded migration with the company-wide
   R2 parity layer. **DONE** (dropped). `~~expense_task_links.expenseId~~` was reclassified **KEEP** after
   validation: `canonicalExpenseId` is inert (no resolver), `expense_id` is the live NOT-NULL linkage key — see § B.
3. **`tracker_revenue_summary`, `writeback_*`, `QuickBooksReconciliationTab`, `reconciliation-qb-gap` COS path**
   — feature-scoped migrations. `~~finance-legacy-extracted-routes.ts~~` was reclassified **KEEP**: re-homing is
   relocation (not removal) of 32 live routes and churns the path-keyed route-coverage ledger — see § C.
4. **`finance_cos_monthly` / `finance_revenue_monthly` / `tracker_monthly_manual` / weekly-cashflow tables /
   `fye_revised_budget_monthly`** — the temporal/program snapshots; migrate every named reader to the line-level
   §3.3 path with the R1 parity proof, then drop.
5. **`ProgramExpense` / `ProgramInflows`** — last (largest blast radius: 9 / 18 consumers).
6. **Never (this pass):** `manual_edit_flags`, `qb_revenue_recon_ignores`, `mock_sp_items` — reclassified KEEP.

## Live row-count query

Run against the **production** DB (this sandbox returned `0` for all — fresh provisioned schema, no prod data):

```sql
SELECT 'finance_cos_monthly' t, count(*) n, coalesce(sum(value),0) sum_value FROM finance_cos_monthly
UNION ALL SELECT 'finance_revenue_monthly', count(*), coalesce(sum(value),0) FROM finance_revenue_monthly
UNION ALL SELECT 'tracker_monthly_manual', count(*), coalesce(sum(realised),0)+coalesce(sum(budget),0) FROM tracker_monthly_manual
UNION ALL SELECT 'cashflow_weekly_manual', count(*), NULL FROM cashflow_weekly_manual
UNION ALL SELECT 'opex_weekly_manual', count(*), NULL FROM opex_weekly_manual
UNION ALL SELECT 'available_payment_overrides', count(*), NULL FROM available_payment_overrides
UNION ALL SELECT 'fye_revised_budget_monthly', count(*), NULL FROM fye_revised_budget_monthly
UNION ALL SELECT 'cashflow_balance_history', count(*), NULL FROM cashflow_balance_history
UNION ALL SELECT 'available_payment_history', count(*), NULL FROM available_payment_history
UNION ALL SELECT 'fye_kpi_counters', count(*), NULL FROM fye_kpi_counters
UNION ALL SELECT 'manual_edit_flags', count(*), NULL FROM manual_edit_flags
UNION ALL SELECT 'mock_sp_items', count(*), NULL FROM mock_sp_items
UNION ALL SELECT 'qb_revenue_recon_ignores', count(*), NULL FROM qb_revenue_recon_ignores
UNION ALL SELECT 'tracker_revenue_summary', count(*), NULL FROM tracker_revenue_summary
UNION ALL SELECT 'writeback_mappings', count(*), NULL FROM writeback_mappings
UNION ALL SELECT 'writeback_audit_log', count(*), NULL FROM writeback_audit_log
UNION ALL SELECT 'expense_task_links', count(*), count(canonical_expense_id) FROM expense_task_links
UNION ALL SELECT 'financial_reconciliation', count(*), count(tracker_vs_qb_status) FROM financial_reconciliation
ORDER BY 1;
```

**No code, schema, or migration was changed by this manifest — it is documentation only.**
