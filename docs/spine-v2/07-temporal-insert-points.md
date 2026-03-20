# Prompt 9 — Temporal Financial Insert Points

All locations in the codebase that INSERT, UPDATE, or DELETE rows in the 8 temporal financial tables. These are the points where temporal column management (`effective_from`, `effective_to`, `snapshot_run_id`) must be integrated when the import pipeline is updated (Prompt 10+).

---

## 1. `server/smart-import-routes.ts` — Bulk Import (DELETE + INSERT)

The smart-import pipeline uses a **delete-then-reinsert** pattern per project per import run.

| Table | Pattern | Lines (approx) |
|-------|---------|-----------------|
| `normalized_revenue_lines` | DELETE by projectId → bulk INSERT | DELETE + INSERT in `/api/smart-import/upload` |
| `normalized_cost_lines` | DELETE by projectId → bulk INSERT | DELETE + INSERT in `/api/smart-import/upload` |
| `program_inflows` | DELETE by projectId → bulk INSERT | DELETE + INSERT in `/api/smart-import/upload` |
| `program_expense` | DELETE by projectId → bulk INSERT | DELETE + INSERT in `/api/smart-import/upload` |
| `project_revenue_summary` | DELETE by projectId → INSERT | DELETE + INSERT in `/api/smart-import/upload` |

### Temporal migration action:
- **Before DELETE**: SET `effective_to = NOW()` on existing rows instead of hard-deleting.
- **On INSERT**: Set `effective_from = NOW()`, `effective_to = NULL`, `snapshot_run_id = <current_run_id>`.
- This converts the destructive pattern into a soft-close + new-version pattern.

---

## 2. `server/storage.ts` — Individual Row Inserts

Storage functions that create individual rows (used by routes and background jobs):

| Function | Table | Notes |
|----------|-------|-------|
| `createNormalizedCostLine()` | `normalized_cost_lines` | Single row insert |
| `createNormalizedRevenueLine()` | `normalized_revenue_lines` | Single row insert |
| `createCashflowPoint()` | `cashflow_points` | Single row insert |
| `createFinanceRevenueMonthly()` | `finance_revenue_monthly` | Single row insert |
| `createFinanceCosMonthly()` | `finance_cos_monthly` | Single row insert |
| `createProjectRevenueSummary()` | `project_revenue_summary` | Single row insert via `upsertProjectRevenueSummary` |

### Temporal migration action:
- Default values (`effective_from = NOW()`, `effective_to = NULL`) handle new inserts automatically via the migration defaults.
- For upsert functions: close the old row (`SET effective_to = NOW()`) before inserting the replacement.
- Pass `snapshot_run_id` when called from an import context.

---

## 3. `server/subcontractor-routes.ts` — Subcontractor Cost Lines

| Operation | Table | Pattern |
|-----------|-------|---------|
| POST `/api/subcontractor-costs` | `normalized_cost_lines` | INSERT new cost line |
| DELETE `/api/subcontractor-costs/:id` | `normalized_cost_lines` | DELETE by id |

### Temporal migration action:
- **INSERT**: Defaults handle `effective_from`. No `snapshot_run_id` needed (manual entry, not import).
- **DELETE**: Convert to `SET effective_to = NOW()` instead of hard delete.

---

## 4. `server/routes.ts` — Ad-hoc Route Inserts

| Route | Table | Pattern |
|-------|-------|---------|
| POST `/api/normalized-revenue-lines` | `normalized_revenue_lines` | INSERT |
| POST `/api/normalized-cost-lines` | `normalized_cost_lines` | INSERT |

### Temporal migration action:
- Defaults handle `effective_from`. These are manual entries — no `snapshot_run_id`.

---

## 5. Tables with No Direct Write Paths Found

| Table | Notes |
|-------|-------|
| `cashflow_points` | Only written via `storage.createCashflowPoint()` (covered in §2) |
| `finance_revenue_monthly` | Only written via `storage.createFinanceRevenueMonthly()` (covered in §2) |
| `finance_cos_monthly` | Only written via `storage.createFinanceCosMonthly()` (covered in §2) |

---

## Summary: Migration Priority

| Priority | Location | Reason |
|----------|----------|--------|
| **P0** | `smart-import-routes.ts` | Bulk import is the primary data source; DELETE→soft-close is the biggest temporal win |
| **P1** | `storage.ts` upsert functions | Upserts need old-row closure |
| **P2** | `subcontractor-routes.ts` DELETE | Convert hard delete to soft close |
| **P3** | `routes.ts` / `storage.ts` INSERTs | Already handled by column defaults |

No existing queries need modification — the temporal columns are additive and the current `SELECT *` patterns will include them transparently.
