# QA Sweep 03 — API Endpoint Audit

**Date:** 2026-03-21
**Status:** PASS (with advisory notes)

---

## 1. Registered Routes — V2 vs Legacy

### V2 Endpoints (65 routes)

All registered in `server/api/v2/routes/v2-routes.ts`:

| # | Method | Path | Middleware | Handler |
|---|--------|------|-----------|---------|
| 1 | GET | `/api/v2/me` | requireAuth | `me` |
| 2 | GET | `/api/v2/me/permissions` | requireAuth | `mePermissions` |
| 3 | GET | `/api/v2/dashboard/:role` | authScoped | `dashboardByRole` |
| 4 | GET | `/api/v2/dashboard-metrics` | requireAuth | `dashboardMetrics` |
| 5 | POST | `/api/v2/dashboard-metrics/refresh` | requireAuth | `dashboardRefresh` |
| 6 | GET | `/api/v2/projects` | authScoped | `listProjects` |
| 7 | GET | `/api/v2/projects/:projectId` | authProject | `projectDetailConsolidated` |
| 8 | GET | `/api/v2/projects/:projectId/overview` | authProject | `projectOverview` |
| 9 | GET | `/api/v2/projects/:projectId/lifecycle` | authProject | `projectLifecycle` |
| 10 | GET | `/api/v2/projects/:projectId/health` | authProject | `projectHealth` |
| 11 | GET | `/api/v2/projects/:projectId/finance` | authProject | `projectFinanceDetail` |
| 12 | GET | `/api/v2/projects/:projectId/plan` | authProject | `projectPlanDetail` |
| 13 | GET | `/api/v2/projects/:projectId/quality` | authProject | `projectQualityDetail` |
| 14 | GET | `/api/v2/projects/:projectId/engineering` | authProject | `projectEngineeringDetail` |
| 15 | GET | `/api/v2/projects/:projectId/development` | authProject | `projectDevelopment` |
| 16 | POST | `/api/v2/projects/:projectId/development/handover` | authProject | `developmentHandover` |
| 17 | GET | `/api/v2/projects/:projectId/engineering/designs` | authProject | `engineeringDesigns` |
| 18 | POST | `/api/v2/projects/:projectId/engineering/designs` | authProject | `engineeringDesigns` |
| 19 | PATCH | `/api/v2/projects/:projectId/engineering/designs` | authProject | `engineeringDesigns` |
| 20 | GET | `/api/v2/projects/:projectId/quality/checks` | authProject | `qualityChecks` |
| 21 | POST | `/api/v2/projects/:projectId/quality/checks` | authProject | `qualityChecks` |
| 22 | PATCH | `/api/v2/projects/:projectId/quality/checks` | authProject | `qualityChecks` |
| 23 | GET | `/api/v2/projects/:projectId/work-items` | authProject | `projectWorkItems` |
| 24 | POST | `/api/v2/projects/:projectId/work-items` | authProject | `createWorkItem` |
| 25 | PATCH | `/api/v2/projects/:projectId/work-items/:id` | authProject | `patchWorkItem` |
| 26 | GET | `/api/v2/projects/:projectId/milestones` | authProject | `projectMilestones` |
| 27 | POST | `/api/v2/projects/:projectId/milestones` | authProject | `createMilestone` |
| 28 | PATCH | `/api/v2/projects/:projectId/milestones/:id` | authProject | `patchMilestone` |
| 29 | GET | `/api/v2/projects/:projectId/procurement` | authProject | `projectProcurement` |
| 30 | GET | `/api/v2/projects/:projectId/procurement/items` | authProject | `procurementItemsList` |
| 31 | POST | `/api/v2/projects/:projectId/procurement/items` | authProject | `createProcurementItem` |
| 32 | PATCH | `/api/v2/projects/:projectId/procurement/items/:id` | authProject | `patchProcurementItem` |
| 33 | GET | `/api/v2/projects/:projectId/procurement/pos` | authProject | `procurementPos` |
| 34 | POST | `/api/v2/projects/:projectId/procurement/pos` | authProject | `procurementPos` |
| 35 | PATCH | `/api/v2/projects/:projectId/procurement/pos/:id` | authProject | `procurementPos` |
| 36 | GET | `/api/v2/projects/:projectId/procurement/invoices` | authProject | `procurementInvoices` |
| 37 | POST | `/api/v2/projects/:projectId/procurement/invoices` | authProject | `procurementInvoices` |
| 38 | GET | `/api/v2/projects/:projectId/finance/summary` | authProject | `financeSummary` |
| 39 | GET | `/api/v2/projects/:projectId/finance/cashflow` | authProject | `financeCashflow` |
| 40 | GET | `/api/v2/projects/:projectId/finance/cos` | authProject | `financeCos` |
| 41 | GET | `/api/v2/projects/:projectId/finance/revenue` | authProject | `financeRevenue` |
| 42 | GET | `/api/v2/projects/:projectId/finance/expenditure` | authProject | `financeExpenditure` |
| 43 | GET | `/api/v2/projects/:projectId/finance/variations` | authProject | `financeVariations` |
| 44 | POST | `/api/v2/projects/:projectId/finance/variations` | authProject | `financeVariations` |
| 45 | PATCH | `/api/v2/projects/:projectId/finance/variations` | authProject | `financeVariations` |
| 46 | POST | `/api/v2/imports/:domain` | requireAuth | `importsByDomain` |
| 47 | GET | `/api/v2/lookups/:type` | requireAuth | `lookupsByType` |
| 48 | GET | `/api/v2/audit/activity` | requireAuth | `auditActivity` |

### Middleware stacks:
- **`authScoped`** = `[requireAuth, attachProjectScope]` — list/dashboard endpoints
- **`authProject`** = `[requireAuth, attachProjectScope, requireProjectAccess]` — per-project endpoints

### Legacy Endpoints (remaining `app.*` routes across 42+ files)

Major legacy route files and approximate counts:

| File | Route Count | Domain |
|------|------------|--------|
| `server/routes.ts` | ~250+ | Core: projects, expenses, revenues, tasks, finance, admin, mytool, outlook, etc. |
| `server/lifecycle-routes.ts` | 17 | Lifecycle board (RAG, phases, stage-gates, merges) |
| `server/pd-routes.ts` | 12 | PD clients, tickets, dashboard |
| `server/quality-routes.ts` | — | QC templates and checklists |
| `server/engineering-routes.ts` | — | Engineering stages/designs |
| `server/procurement-routes.ts` | — | Procurement items/POs/invoices |
| `server/task-management-routes.ts` | — | Task management |
| `server/meeting-routes.ts` | — | Meeting notes |
| `server/report-routes.ts` | — | Reports/exports |
| `server/audit-routes.ts` | — | Audit trail |
| + 30 more files | — | Various domains |

### Legacy Endpoints That Should Be Reviewed for Removal

The following legacy endpoints in `server/routes.ts` have direct V2 replacements and are candidates for deprecation:

| Legacy Route | V2 Replacement | Notes |
|-------------|---------------|-------|
| `GET /api/projects` (L5143) | `GET /api/v2/projects` | Direct replacement |
| `GET /api/projects/:id` (L5152) | `GET /api/v2/projects/:projectId` | Consolidated version |
| `GET /api/tasks` (L5170) | `GET /api/v2/projects/:projectId/work-items` | Per-project scoping in V2 |
| `GET /api/project-plans` (L5802) | `GET /api/v2/projects/:projectId/plan` | Consolidated in V2 |
| `GET /api/operational-tasks/*` (L11294–11631) | `GET /api/v2/projects/:projectId/work-items` | 7 routes, fully replaced |
| `GET /api/planning-tasks/*` (L11866–12904) | `GET /api/v2/projects/:projectId/work-items` | 6 routes, replaced by work-items |
| `GET /api/expenditure/overrides` (L7811) | N/A | Override tables deprecated |
| `GET /api/revenue-tracking/overrides` (L7367) | N/A | Override tables deprecated |

> **Advisory:** These legacy routes should NOT be removed immediately — they may still serve the legacy UI. However, they should be tracked for deprecation once the V2 frontend migration is complete.

---

## 2. Dropped Table References in V2 Handler Files

**Requirement:** 0 references to dropped tables per V2 file.

| File | Dropped Table Refs | Status |
|------|-------------------|--------|
| `server/api/v2/controllers/v2-controller.ts` | 0 | PASS |
| `server/api/v2/services/project-v2-service.ts` | 0 | PASS |
| `server/api/v2/repositories/project-v2-repository.ts` | 0 | PASS |
| `server/api/v2/middleware/permission-helper.ts` | 0 | PASS |
| `server/api/v2/utils/http.ts` | 0 | PASS |

**Tables checked:** `operational_tasks`, `engineering_tasks`, `expenditure_overrides`, `revenue_tracking_overrides`, `projects.`, `expenses.`, `revenues.`, `tasks.`, `budgets.`

**Result: PASS** — All V2 handler files are clean. Zero references to dropped/legacy tables.

### Legacy files with residual references (informational):

| Table | Files with References | Context |
|-------|----------------------|---------|
| `operational_tasks` | 14 files (backfills, migration, adapter fallback) | Migration/backfill code; graceful degradation noted |
| `engineering_tasks` | 3 files (backfill, lifecycle cleanup) | Migration pipeline |
| `expenditure_overrides` | 1 file (migration SQL) | Marked DEPRECATED, data migrated to `program_expense.import_snapshot` |
| `revenue_tracking_overrides` | 1 file (migration SQL) | Marked DEPRECATED, data migrated to `program_inflows.import_snapshot` |
| `projects/expenses/revenues/tasks/budgets` | 2 files (db.ts, storage.ts) | Comments confirming drop; empty stubs |

---

## 3. Consolidated Project Endpoint Verification

**Route:** `GET /api/v2/projects/:projectId`
**Handler:** `projectDetailConsolidated` (`v2-controller.ts:329`)
**Middleware:** `requireAuth → attachProjectScope → requireProjectAccess`

### Implementation:
```typescript
export const projectDetailConsolidated = asyncHandler(async (req, res) => {
  const { projectId } = validate(projectIdParamSchema, req.params, "Invalid projectId");
  const [data, permissions] = await Promise.all([
    service.getConsolidatedProjectService(projectId),
    computeProjectPermissions(req),
  ]);
  ok(res, { ...data, permissions });
});
```

### Tables Joined:

| Required Table | Joined? | Status |
|---------------|---------|--------|
| `project_info` | Yes | PASS |
| `project_execution_state` | Yes | PASS |
| `project_settings` | Yes | PASS |
| `dashboard_project_metrics` | Yes | PASS |

### Additional tables joined (bonus):
- `project_team_members` (with `users` join)
- `work_items` (plan summary)
- `qc_warning`, `qc_checklist`, `qc_item_instance` (quality summary)

### Permissions object:

**PASS** — `computeProjectPermissions(req)` returns a `ProjectPermissions` object with 6 parallel permission checks:
- `projects:view`, `projects:edit`, `projects:approve`, `projects:delete`, `admin:edit`, `financials:override`

The permissions object is spread into the response: `{ ...data, permissions }`.

---

## 4. Lazy Sub-Endpoint Table Verification

### GET /api/v2/projects/:projectId/finance
**Handler:** `projectFinanceDetail` (`v2-controller.ts:338`)

| Requirement | Actual | Status |
|------------|--------|--------|
| Reads from base tables with source/import_snapshot | `normalizedCostLines`, `normalizedRevenueLines` | PASS |
| NOT override tables | No refs to `expenditure_overrides` or `revenue_tracking_overrides` | PASS |
| Returns permissions | Yes, via `computeProjectPermissions(req)` | PASS |

### GET /api/v2/projects/:projectId/plan
**Handler:** `projectPlanDetail` (`v2-controller.ts:347`)

| Requirement | Actual | Status |
|------------|--------|--------|
| Reads from `work_items` | Yes, `repo.getProjectPlanWorkItems(projectId)` | PASS |
| NOT `operational_tasks` | No references | PASS |
| Supports workstream filter | Yes, via `req.query.workstream` | PASS |
| Returns permissions | Yes | PASS |

### GET /api/v2/projects/:projectId/engineering
**Handler:** `projectEngineeringDetail` (`v2-controller.ts:366`)

| Requirement | Actual | Status |
|------------|--------|--------|
| Reads from `work_items` | Yes, filtered by `workstream = 'ENG'` | PASS |
| Reads from engineering tables | `projectEngStages`, `projectEngDeliverables` | PASS |
| NOT `engineering_tasks` | No references | PASS |
| Returns permissions | Yes | PASS |

### GET /api/v2/projects/:projectId/quality
**Handler:** `projectQualityDetail` (`v2-controller.ts:357`)

| Requirement | Actual | Status |
|------------|--------|--------|
| Reads from QC tables | `qcChecklist`, `qcItemInstance`, `qcItemEvidence`, `qcWarning` | PASS |
| Tables unchanged from pre-migration | Yes | PASS |
| Returns permissions | Yes | PASS |

---

## 5. Middleware Chain Verification

### V2 Middleware Components:

| Middleware | Location | Purpose |
|-----------|----------|---------|
| `requireAuth` | `server/api/v2/utils/http.ts:38` | Checks `req.isAuthenticated()` + `req.user`; returns 401 |
| `attachProjectScope` | `server/middleware/project-scope-middleware.ts:38` | Resolves user's project scope via `resolveProjectScope()` |
| `requireProjectAccess` | `server/middleware/project-scope-middleware.ts:74` | Verifies user can access specific `req.params.projectId`; returns 403 |
| `computeProjectPermissions` | `server/api/v2/middleware/permission-helper.ts:18` | Evaluates 6 permission checks in parallel (called within handler) |

### Middleware applied per route category:

| Route Pattern | Auth | Scope | Project Access | Status |
|--------------|------|-------|---------------|--------|
| `/api/v2/me`, `/api/v2/me/permissions` | requireAuth | — | — | PASS |
| `/api/v2/dashboard/:role` | requireAuth | attachProjectScope | — | PASS |
| `/api/v2/dashboard-metrics`, `refresh` | requireAuth | — | — | PASS |
| `/api/v2/projects` (list) | requireAuth | attachProjectScope | — | PASS |
| `/api/v2/projects/:projectId/*` (all) | requireAuth | attachProjectScope | requireProjectAccess | PASS |
| `/api/v2/imports/:domain` | requireAuth | — | — | PASS |
| `/api/v2/lookups/:type` | requireAuth | — | — | PASS |
| `/api/v2/audit/activity` | requireAuth | — | — | PASS |

**Result: PASS** — All V2 routes have auth middleware. All project-scoped routes have the full `authProject` chain (`requireAuth + attachProjectScope + requireProjectAccess`).

---

## 6. Dead Route Handlers

### V2 Controller — Exported but NOT registered in v2-routes.ts:

| Handler | Defined At | Status | Notes |
|---------|-----------|--------|-------|
| `projectDetail` | `v2-controller.ts:61` | DEAD | Superseded by `projectDetailConsolidated` |
| `projectFinance` | `v2-controller.ts:261` | DEAD | Superseded by `projectFinanceDetail` |
| `projectEngineering` | `v2-controller.ts:97` | DEAD | Superseded by `projectEngineeringDetail` |
| `projectQuality` | `v2-controller.ts:122` | DEAD | Superseded by `projectQualityDetail` |

> **Note:** `projectOverview` (line 66) is an alias for `projectDetail` and IS registered at `/api/v2/projects/:projectId/overview`. This is fine — but `projectDetail` itself (the base function at line 61) is never directly used by a route.

### Recommendation:
Remove the 4 dead handlers (`projectDetail`, `projectFinance`, `projectEngineering`, `projectQuality`) from the controller once confirmed they have no external consumers (e.g., tests importing them directly).

---

## Summary

| Check | Result |
|-------|--------|
| 1. Route inventory (V2 vs legacy) | 48 V2 routes registered; ~250+ legacy routes across 42 files |
| 2. Dropped table refs in V2 handlers | **PASS** — 0 references in all 5 V2 files |
| 3. Consolidated project endpoint | **PASS** — joins project_info + execution_state + settings + metrics + permissions |
| 4. Sub-endpoint table correctness | **PASS** — finance uses normalized lines, plan uses work_items, engineering uses work_items+eng tables, quality uses qc tables |
| 5. Middleware chain | **PASS** — auth + scope + access on all project routes |
| 6. Dead handlers | **ADVISORY** — 4 dead handlers found (superseded by consolidated versions) |

### Action Items:
1. **Low priority:** Remove 4 dead handler exports from `v2-controller.ts` (projectDetail, projectFinance, projectEngineering, projectQuality)
2. **Track for deprecation:** Legacy `/api/operational-tasks/*`, `/api/planning-tasks/*`, `/api/expenditure/overrides`, `/api/revenue-tracking/overrides` routes once V2 frontend migration completes
3. **No blockers:** V2 API layer is clean and functional
