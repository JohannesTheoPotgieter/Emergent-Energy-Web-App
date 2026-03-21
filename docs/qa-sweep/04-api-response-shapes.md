# QA Sweep 04 — API Response Shape Validation

Generated: 2026-03-21

---

## 1. Zod Response Schemas Inventory

All Zod response schemas are located in a single file:
**`shared/api-types/project-v2.ts`** (163 lines)

### Schema → Endpoint Mapping

| Schema | Lines | Endpoint | Fields |
|--------|-------|----------|--------|
| `projectPermissionsSchema` | 12–19 | Embedded in all V2 responses | `canView`, `canEdit`, `canApprove`, `canDelete`, `canManageTeam`, `canOverrideFinance` |
| `financeSummarySchema` | 24–33 | Embedded in detail + finance | `totalRevenue`, `receivedRevenue`, `outstandingRevenue`, `totalCost`, `paidCost`, `outstandingCost`, `marginPct`, `contractValue` |
| `planSummarySchema` | 38–45 | Embedded in detail + plan | `taskCount`, `tasksCompleted`, `tasksInProgress`, `tasksOverdue`, `tasksActive`, `completionPct` |
| `qualitySummarySchema` | 50–53 | Embedded in detail + quality | `checklistProgress`, `openWarnings` |
| `teamMemberSchema` | 58–63 | Embedded in detail response | `id`, `userId`, `userName`, `roleOnProject` |
| `projectDetailResponseSchema` | 68–101 | `GET /api/v2/projects/:projectId` | `project`, `executionState`, `settings`, `financeSummary`, `planSummary`, `qualitySummary`, `team`, `permissions` |
| `financeLineSchema` | 106–112 | Embedded in finance response | `id`, `status`, `amountExVat`, `invoiceDate`, `paidDate` |
| `projectFinanceResponseSchema` | 114–119 | `GET /api/v2/projects/:projectId/finance` | `costLines`, `revenueLines`, `cashflow`, `permissions` |
| `workItemSchema` | 124–134 | Embedded in plan + engineering | `id`, `title`, `status`, `workstream`, `priority`, `ownerUserId`, `startDate`, `endDate`, `isMilestone` |
| `projectPlanResponseSchema` | 136–140 | `GET /api/v2/projects/:projectId/plan` | `workItems`, `summary`, `permissions` |
| `projectQualityResponseSchema` | 145–151 | `GET /api/v2/projects/:projectId/quality` | `checklists`, `items`, `evidence`, `summary`, `permissions` |
| `projectEngineeringResponseSchema` | 156–162 | `GET /api/v2/projects/:projectId/engineering` | `stages`, `workItems`, `deliverables`, `permissions` |

**Totals:** 12 schemas, 5 primary response schemas, 7 supporting/nested schemas.

---

## 2. V2 Endpoint Trace: Route → Service → DB → Response

All V2 routes are registered in `server/api/v2/routes/v2-routes.ts`.
Controllers live in `server/api/v2/controllers/v2-controller.ts`.
Service layer in `server/api/v2/services/project-v2-service.ts`.
Repository (DB) in `server/api/v2/repositories/project-v2-repository.ts`.

All responses are wrapped via `ok(res, data)` → `{ success: true, data, meta, error: null }`.

### Consolidated Endpoints (with Zod schemas)

#### `GET /api/v2/projects/:projectId` → `projectDetailConsolidated`
- **Controller** (v2-controller.ts:329–336): Validates `projectId`, calls `getConsolidatedProjectService` + `computeProjectPermissions` in parallel, returns `{ ...data, permissions }`.
- **Service** (project-v2-service.ts:205–261): Orchestrates 7 repo calls — `getProjectById`, `getProjectExecutionState`, `getProjectSettings`, `getProjectTeam`, `getProjectMetricsFromMaterialized`, `getProjectPlanSummary`, `getProjectQualitySummary`.
- **DB**: Queries `projectInfo`, `projectExecutionState`, `projectSettings`, `projectTeamMembers JOIN users`, `dashboardProjectMetrics`, `workItems`, `qcWarning/qcChecklist/qcItemInstance`.
- **Match with schema**: PASS — response shape matches `projectDetailResponseSchema`.

#### `GET /api/v2/projects/:projectId/finance` → `projectFinanceDetail`
- **Controller** (v2-controller.ts:338–345): Same pattern — `getProjectFinanceDetailService` + permissions.
- **Service** (project-v2-service.ts:263–274): Calls `getFinanceCostLines`, `getFinanceRevenueLines`, `getFinanceCashflow`.
- **DB**: Queries `normalizedCostLines`, `normalizedRevenueLines`, aggregate GROUP BY on cost lines.
- **Match with schema**: PASS — response shape matches `projectFinanceResponseSchema`.

#### `GET /api/v2/projects/:projectId/plan` → `projectPlanDetail`
- **Controller** (v2-controller.ts:347–355): Accepts optional `workstream` query param.
- **Service** (project-v2-service.ts:276–286): Calls `getProjectPlanWorkItems` + `getProjectPlanSummary`.
- **DB**: Queries `workItems` with optional workstream filter.
- **Match with schema**: PASS — response shape matches `projectPlanResponseSchema`.

#### `GET /api/v2/projects/:projectId/quality` → `projectQualityDetail`
- **Controller** (v2-controller.ts:357–364): Standard pattern.
- **Service** (project-v2-service.ts:288–298): Queries checklists, items, evidence, summary.
- **DB**: Queries `qcChecklist`, `qcItemInstance`, `qcItemEvidence`.
- **Match with schema**: PARTIAL — `checklists`, `items`, `evidence` use `z.any()` (no strict typing).

#### `GET /api/v2/projects/:projectId/engineering` → `projectEngineeringDetail`
- **Controller** (v2-controller.ts:366–373): Standard pattern.
- **Service** (project-v2-service.ts:300–305): Queries stages, work items, deliverables.
- **DB**: Queries `projectEngStages`, `workItems`, `projectEngDeliverables`.
- **Match with schema**: PARTIAL — `stages`, `deliverables` use `z.any()` (no strict typing).

### Non-Consolidated V2 Endpoints (no Zod response schema)

These V2 endpoints exist but have **no corresponding Zod response schema**:

| Endpoint | Controller | Returns |
|----------|-----------|---------|
| `GET /api/v2/me` | `me` | `{ id, email, name, role }` |
| `GET /api/v2/me/permissions` | `mePermissions` | `{ role, permissions[] }` |
| `GET /api/v2/dashboard/:role` | `dashboardByRole` | Role-specific metrics object |
| `GET /api/v2/dashboard-metrics` | `dashboardMetrics` | `{ program, projects[], lastRefreshedAt }` |
| `POST /api/v2/dashboard-metrics/refresh` | `dashboardRefresh` | `{ refreshed, timestamp }` |
| `GET /api/v2/projects` | `listProjects` | `{ rows[], meta }` |
| `GET /api/v2/projects/:id/overview` | `projectOverview` | `{ project, counts, finance }` |
| `GET /api/v2/projects/:id/lifecycle` | `projectLifecycle` | Phase history array |
| `GET /api/v2/projects/:id/health` | `projectHealth` | `{ ragStatus, escalationLevel, margin }` |
| `GET /api/v2/projects/:id/development` | `projectDevelopment` | Dev state object |
| `POST /api/v2/projects/:id/development/handover` | `developmentHandover` | `{ projectId, transitionedTo }` |
| `GET /api/v2/projects/:id/finance/summary` | `financeSummary` | Finance summary object |
| `GET /api/v2/projects/:id/finance/cashflow` | `financeCashflow` | `{ byStatus[] }` |
| `GET /api/v2/projects/:id/finance/cos` | `financeCos` | `{ lines[] }` |
| `GET /api/v2/projects/:id/finance/revenue` | `financeRevenue` | `{ lines[] }` |
| `GET /api/v2/projects/:id/finance/expenditure` | `financeExpenditure` | `{ committed[], planned[] }` |
| `GET/POST/PATCH /api/v2/projects/:id/finance/variations` | `financeVariations` | Work item arrays |
| `GET/POST/PATCH /api/v2/projects/:id/work-items` | `projectWorkItems` | Work item arrays |
| `GET/POST/PATCH /api/v2/projects/:id/milestones` | `projectMilestones` | Work item arrays |
| `GET/POST/PATCH /api/v2/projects/:id/procurement/*` | Various | Procurement objects |
| `GET/POST/PATCH /api/v2/projects/:id/quality/checks` | `qualityChecks` | QC check objects |
| `GET/POST/PATCH /api/v2/projects/:id/engineering/designs` | `engineeringDesigns` | Design objects |
| `GET /api/v2/lookups/:type` | `lookupsByType` | Lookup arrays |
| `POST /api/v2/imports/:domain` | `importsByDomain` | Import run arrays |
| `GET /api/v2/audit/activity` | `auditActivity` | Audit event array |

**FLAG**: 25+ V2 endpoints have no Zod response schema — only the 5 consolidated endpoints are typed.

---

## 3. Raw DB Row Leakage

### V2 API: NO LEAKAGE FOUND

All V2 endpoints follow a clean architecture:
```
Route → Controller (validates input) → Service (shapes response) → Repository (DB query)
```
The `ok(res, data)` helper in `server/api/v2/utils/http.ts` wraps all responses in the standard envelope.

### Legacy API (`server/routes.ts`): LEAKAGE PRESENT

The legacy routes file contains **329 `res.json()` calls**. Multiple cases return raw storage/DB results:

| Line | Route | Pattern | Risk |
|------|-------|---------|------|
| 5146 | `GET /api/projects` | `res.json(projects)` where `projects = await storage.getAllProjects()` | Raw DB rows returned directly |
| 5162 | `GET /api/projects/:id` | `res.json(project)` where `project = await storage.getProject(id)` | Raw DB row returned directly |
| 5175 | `GET /api/tasks?projectId=X` | `res.json(tasks)` where `tasks = await storage.getTasksByProject(...)` | Raw DB rows returned directly |
| 5183 | `GET /api/tasks` (full access) | `res.json(tasks)` where `tasks = await storage.getAllTasks()` | Raw DB rows returned directly |
| 15206 | `GET /api/.../tasks` | `res.json(tasks)` | Raw result, no service layer |
| 15001 | Various | `res.json(items)` | Raw result, no service layer |

**FLAG**: Legacy routes bypass service layer and return raw storage objects. No response shaping, no field filtering, potential for leaking internal DB columns.

---

## 4. Permissions in V2 Responses

### Permission Schema

Defined in `shared/api-types/project-v2.ts:12–19`:
```typescript
projectPermissionsSchema = z.object({
  canView: z.boolean(),
  canEdit: z.boolean(),
  canApprove: z.boolean(),
  canDelete: z.boolean(),
  canManageTeam: z.boolean(),
  canOverrideFinance: z.boolean(),
});
```

### Permission Computation

`server/api/v2/middleware/permission-helper.ts` — `computeProjectPermissions(req)`:
- Evaluates 6 permission checks in parallel via `evaluatePermissionForRequest`
- Maps: `projects.view` → `canView`, `projects.edit` → `canEdit`, `projects.approve` → `canApprove`, `projects.delete` → `canDelete`, `admin.edit` → `canManageTeam`, `financials.override` → `canOverrideFinance`

### Endpoints with `permissions` Object

| Endpoint | Controller Line | Includes `permissions` |
|----------|-----------------|----------------------|
| `GET /api/v2/projects/:projectId` | 329–336 | YES |
| `GET /api/v2/projects/:projectId/finance` | 338–345 | YES |
| `GET /api/v2/projects/:projectId/plan` | 347–355 | YES |
| `GET /api/v2/projects/:projectId/quality` | 357–364 | YES |
| `GET /api/v2/projects/:projectId/engineering` | 366–373 | YES |

### Endpoints WITHOUT `permissions` Object

All other V2 endpoints (25+) do **not** include a `permissions` object in their response. This includes:
- `GET /api/v2/me`, `GET /api/v2/me/permissions` (returns role-level perms, not project-level)
- `GET /api/v2/projects` (list)
- `GET /api/v2/projects/:id/overview`, `/lifecycle`, `/health`, `/development`
- All sub-resource CRUD endpoints (`work-items`, `milestones`, `procurement/*`, `quality/checks`, `engineering/designs`)
- `GET /api/v2/finance/*` sub-endpoints (summary, cashflow, cos, revenue, expenditure, variations)
- `GET /api/v2/lookups/:type`, `GET /api/v2/audit/activity`

**FLAG**: Only the 5 consolidated endpoints embed permissions. Sub-resource CRUD endpoints rely on middleware-level permission checks (`requirePermission`) but do not surface permission flags in responses for frontend UI gating.

---

## 5. Frontend Type Imports vs Shared Exports

### What `shared/api-types/project-v2.ts` Exports (22 items)

**Zod Schemas (12):**
`projectPermissionsSchema`, `financeSummarySchema`, `planSummarySchema`, `qualitySummarySchema`, `teamMemberSchema`, `projectDetailResponseSchema`, `financeLineSchema`, `projectFinanceResponseSchema`, `workItemSchema`, `projectPlanResponseSchema`, `projectQualityResponseSchema`, `projectEngineeringResponseSchema`

**TypeScript Types (10):**
`ProjectPermissions`, `FinanceSummaryV2`, `PlanSummary`, `QualitySummary`, `TeamMember`, `ProjectDetailResponse`, `ProjectFinanceResponse`, `ProjectPlanResponse`, `ProjectQualityResponse`, `ProjectEngineeringResponse`

### What the Frontend Actually Imports

| File | Imports |
|------|---------|
| `client/src/hooks/use-project-v2.ts:10–16` | `ProjectDetailResponse`, `ProjectFinanceResponse`, `ProjectPlanResponse`, `ProjectQualityResponse`, `ProjectEngineeringResponse` |
| `client/src/hooks/use-permissions.ts:12` | `ProjectPermissions` |
| `client/src/pages/project-detail.tsx:55` | `ProjectPermissions` |
| `client/src/components/PermissionGate.tsx:4` | `ProjectPermissions` |

### Coverage Analysis

| Export | Imported by Frontend | Used |
|--------|---------------------|------|
| `ProjectPermissions` | 3 files | YES |
| `ProjectDetailResponse` | 1 file | YES |
| `ProjectFinanceResponse` | 1 file | YES |
| `ProjectPlanResponse` | 1 file | YES |
| `ProjectQualityResponse` | 1 file | YES |
| `ProjectEngineeringResponse` | 1 file | YES |
| `FinanceSummaryV2` | — | NO |
| `PlanSummary` | — | NO |
| `QualitySummary` | — | NO |
| `TeamMember` | — | NO |
| All 12 Zod schemas | — | NO (frontend uses types only, not runtime validation) |

**FLAG**: 4 exported TypeScript types (`FinanceSummaryV2`, `PlanSummary`, `QualitySummary`, `TeamMember`) are not imported by any frontend code. No Zod schemas are used client-side for runtime validation.

### Server-Side Imports

Only 1 server file imports from shared types:
- `server/api/v2/middleware/permission-helper.ts:10` → `ProjectPermissions`

**FLAG**: No V2 controller or service imports the Zod schemas for runtime response validation. Schemas are defined but not used to `.parse()` or `.safeParse()` outgoing responses.

---

## Summary of Findings

| # | Check | Status | Details |
|---|-------|--------|---------|
| 1 | Zod schemas exist | PASS | 12 schemas in `shared/api-types/project-v2.ts` |
| 2 | V2 responses match schemas | PARTIAL | 5 consolidated endpoints match; `z.any()` used for quality/engineering sub-arrays |
| 3 | No raw DB row leakage | FAIL (legacy) | Legacy `server/routes.ts` returns raw `storage.*` results in 6+ endpoints |
| 4 | All V2 responses include permissions | PARTIAL | Only 5 consolidated endpoints; 25+ other V2 endpoints omit permissions |
| 5 | Frontend imports match exports | PARTIAL | 6 of 10 types imported; 4 types + all 12 schemas unused |

### Flags Requiring Action

1. **`z.any()` in quality/engineering schemas** — `checklists`, `items`, `evidence`, `stages`, `deliverables` arrays have no type safety. Define proper Zod schemas for these.

2. **No runtime response validation** — Zod schemas are defined but never used to validate outgoing responses. Consider adding `.parse()` in controllers or a response validation middleware.

3. **Legacy route raw DB leakage** — `GET /api/projects`, `GET /api/projects/:id`, `GET /api/tasks` return raw storage results. Add service-layer shaping or migrate to V2.

4. **Missing permissions on sub-resource endpoints** — CRUD endpoints for work-items, milestones, procurement, quality checks, and engineering designs do not include a permissions object. Frontend must make separate calls to get permission state.

5. **25+ V2 endpoints lack Zod response schemas** — Only the 5 consolidated endpoints have typed responses. Remaining endpoints return untyped shapes.

6. **Unused shared type exports** — `FinanceSummaryV2`, `PlanSummary`, `QualitySummary`, `TeamMember` are exported but not consumed by any frontend or server code (beyond the parent schema composition).
