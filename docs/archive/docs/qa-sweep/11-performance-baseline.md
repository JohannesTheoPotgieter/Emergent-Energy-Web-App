# QA Sweep 11 — Performance Baseline Check

**Date:** 2026-03-21
**Status:** ISSUES FOUND — 3 high-priority, 4 medium-priority

---

## 1. N+1 Query Detection

**Status: HIGH RISK — 7 instances found**

All flagged patterns use `Promise.all(.map(async => ...))` where each iteration executes 1+ DB queries via `getAssignmentsForEntity()` or `getGeneralApprovalAssignments()`.

| # | File | Line | Pattern | Severity |
|---|------|------|---------|----------|
| 1 | `server/quality-routes.ts` | 567 | `itemIds.map(async (itemId) => getAssignmentsForEntity("quality_item", itemId))` | HIGH — unbounded item count |
| 2 | `server/deliverable-capture-routes.ts` | 241 | `serializedRows.map(async (row) => getAssignmentsForEntity("deliverable", row.id))` | HIGH — all deliverables per project |
| 3 | `server/engineering-routes.ts` | 1657 | `result.map(async (deliverable) => getAssignmentsForEntity("deliverable", deliverable.id))` | HIGH — filtered deliverable list |
| 4 | `server/ms-sync-routes.ts` | 614 | `generalApprovals.map(async (approval) => getAssignmentsForEntity("approval", approval.id))` | HIGH — all pending approvals |
| 5 | `server/approvals-routes.ts` | 256 | `generalApprovals.map(async (approval) => getGeneralApprovalAssignments(approval.id))` | HIGH |
| 6 | `server/approvals-routes.ts` | 358 | `rows.map(async ({ approval }) => getGeneralApprovalAssignments(approval.id))` | HIGH |
| 7 | `server/bootstrap/backfills/assignee-user-ids-backfill.ts` | 36 | `for (row of rows) { await db.execute(UPDATE ... WHERE id = row.id) }` | MEDIUM — backfill only, batched at 200 |

**Root cause:** `getAssignmentsForEntity()` queries `entityAssignments` + calls `resolveAssignableTarget()` per assignment (which may query `users`/`counterparties`/`contacts`). Each loop iteration = 2–5 queries.

**Recommendation:** Add a batch variant `getAssignmentsForEntities(entityType, entityIds[])` that fetches all assignments in a single query using `WHERE entity_id IN (...)`, then groups results client-side.

---

## 2. Missing Indexes

**Status: PASS — no obvious gaps detected**

WHERE clause analysis of server code shows filtering primarily on:
- `id` (primary key — always indexed)
- `projectId` / `project_id` (foreign key — indexed via FK constraints and explicit indexes)
- `effectiveTo IS NULL` (covered by temporal composite indexes)
- `status` columns (frequently filtered but low cardinality — index benefit is marginal)
- `deletedAt IS NULL` (soft-delete pattern — partial index recommended but not critical)

No high-traffic queries were found filtering on unindexed columns.

---

## 3. Heavy JOIN Check

**Status: PASS — no single query exceeds 5 JOINs in hot paths**

Highest JOIN counts found:

| File | JOINs | Context |
|------|-------|---------|
| `server/repositories/imports-governance-repository.ts` | 5 LEFT JOINs | Governance dashboard — joins CTEs (pre-aggregated), acceptable |
| `server/deliverable-capture-routes.ts:228-233` | 4 LEFT JOINs | Deliverable list with linked entities |
| `server/lib/work-item-queries.ts:97-100` | 4 LEFT JOINs | Work items with extension tables (pm, engineering, scheduling) |
| `server/procurement-routes.ts:62-65` | 4 LEFT JOINs | Procurement items list |
| `server/services/promoted-read-compat.ts:628-630` | 3 LEFT JOINs + 2 CTE JOINs | V2 project summary — CTE-based, efficient |
| `server/gamification-routes.ts:604` | 3 LEFT JOINs | File upload history — inline chain |

The imports-governance query has 5 JOINs but they join pre-aggregated CTEs (single-row per project), so the query plan is efficient. **No optimization needed.**

---

## 4. Dashboard Metrics Refresh Cost

**Status: MEDIUM RISK — refreshAllMetrics() is an N+1 itself**

### refreshProjectMetrics() — per-project cost
Runs **5 queries** per project:
1. `SELECT * FROM project_info WHERE id = ?` (1 query)
2. `SELECT * FROM normalized_revenue_lines WHERE project_id = ? AND effective_to IS NULL` (1 query)
3. `SELECT * FROM normalized_cost_lines WHERE project_id = ? AND effective_to IS NULL` (1 query)
4. `SELECT * FROM work_items WHERE project_id = ? AND deleted_at IS NULL` (1 query)
5. `SELECT * FROM qc_warning WHERE project_id = ? AND status = 'open'` + `SELECT * FROM qc_checklist WHERE project_id = ?` (2 queries via Promise.all)
6. Conditional: `SELECT * FROM qc_item_instance WHERE checklist_id IN (...)` (1 query)
7. Upsert into `dashboard_project_metrics` (1 query)

**Total: 6–7 queries per project**

### refreshAllMetrics() — program-level cost
```typescript
for (const p of projects) {
  await refreshProjectMetrics(p.id);  // Sequential!
}
```
For N projects: **6N–7N queries run sequentially**. With 50 projects = ~350 queries.

### Trigger points:
| Trigger | File | Line | Frequency |
|---------|------|------|-----------|
| `refreshProjectMetricsAsync(id)` | `server/lifecycle-routes.ts` | 1432 | On lifecycle state change — LOW, acceptable |
| `refreshProjectMetricsAsync(projectId)` | `server/smart-import-routes.ts` | 2509 | After smart import — LOW, acceptable |
| `refreshProjectMetricsAsync(pid)` | `server/departments/finance-routes.ts` | 2807 | After finance update — LOW, acceptable |
| `refreshAllMetrics()` | `server/api/v2/services/project-v2-service.ts` | 193 | **On V2 API call — NEEDS REVIEW** |

**Key concern:** `refreshAllMetrics()` is called from `project-v2-service.ts`. If this is hit on page load of a dashboard, it triggers 350+ sequential queries.

**Recommendation:**
- Add a `lastRefreshedAt` check to skip recently-refreshed projects (e.g., < 5 min ago)
- Convert `refreshAllMetrics()` to use `Promise.all` with concurrency limit instead of sequential loop
- Consider a background job/cron instead of on-demand refresh

---

## 5. Temporal Query Performance

**Status: PASS — all temporal columns are indexed**

All 8 financial tables with `effective_from`/`effective_to` columns have composite indexes defined in migration `20260333_temporal_financial_columns.sql`:

| Table | Index Name |
|-------|-----------|
| `program_expense` | `idx_program_expense_temporal` |
| `program_inflows` | `idx_program_inflows_temporal` |
| `cashflow_points` | `idx_cashflow_points_temporal` |
| `finance_revenue_monthly` | `idx_finance_revenue_monthly_temporal` |
| `finance_cos_monthly` | `idx_finance_cos_monthly_temporal` |
| `project_revenue_summary` | `idx_project_revenue_summary_temporal` |
| `normalized_cost_lines` | `idx_normalized_cost_lines_temporal` |
| `normalized_revenue_lines` | `idx_normalized_revenue_lines_temporal` |

All indexes are composite: `(project_id, effective_from, effective_to)` — optimal for the temporal query pattern `WHERE project_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)`.

Data integrity constraint also enforced: `effective_to IS NULL OR effective_to >= effective_from` (migration `20260339_database_integrity_hardening.sql`).

---

## 6. Large Table Scan Detection

**Status: MEDIUM RISK — cannot query pg_stat_user_tables (no live DB), static analysis only**

Based on code patterns, the tables most likely to be large are:

| Table | Expected Size | Filter Patterns | Index Coverage |
|-------|--------------|-----------------|----------------|
| `work_items` | HIGH (all tasks) | `project_id`, `deleted_at IS NULL`, `status`, `owner_user_id` | `project_id` indexed; `deleted_at` partial index recommended |
| `normalized_cost_lines` | HIGH (financial lines) | `project_id`, `effective_to IS NULL` | Temporal composite index covers this |
| `normalized_revenue_lines` | HIGH (financial lines) | `project_id`, `effective_to IS NULL` | Temporal composite index covers this |
| `domain_events` | HIGH (audit log) | `entity_type`, `entity_id`, `created_at` | Has dedicated indexes |
| `entity_assignments` | MEDIUM | `entity_type`, `entity_id` | Needs verification — used in every N+1 pattern above |

**Recommendation:** Verify `entity_assignments` has an index on `(entity_type, entity_id)` — this is the most frequently queried table in the N+1 patterns.

---

## 7. React Query Configuration

**Status: MOSTLY GOOD — a few aggressive patterns flagged**

### Global defaults (`client/src/lib/queryClient.ts:140-163`)
```typescript
staleTime: 30_000      // 30s — reasonable
gcTime: 300_000        // 5min — reasonable
refetchOnWindowFocus: false  // Good — prevents tab-switch spam
refetchInterval: false       // Good — no polling by default
```

### Aggressive patterns (staleTime = 0 or gcTime = 0)

| File | Line | Setting | Risk |
|------|------|---------|------|
| `my-work-calendar.tsx` | 222-253 | `staleTime: 0, gcTime: 0` (3 queries) | MEDIUM — refetches on every render/mount |
| `qm-dashboard.tsx` | 251-265 | `staleTime: 0` (3 queries) | MEDIUM — dashboard queries always "stale" |
| `engineering-dashboard.tsx` | 1026, 1373 | `staleTime: 0` | MEDIUM — dashboard-level queries |
| `QualityTab.tsx` | 180-240 | `staleTime: 0` (5 queries) | HIGH — 5 queries per tab mount all with staleTime: 0 |
| `EngineeringTasksPage.tsx` | 3590 | `staleTime: 0` | LOW — single query |
| `projects.tsx` | 1397 | `staleTime: 0` | LOW — single query |
| `subcontractor-dashboard.tsx` | 493, 505 | `staleTime: 0` | MEDIUM — dashboard queries |
| `collab-email.tsx` | 72-73 | `staleTime: 0, gcTime: 0` | LOW — email integration |

### Polling intervals (refetchInterval)

| File | Line | Interval | Assessment |
|------|------|----------|------------|
| `admin-approvals.tsx` | 117 | 30s | OK |
| `invoice-patterns.tsx` | 356 | 30s | OK |
| `lifecycle-board.tsx` | 344 | 30s | OK |
| `leaderboard.tsx` | 595 | 60s | OK |
| `smart-import.tsx` | 3863, 3872 | 30s | OK |
| `SharePointIntakePage.tsx` | 116 | 30s | OK |
| `engineering-dashboard.tsx` | 1301 | 60s | OK |
| `my-tool-meetings.tsx` | 104, 125 | 30s, 60s | OK |
| `teams-chats.tsx` | 114 | 30s | OK |
| `subcontractor-dashboard.tsx` | 479 | 30s | OK |
| `project-lifecycle.tsx` | 952 | 60s | OK |

No aggressive refetching (< 10s intervals) detected. All polling intervals are 30s+.

**Recommendation:** Set `staleTime: 10_000` minimum on `QualityTab.tsx` queries (5 queries all at `staleTime: 0` means 5 fetches every time the tab is visited). Calendar and dashboard `staleTime: 0` patterns should be reviewed — consider 5–10s minimum.

---

## Summary

| Check | Status | Priority |
|-------|--------|----------|
| N+1 Query Detection | **7 instances found** | HIGH |
| Missing Indexes | Pass | — |
| Heavy JOIN Check | Pass (max 5, CTE-based) | — |
| Dashboard Metrics Refresh | **refreshAllMetrics() is sequential N+1** | HIGH |
| Temporal Column Indexes | Pass (all 8 tables indexed) | — |
| Large Table Scan Detection | **entity_assignments index unverified** | MEDIUM |
| React Query Configuration | **staleTime: 0 on 15+ queries** | MEDIUM |

### Top 3 Actionable Items
1. **Batch `getAssignmentsForEntity()`** — Create `getAssignmentsForEntities(type, ids[])` to eliminate N+1 in 6 route handlers
2. **Optimize `refreshAllMetrics()`** — Add skip-if-recent logic and parallelize with concurrency limit
3. **Set minimum staleTime on QualityTab** — 5 queries at `staleTime: 0` causes unnecessary refetching on every tab visit
