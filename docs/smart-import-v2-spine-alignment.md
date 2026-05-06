# Smart Import v2 — Spine Alignment Audit

> **Date:** 2026-04-08
> **Purpose:** Determine the canonical data source for each section in the import planner.
> **Method:** Traced actual write paths in `server/smart-import-routes.ts` commit handler, read paths across the full codebase, and documented source-of-truth guidance.

---

## Canonical Source Decision Table

| Section | Current write target(s) | Current read target(s) | Canonical active source for planner | Derivative/projection tables | Risks / notes | Final decision |
|---------|------------------------|----------------------|-------------------------------------|------------------------------|---------------|----------------|
| **PLAN** | `work_items` only (source=SMART_IMPORT, workstream=PM). `normalizedPlanTasks` is **never written** during commit. | `work_items` — read by 11+ dashboard/report/API endpoints. `normalizedPlanTasks` — **zero reads** in production code. | **`work_items`** (filtered: source=SMART_IMPORT, workstream=PM, deletedAt IS NULL) | `normalizedPlanTasks` (dead table — defined in schema but never written or read) | `work_items` uses deletedAt soft-delete, not temporal effectiveFrom/To. | **`work_items` is canonical.** `normalizedPlanTasks` is a dead table. |
| **REVENUE** | `normalizedRevenueLines` (written first), then `programInflows` (derivative, written second) | `normalizedRevenueLines` — 33 read sites across dashboards, reports, KPIs. `programInflows` — ~5 reads, mostly FYE tracking. | **`normalizedRevenueLines`** (filtered: projectId, effectiveTo IS NULL) | `programInflows` (legacy FYE tracking, secondary) | Both have temporal columns. `normalizedRevenueLines` is explicitly documented as canonical in `docs/data-import-and-source-of-truth.md`. | **`normalizedRevenueLines` is canonical.** |
| **EXPENDITURE** | `normalizedCostLines` (written first), then `programExpense` (derivative, written second) | `normalizedCostLines` — 53 read sites across dashboards, reports, subcontractors, invoices. `programExpense` — ~8 reads, mostly FYE/legacy. | **`normalizedCostLines`** (filtered: projectId, effectiveTo IS NULL) | `programExpense` (legacy FYE tracking, secondary) | Both have temporal columns. `normalizedCostLines` is explicitly documented as canonical in `docs/data-import-and-source-of-truth.md`. | **`normalizedCostLines` is canonical.** |

---

## Evidence: PLAN

### Write path (commit handler, ~lines 1840-1970)

1. **Hard-deletes** existing work_items: `DELETE FROM work_items WHERE source='SMART_IMPORT' AND workstream='PM' AND projectId=X`
2. **Inserts** new work_items from `norm.planTasks`
3. `normalizedPlanTasks` is **never inserted into** during the commit transaction

### Read path

| File | Usage |
|------|-------|
| `server/report-routes.ts:532-580` | PM Monthly Report — reads all PM/SMART_IMPORT tasks as "current plan state" |
| `server/storage.ts:1441-1468` | `getAllProjectPlans()` / `getProjectPlansByProject()` |
| `server/routes/overview-extracted-routes.ts:75` | Dashboard overview |
| `server/routes/planning-tasks-routes.ts:1315-1320` | Auto-map key dates |
| `server/routes/working-plan-routes.ts:27-28` | Working plan CPM calculations |
| `server/lifecycle-routes.ts:1410,2018` | Lifecycle operations |
| `server/departments/project-routes.ts:664` | Department project view |

### `normalizedPlanTasks` status

- **Defined** in `shared/schema/imports.ts:236-266`
- **Imported** in `server/ms-sync-routes.ts:10` but never used
- **Zero reads** in production code
- **Zero writes** in production code
- **No temporal columns** (no effectiveFrom/To)
- **Verdict: Dead table.** Safe to ignore for planner purposes.

### Conclusion

`work_items` is the sole authoritative store for imported plan data. The prompt 2 baseline.ts was correct to query `work_items`. This is not a convenience table — it is the direct write target and the universal read source.

---

## Evidence: REVENUE

### Write path (commit handler, ~lines 2012-2181)

1. **Soft-closes** existing normalizedRevenueLines (effectiveTo = NOW)
2. **Inserts** new normalizedRevenueLines from `norm.revenueLines` (with temporal stamps)
3. **Soft-closes** existing programInflows
4. **Inserts** new programInflows (with temporal stamps, composite-key matching for preserving manual edits)

### Canonical documentation

From `docs/data-import-and-source-of-truth.md:13`:
> Revenue lines: `normalized_revenue_lines`

### Read path summary

33 production read sites across dashboards, KPIs, reports, portfolio views, lifecycle routes, and the v2 API repository.

---

## Evidence: EXPENDITURE

### Write path (commit handler, ~lines 2234-2462)

1. **Soft-closes** existing normalizedCostLines (effectiveTo = NOW)
2. **Inserts** new normalizedCostLines from `norm.costLines` (with temporal stamps, preserving manual edits)
3. **Soft-closes** existing programExpense
4. **Inserts** new programExpense (derived from same data)

### Canonical documentation

From `docs/data-import-and-source-of-truth.md:12`:
> Cost lines: `normalized_cost_lines`

### Read path summary

53 production read sites across dashboards, subcontractor routes, invoice patterns, financial review, and all KPI services.

---

## Revenue Milestone Number Analysis

### Pipeline trace

| Stage | milestone_no available? | milestone_percent available? |
|-------|------------------------|------------------------------|
| Excel tracker columns | Yes — trackers commonly have "No.", "#", "Milestone No" columns | Yes — trackers commonly have "%" columns |
| Synonym mapping (`synonyms.ts:20`) | Yes — `milestone_no: ["no.", "no", "milestone no", "#"]` | Yes — `percent: ["%", "percent", "percentage", "milestone %"]` |
| Canonical fields (frontend) | Yes — `"milestone_no"`, `"percent"` listed | Yes |
| Column mapper (`mapper.ts`) | Yes — maps headers to `milestone_no` and `percent` | Yes |
| **Normalizer (`normalizer.ts`)** | **NO — field is dropped** | **NO — field is dropped** |
| NormalizationResult type | No `milestoneNo` property | No `milestonePercent` property |
| `normalizedRevenueLines` DB table | **No column** | **No column** |
| `programInflows` DB table | Yes — `milestone_no` column | Yes — `milestone_percent` column |

### Conclusion

milestone_no IS present in real Excel trackers and IS recognized by the mapper, but is **dropped by the normalizer**. The fix is to:
1. Extend `NormalizationResult.revenueLines` to include `milestoneNo` and `milestonePercent`
2. Extract these values in the normalizer
3. Use `milestoneNo` as the primary identity key in the planner when available
4. The normalizedRevenueLines DB table does NOT need a column for this — the planner uses it for matching only, not for storage

---

## Planner Source Alignment Summary

| Section | Prompt 2 source | Correct? | Action needed |
|---------|----------------|----------|---------------|
| PLAN | `work_items` (source=SMART_IMPORT, workstream=PM) | **Yes — correct** | Document evidence. No code change needed. |
| REVENUE | `normalizedRevenueLines` (effectiveTo IS NULL) | **Yes — correct** | No code change needed. |
| EXPENDITURE | `normalizedCostLines` (effectiveTo IS NULL) | **Yes — correct** | No code change needed. |

The prompt 2 planner was already correctly anchored. The main improvements needed are:
1. Add `canonicalSource` metadata to planner output
2. Preserve milestone_no through normalization for better revenue identity
3. Document the evidence thoroughly (this document)
