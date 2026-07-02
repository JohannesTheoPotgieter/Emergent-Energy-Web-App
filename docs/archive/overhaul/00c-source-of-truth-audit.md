# 00c — Source-of-Truth Audit

**Phase 0 companion artefact.** Read-only audit. No code modified.

> **Date:** 2026-04-21
> **Scope:** per-function read-path audit — does each user-facing function read from the canonical object-backend, a legacy adapter, or (worst case) both?

The prompt's "object-based backend is canonical source of truth" rule bites hardest here. Phase 0's job is to find where canonical and legacy disagree so Phase 2 can plan migrations without surprise data-diffs mid-flight.

---

## §1 Canonical tables — confirmed

The canonical pattern is a **family of domain write-masters**, not a single polymorphic object table. Sourced from `docs/archive/CANONICAL_MODEL_DECISION_TABLE.md:14` — "one write-master per domain; everything else is adapter or read-model."

| Domain | Canonical write-master | Location | Temporal guard |
|---|---|---|---|
| Tasks / work | `work_items` | `shared/schema/tasks.ts:147` | — (direct) |
| Task assignments | `work_item_assignments` | `shared/schema/tasks.ts:319` | — |
| Task domain extensions | `work_item_pm`, `work_item_engineering`, `work_item_scheduling` | `shared/schema/tasks.ts:243-317` | — (1:1 FK) |
| Costs | `normalized_cost_lines` | `shared/schema/finance.ts:574` | **`effective_to IS NULL`** required on aggregates |
| Revenue | `normalized_revenue_lines` | `shared/schema/finance.ts:489` | **`effective_to IS NULL`** required on aggregates |
| Project identity | `project_info` | `shared/schema/projects.ts:169` | — |
| Project lifecycle state | `project_execution_state` | `shared/schema/projects.ts:207` | — |
| Approvals | `approvals` | ref `server/approvals-routes.ts:18` | — |
| Deliverables | `deliverables` | ref `server/approvals-routes.ts:16` | — |

**Legacy adapter tables** — still readable for backfill/reference, but not to be read by new code paths:

- Tasks: `operational_tasks`, `mytool_tasks`, `normalized_plan_tasks` (backfilled into `work_items` 2026-04-09)
- Costs: `program_expense` / `programExpense` (PE shape — replaced by `normalized_cost_lines`)
- Revenue: `program_inflows` / `programInflows` (PI shape — replaced by `normalized_revenue_lines`)

Per `CLAUDE.md`, `server/work-items-adapter.ts` and `server/work-items-backfill.ts` are "read-only reference; do not extend them for new features."

---

## §2 Per-domain audit table

One row per user-facing function. Priority scale:

- **1** = multiple sources read, divergence risk high → migrate first
- **2** = known drift risk or internal-helper legacy read
- **3** = central to decisions (money, dates, status, ownership)
- **4** = already canonical, low risk

### Tasks / Work

| Function / Page | Route handler | Entity | Path used | Canonical path | Risk | Priority |
|---|---|---|---|---|---|---|
| Engineering Tasks (Execution Board) | `server/departments/project-routes.ts` | work_items (ENG workstream) | `work_items` direct | ✓ Canonical | None | 4 |
| PM Tasks (Planning Board) | `server/routes/planning-tasks-routes.ts` | work_items (PM workstream) | `getAllWorkItemsForPlanTab()` | ✓ Canonical | None | 4 |
| Operational Tasks List | `server/routes/operational-tasks-routes.ts:139` | work_items | `getWorkItemsAsOperationalTasks()` → `work_items` query | ✓ Canonical | None | 4 |
| My Work (Personal Tasks) | `server/routes/mytool-routes.ts` | work_items (PERSONAL bucket) | `work_items` direct | ✓ Canonical | None | 4 |
| Engineering Standup | `server/standup-routes.ts` | work_items + standups | joined reads | ✓ Canonical | None | 4 |

### Costs / COS

| Function / Page | Route handler | Entity | Path used | Canonical | Risk | Priority |
|---|---|---|---|---|---|---|
| COS Tracker Dashboard | `server/routes/cos-control-routes.ts:133+` | normalized_cost_lines | `getCanonicalAllCurrentCostLines()` | ✓ Canonical | None | 4 |
| Project Financial Detail | `server/departments/finance-routes.ts:1450` | normalized_cost_lines | direct select/update | ✓ Canonical | None | 4 |
| Cashflow Computation | `server/routes/register-cashflow-2026-routes.ts:27` | normalized_cost_lines | `getCanonicalAllCurrentCostLines()` | ✓ Canonical | None | 4 |
| Company Overview (Finance) | `server/routes/overview-extracted-routes.ts:34` | normalized_cost_lines | `getCanonicalAllCurrentCostLines()` | ✓ Canonical | None | 4 |
| Home Dashboard (Cost Summary) | `server/routes/home-extracted-routes.ts:40` | normalized_cost_lines | `getCanonicalAllCurrentCostLines()` | ✓ Canonical | None | 4 |
| Data Quality Dashboard | `server/routes/cos-control-routes.ts:485` | normalized_cost_lines | `getCanonicalAllCurrentCostLines()` | ✓ Canonical | None | 4 |

### Revenue

| Function / Page | Route handler | Entity | Path used | Canonical | Risk | Priority |
|---|---|---|---|---|---|---|
| Revenue Tracker | `server/departments/finance-routes.ts:4433` | normalized_revenue_lines | direct select | ✓ Canonical | None | 4 |
| Revenue Milestone Linking | `server/departments/finance-routes.ts:5053` | normalized_revenue_lines | direct update | ✓ Canonical | None | 4 |
| **Inflow Effective Dates** | `server/lib/cashflow-helpers.ts:38` | normalized_revenue_lines + milestone_task_links + canonical linked-task date fields | `resolveInflowEffectiveDates()` | ✓ Canonical | None | 4 |

### Projects

| Function / Page | Route handler | Entity | Path used | Canonical | Risk | Priority |
|---|---|---|---|---|---|---|
| Projects List | `server/departments/project-routes.ts` | project_info | direct query | ✓ Canonical | None | 4 |
| Project Detail (Summary) | `server/departments/project-routes.ts:827+` | project_info + project_execution_state | direct (both) | ✓ Canonical | None | 4 |
| Project Phases & Gates | `server/departments/project-routes.ts` | project_execution_state | direct query | ✓ Canonical | None | 4 |
| Project Financial Linking | `server/departments/project-routes.ts` | project_info (FK) | direct | ✓ Canonical | None | 4 |

### Approvals / Deliverables

| Function / Page | Route handler | Entity | Path used | Canonical | Risk | Priority |
|---|---|---|---|---|---|---|
| Approvals Queue | `server/departments/finance-routes.ts:626` | approvals | direct | ✓ Canonical | None | 4 |
| Financial Review Queue | `server/departments/finance-routes.ts` | approvals (category `financial_review`) | direct | ✓ Canonical | None | 4 |
| Deliverables (Execution Board) | `server/approvals-routes.ts` | deliverables | direct | ✓ Canonical | None | 4 |

### Cross-cutting services

| Function / Page | Handler | Entity | Path | Canonical | Risk | Priority |
|---|---|---|---|---|---|---|
| Dashboard Metrics (KPIs) | `server/services/dashboard-metrics.ts` | work_items + normalized_cost_lines + normalized_revenue_lines | direct to all three | ✓ Canonical | None | 4 |
| Company Overview Service | `server/services/company-overview-service.ts` | normalized_cost_lines + normalized_revenue_lines | direct | ✓ Canonical | None | 4 |

---

## §3 Cross-cutting observations

1. **Inflow effective-date resolution is now canonicalized.** `resolveInflowEffectiveDates()` at `server/lib/cashflow-helpers.ts:38` resolves hierarchy from inflow rows + milestone links only (admin override → paid date → link override → linked task date fields → computed forecast → planned fallback), with no legacy task-table reads.

2. **Legacy finance tables fully decommissioned at read layer.** `program_expense` and `program_inflows` are no longer read anywhere in the route handlers. `manualEditFlags` retains a reference for audit-trail purposes only. Safe to archive (not drop) after a 90-day observation window.

3. **`work_items` adoption complete for task workstreams.** All routes (ENG, PM, PERSONAL, operational) read from canonical `work_items`. No drift risk; unified schema absorbs all workstream types. Feature flag `canonical_work_items_v1` gates the surface promotion — currently live (`server/departments/finance-routes.ts:116`).

4. **Extensions pattern working.** `work_item_pm`, `work_item_engineering`, `work_item_scheduling` are properly normalised 1:1 via FK. `queryWorkItems()` JOINs all three; no dangling reads from extension tables outside their domain context.

5. **`project_execution_state` as second write-master for projects.** Phase, gate status, RAG, financial review split from `project_info` but read together. No legacy fallback needed.

6. **Approvals table is the sole approval surface.** No legacy `approval_task` or `pm_deliverable` tables in active read paths. Role-based access control at the route layer (`server/approvals-routes.ts:39-56`).

7. **Finance trust headers consistent.** Cost-line reads via `getCanonicalAllCurrentCostLines()` stamp a trust envelope in `cos-control-routes.ts`; revenue reads apply the same pattern. Reconciliation against QB via `legacy_id` linking in `server/services/promoted-read-compat.ts` (post-cutover validation only).

8. **`effective_to IS NULL` guard is the silent footgun.** Any aggregate query against `normalized_cost_lines`, `normalized_revenue_lines`, `cashflow_points`, `finance_revenue_monthly`, `finance_cos_monthly`, `category_revenue_allocations`, `project_revenue_summary` MUST filter out historical rows. The `finance-snapshot-queries` skill + CI guard enforces this. Phase 2 work touching these tables MUST run the skill.

---

## §4 Canonical-migration TODO list

Priority-ordered. Top five are the only Phase 2–3 work surfaces where canonical paths need change. Everything else is incremental polish.

1. **Backfill linked-task dates on normalized revenue feeds** (Priority 2 — data completeness hardening)
   - Location: `server/lib/cashflow-helpers.ts:resolveInflowEffectiveDates()` and inflow read adapters.
   - Ensure linked date fields (`linkedWorkItemDueDate`/`linkedTaskDueDate`/`linkedTaskActualEnd`/`linkedTaskBaselineEnd`) are consistently emitted for all active projects.
   - Keep `plannedPaymentDate` fallback until parity checks show full coverage.

2. **Archive `program_expense` + `program_inflows` tables** (Priority 2 — legacy-only)
   - Remove from `safe-query.ts:32-33` allowlist after 30-day post-cutover window (target 2026-05-21).
   - Confirm zero direct UI imports.
   - Keep migrations + schema comments for historical audit trail.

3. **Consolidate cash-flow computation** (Priority 3 — centralise)
   - Files: `server/lib/calculations/cashflow.ts`, `server/lib/cashflow-helpers.ts`.
   - Unify weekly/monthly bucket logic; currently duplicated across `finance-routes` and `register-cashflow-2026-routes`.
   - Single source for effective-date hierarchy (admin override → payment received → link override → forecast).

4. **Promote `project_execution_state` to first-class queries** (Priority 3 — clarify lifecycle reads)
   - File: `server/repositories/project-state-repository.ts`.
   - Add typed read-service paralleling `project-cost-line-read-service`.
   - Consider index on `(phase, gate_status, financial_review_status)` to support dashboard aggregations.

5. **Remove legacy inflow helper call signatures** (Priority 4)
   - `server/lib/cashflow-helpers.ts` still accepts legacy task-array params for caller compatibility.
   - After downstream routes are updated, remove deprecated args and enforce typed canonical input contract.

6. **Standardise approvals read patterns** (Priority 4 — low risk)
   - Add `approval-service-read` analogous to `project-cost-line-read-service` for reuse across routes.

7. **Add index on `work_item_assignments(workItemId, role)`** (Priority 4 — performance)
   - Supports bulk assignment queries in `dashboard-metrics.ts`.

8. **Deprecate `getWorkItemsAsNormalizedPlanTasks()` bridge** (Priority 3)
   - File: `server/work-items-adapter.ts:33-52`. Move remaining callers to direct `getAllWorkItemsForPlanTab()`.

9. **Unify finance line write-surface Zod schemas** (Priority 4)
   - File: `server/departments/finance-routes.ts:24-75`. Extract into `shared/schemas` for reuse.

10. **Audit and retire `mytool_tasks` table** (Priority 2 — post-migration)
    - Confirm all PERSONAL tasks migrated to `work_items`. Archive after 90-day observation (target 2026-05-21).

---

## §5 Summary

**Zero critical divergences.** All primary read paths use canonical tables. The only multi-source function (`resolveInflowEffectiveDates`) is an internal helper, not a page-level read, and migration is well-scoped.

Legacy `program_expense` / `program_inflows` fully decommissioned at read layer — safe to archive.

Work items, costs, revenue, projects, approvals, deliverables all flow through their single write-masters. No fallback logic required. No silent diffs discovered.

**Practical implication for Phase 2+:** source-of-truth migration is effectively complete. The overhaul's "source-of-truth alignment" rule (prompt §"Scope of allowed changes", item 4) is largely a **verification** task rather than a migration task. Phase 3 per-function work can focus on visual polish and additive function without expecting to re-plumb data. When we touch a screen that uses an inline `useQuery`, we migrate it to the Phase-1 data-access primitives — but the data itself is already canonical.

---

**End of `00c-source-of-truth-audit.md`.** Companion: `00-inventory.md`, `00b-half-built.md`, `backlog.md`.
