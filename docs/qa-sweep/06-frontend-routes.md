# QA Sweep 06 — Frontend Route & Page Audit

**Date**: 2026-03-21
**Status**: PASS (with observations)

---

## 1. Registered Routes

All routes are centrally defined in `client/src/config/page-registry.ts` (102 entries).
Routes are built dynamically in `client/src/App.tsx` via `ROUTE_COMPONENTS` map.

### Route → Component Mapping

| Route | Component Key | File |
|-------|--------------|------|
| `/project-lifecycle` | `ProjectLifecyclePage` | `pages/project-lifecycle.tsx` |
| `/project-lifecycle/stage-gates` | `ProjectLifecyclePage` | `pages/project-lifecycle.tsx` |
| `/project-lifecycle/latest-updates` | `ProjectLifecyclePage` | `pages/project-lifecycle.tsx` |
| `/project-lifecycle/client-overview` | `ProjectLifecyclePage` | `pages/project-lifecycle.tsx` |
| `/projects` | `ProjectsSummary` | `pages/projects.tsx` |
| `/project/:projectName/financial-linking` | `FinancialLinkingPage` | `pages/financial-linking.tsx` |
| `/project/:projectName` | `ProjectDetailPage` | `pages/project-detail.tsx` |
| `/cashflow` | `CashflowPage` | `pages/cashflow.tsx` |
| `/cos` | `CostTracker` | `pages/cos.tsx` |
| `/revenue-tracker` | `RevenueTrackerPage` | `pages/revenue-tracker.tsx` |
| `/gp-tracker` | `GpTrackerPage` | `pages/gp-tracker.tsx` |
| `/company-priorities` | `MyToolPrioritiesPage` | `pages/my-tool-priorities.tsx` |
| `/admin/my-tool-settings` | `MyToolAdminSettingsPage` | `pages/my-tool-admin-settings.tsx` |
| `/admin/sharepoint-intake` | `SharePointIntakePage` | `pages/SharePointIntakePage.tsx` |
| `/quality` | `QmDashboardPage` | `pages/qm-dashboard.tsx` |
| `/engineering` | `EngineeringDashboardPage` | `pages/engineering-dashboard.tsx` |
| `/engineering/tasks` | `EngineeringTasksPage` | `pages/engineering-tasks.tsx` |
| `/engineering/audit` | `EngineeringAuditPage` | `pages/engineering-audit.tsx` |
| `/lifecycle-board` | `LifecycleBoardPage` | `pages/lifecycle-board.tsx` |
| `/execution-board` | `ExecutionBoardPage` | `pages/execution-board.tsx` |
| `/execution-board/program` | `ExecutionBoardPage` | `pages/execution-board.tsx` |
| `/execution-board/construction` | `ExecutionBoardPage` | `pages/execution-board.tsx` |
| `/execution-board/finance` | `ExecutionBoardPage` | `pages/execution-board.tsx` |
| `/admin/smart-import` | `SmartImportPage` | `pages/smart-import.tsx` |
| `/invoice-patterns` | `InvoicePatternsPage` | `pages/invoice-patterns.tsx` |
| `/counterparties` | `CounterpartiesPage` | `pages/counterparties.tsx` |
| `/subcontractor-dashboard` | `SubcontractorDashboardPage` | `pages/subcontractor-dashboard.tsx` |
| `/admin/activity-log` | `SystemActivityLogPage` | `pages/system-activity-log.tsx` |
| `/weekly-reviews` | `WeeklyReviewsPage` | `pages/weekly-reviews.tsx` |
| `/admin/roles` | `AdminRolesPage` | `pages/admin-roles.tsx` |
| `/leaderboard` | `LeaderboardPage` | `pages/leaderboard.tsx` |
| `/feedback` | `FeedbackPage` | `pages/feedback.tsx` |
| `/ee-info` | `EeInfoPage` | `pages/ee-info.tsx` |
| `/training` | `TrainingPage` | `pages/training.tsx` |
| `/portfolios` | `PortfoliosPage` | `pages/portfolios.tsx` |
| `/portfolios/:id` | `PortfolioDetailPage` | `pages/portfolio-detail.tsx` |
| `/pd` | `PdDashboardPage` | `pages/pd-dashboard.tsx` |
| `/pd/tickets` | `PdTicketsPage` | `pages/pd-tickets.tsx` |
| `/pd/tickets/create` | `PdTicketCreatePage` | `pages/pd-ticket-create.tsx` |
| `/pd/tickets/:id` | `PdTicketDetailPage` | `pages/pd-ticket-detail.tsx` |
| `/teams/chats` | `TeamsChatsPage` | `pages/teams-chats.tsx` |
| `/collaboration` | `CollaborationPage` | `pages/collaboration.tsx` |
| `/collaboration/email` | `CollabEmailPage` | `pages/collab-email.tsx` |
| `/collaboration/teams` | `CollabTeamsPage` | `pages/collab-teams.tsx` |
| `/pm/on-the-go` | `PMOnTheGoHome` | `pages/pm-on-the-go-home.tsx` |
| `/pm/on-the-go/project/:projectId` | `PMOnTheGoProject` | `pages/pm-on-the-go-project.tsx` |
| `/my-work` | `MyWorkHomePage` | `pages/my-work-home.tsx` |
| `/my-work/calendar` | `MyWorkCalendarPage` | `pages/my-work-calendar.tsx` |
| `/my-work/tasks` | `MyWorkTasksPage` | `pages/my-work-tasks.tsx` |
| `/my-work/meetings` | `MyToolMeetingsPage` | `pages/my-tool-meetings.tsx` |
| `/my-work/email` | `CollabEmailPage` | `pages/collab-email.tsx` |
| `/my-work/teams` | `TeamsChatsPage` | `pages/teams-chats.tsx` |
| `/admin/database-migration` | `DatabaseMigrationPage` | `pages/database-migration.tsx` |
| `/admin/kpi-traceability` | `KpiTraceabilityPage` | `pages/kpi-traceability.tsx` |
| `/admin/import-control-tower` | `ImportControlTowerPage` | `pages/import-control-tower.tsx` |
| `/reports/programme` | `ProgrammeReportsPage` | `pages/programme-reports.tsx` |
| `/admin/recovery` | `AdminRecoveryPage` | `pages/admin-recovery.tsx` |
| `/admin/control-center` | `AdminControlCenterPage` | `pages/admin-control-center.tsx` |
| `/clients` | `ClientsPage` | `pages/clients.tsx` |
| `/actions/launchpad` | `ActionLaunchpadPage` | `pages/action-launchpad.tsx` |
| `/pd/handover/:projectId` | `PdPmHandoverPage` | `pages/pd-pm-handover.tsx` |
| `/pm/handover-review` | `PmHandoverReviewPage` | `pages/pm-handover-review.tsx` |
| `/pm/approvals` | `ApprovalsPage` | `pages/admin-approvals.tsx` |
| `/pm/deliverables` | `PMDeliverablesPage` | `pages/pm-deliverables.tsx` |
| `/handover-control` | `HandoverControlPage` | `pages/handover-control.tsx` |
| `/tasks` | `TaskManagementPage` | `pages/task-management.tsx` |
| `/standups` | `StandupsPage` | `pages/standups.tsx` |
| `/fye-revenue-tracking` | `FyeRevenueTrackingPage` | `pages/fye-revenue-tracking.tsx` |

### Redirect-Only Routes (no component)

| Route | Redirects To |
|-------|-------------|
| `/dashboard` | `/execution-board` |
| `/revenue` | `/revenue-tracker` |
| `/my-tool` | `/my-work` |
| `/my-tool/week` | `/my-work/calendar` |
| `/my-tool/backlog` | `/my-work/tasks` |
| `/my-tool/settings` | `/my-work` |
| `/my-tool/help` | `/my-work` |
| `/my-tool/meetings` | `/my-work/meetings` |
| `/admin` | `/admin/control-center` |
| `/admin/legacy-utilities` | `/admin/control-center` |
| `/pm-dashboard` | `/execution-board` |
| `/my-work/approvals` | `/my-work/tasks?source=approvals` |

### Special Routes (defined directly in App.tsx)

| Route | Component |
|-------|-----------|
| `/` | `HomeRedirect` (role-based redirect) |
| `/auth/login` | `LoginPage` |
| `/auth/ms-callback` | `MsCallbackPage` |

---

## 2. Page Component Verification

### 2a. File Existence — PASS

All 67 `routeComponentKey` values in `PAGE_REGISTRY` resolve to valid entries in the `ROUTE_COMPONENTS` map in `App.tsx`. All imported page files exist on disk.

### 2b. Broken Imports — PASS

No broken imports detected. All page files import from valid modules:
- `@/components/*` — UI components
- `@/hooks/*` — custom hooks
- `@/lib/*` — utilities
- `@shared/*` — shared types/schemas

### 2c. useQuery Calls — V2 Endpoint Usage

The codebase uses **domain-scoped endpoints** (e.g., `/api/eng/`, `/api/pd/`, `/api/pm/`) rather than a blanket `/api/v2/` prefix for most routes.

V2 endpoints exist only for the **project detail domain** in `client/src/hooks/use-project-v2.ts`:

| Hook | Endpoint |
|------|----------|
| `useProjectDetail` | `GET /api/v2/projects/:id` |
| `useProjectFinance` | `GET /api/v2/projects/:id/finance` |
| `useProjectPlan` | `GET /api/v2/projects/:id/plan` |
| `useProjectQuality` | `GET /api/v2/projects/:id/quality` |
| `useProjectEngineering` | `GET /api/v2/projects/:id/engineering` |

All other pages use domain-prefixed endpoints (current, not legacy).

### 2d. useMutation Calls — PASS

All mutations target current domain-scoped endpoints. No legacy endpoint patterns found.

---

## 3. Orphaned Page Files

Cross-referencing `client/src/pages/` files against `ROUTE_COMPONENTS` and direct imports in `App.tsx`:

| File | Status | Notes |
|------|--------|-------|
| `pages/dashboard.tsx` | **Imported but not in ROUTE_COMPONENTS** | Imported as `Dashboard` in App.tsx line 11; present in ROUTE_COMPONENTS as `Dashboard` |
| `pages/home.tsx` | Used directly | Imported for `HomeRedirect` logic |
| `pages/login.tsx` | Used directly | Auth route |
| `pages/ms-callback.tsx` | Used directly | Auth callback route |
| `pages/not-found.tsx` | Used directly | 404 fallback |
| `pages/exceptions.tsx` | In ROUTE_COMPONENTS | Registered as `ExceptionsPage` but no matching PAGE_REGISTRY entry with that key — accessed programmatically |
| `pages/pm-dashboard.tsx` | In ROUTE_COMPONENTS | Registered as `PMDashboard`; note: `/pm-dashboard` route redirects — component may be unused |
| `pages/role-settings.tsx` | In ROUTE_COMPONENTS | Registered as `RoleSettingsPage` but no PAGE_REGISTRY entry references it |
| `pages/admin-roles.utils.ts` | Utility file | Helper for `admin-roles.tsx`, not a page |
| `pages/my-work-tasks-logic.ts` | Utility file | Logic helper for `my-work-tasks.tsx`, not a page |
| `pages/department-scores.tsx` | **ORPHANED** | No route, no import in App.tsx |
| `pages/eng-template-admin.tsx` | **ORPHANED** | No route, no import in App.tsx |
| `pages/phase-templates.tsx` | **ORPHANED** | No route, no import in App.tsx |
| `pages/project-create.tsx` | **ORPHANED** | No route, no import in App.tsx |
| `pages/EngineeringTasksPage.tsx` | **Duplicate name** | Imported as `EngineeringTasksPage` — this IS routed (PascalCase filename) |

### Confirmed Orphaned Pages (no route points to them)

1. **`pages/department-scores.tsx`** — No route or import
2. **`pages/eng-template-admin.tsx`** — No route or import
3. **`pages/phase-templates.tsx`** — No route or import
4. **`pages/project-create.tsx`** — No route or import

### Potentially Dead Components

5. **`pages/role-settings.tsx`** — In ROUTE_COMPONENTS but no PAGE_REGISTRY entry maps to `RoleSettingsPage`
6. **`pages/pm-dashboard.tsx`** — Route `/pm-dashboard` redirects to `/execution-board`; component may never render

---

## 4. Project Detail Page (`/project/:projectName`)

**File**: `client/src/pages/project-detail.tsx`

### 4a. Primary V2 Call — PASS

```typescript
const { data: v2Detail } = useProjectDetail(projectInfoId);
// → GET /api/v2/projects/:id
```

The page makes one primary consolidated call via `useProjectDetail()`.

### 4b. Tab Lazy-Loading — PASS

Each tab domain lazy-loads from V2 endpoints, gated by `activeSection`:

```typescript
const { data: v2Finance } = useProjectFinance(projectInfoId, activeSection === "commercial");
// → GET /api/v2/projects/:id/finance

const { data: v2Plan } = useProjectPlan(projectInfoId, activeSection === "delivery");
// → GET /api/v2/projects/:id/plan

const { data: v2Quality } = useProjectQuality(projectInfoId, activeSection === "quality");
// → GET /api/v2/projects/:id/quality

const { data: v2Engineering } = useProjectEngineering(projectInfoId, activeSection === "engineering");
// → GET /api/v2/projects/:id/engineering
```

### 4c. Legacy Endpoint Calls — OBSERVATION

The project detail page **also** makes parallel legacy calls alongside V2 hooks:

| Legacy Endpoint | Purpose |
|----------------|---------|
| `/api/projects/:id/phase` | PATCH — update phase |
| `/api/projects/:id/phase-history` | GET — phase history |
| `/api/projects/:id/eng-tasks` | GET — engineering tasks |
| `/api/projects/:id/eng-stages` | GET — engineering stages |
| `/api/projects/:id/generate-eng-tasks` | POST — generate tasks |
| `/api/eng/tasks` | POST/PUT/DELETE — task CRUD |
| `/api/pd/tickets` | GET — PD tickets |
| `/api/planning-tasks/:projectName` | GET — planning tasks |
| `/api/program-inflows` | GET — revenue inflows |
| `/api/program-expenses/:projectName` | GET — expenses |
| `/api/revenue-tab/:projectName` | GET — revenue data |
| `/api/expenditure-breakdown/:projectName` | GET — expenditure |
| `/api/ms-objects/project/:id` | GET — MS objects |
| `/api/cashflow` | GET — cashflow data |
| `/api/exceptions` | GET — project exceptions |
| `/api/quality/project/:projectName/summary` | GET — quality summary |
| `/api/projects/:projectName/health-summary` | GET — health summary |

**Assessment**: V2 hooks are wired up and active, but the page still runs parallel legacy queries. This is a transitional state — legacy calls should be removed once V2 data is fully consumed by all tab UI components.

### 4d. Permissions — HYBRID

```typescript
const v2Perms: ProjectPermissions | null = v2Detail?.permissions ?? null;
```

Permissions are **read from the V2 API response** (`v2Detail.permissions`). However, the page also uses `usePermission()` hook with `checkPermission(userRole, entity, "view")` for tab visibility (`canViewTab`). This is a **hybrid approach**: entity-level access uses the shared permission hook, while project-specific permissions come from the API.

---

## 5. Dashboard / Execution Board Page

**File**: `client/src/pages/execution-board.tsx` (shell)
**Data**: `client/src/pages/execution-dashboard/use-execution-data.ts`

### 5a. Data Source — OBSERVATION

The execution board fetches from:
```
GET /api/lifecycle-board/execution-dashboard
```

There is **no `dashboard_project_metrics`** endpoint or table reference. Data comes as a structured response from a single endpoint.

### 5b. ProgramProvider — PASS

**No `ProgramProvider` usage** found anywhere in `client/src/pages/`. The old `ProgramProvider` context has been replaced:
- `use-projects-summary.ts` explicitly documents: _"Replaces ProgramProvider's projectsSummary context"_

### 5c. Client-Side Aggregation — OBSERVATION

The execution dashboard **does aggregate data client-side** via `useMemo` in `use-execution-data.ts`:
- Revenue/expenditure totals
- Margin and variance calculations
- Engineering/quality issue counts
- Filtering by multiple dimensions (status, PM, region, etc.)

The server sends per-project data; the client computes KPI rollups. This is a design choice (enables real-time filtering without re-fetching) rather than a legacy pattern.

---

## 6. Task-Related Pages — Legacy References

```bash
grep -rn "operational_tasks\|engineering_tasks" client/src/pages/ --include="*.tsx"
```

**Results: 2 matches** (both in `admin-roles.tsx`)

```
admin-roles.tsx:139: operational_tasks: "Operational Tasks — ad-hoc task tracking (via work_items)"
admin-roles.tsx:193: entities: [..., "operational_tasks", ...]
```

### Assessment — ACCEPTABLE

These references are in the **permission entity definition UI** (`admin-roles.tsx`), not in data-fetching or business logic. They define what the `operational_tasks` permission entity label means in the admin roles editor. The note itself says _"via work_items"_, indicating the underlying data model uses `work_items` / `UnifiedTask`.

No page makes API calls to `operational_tasks` or `engineering_tasks` endpoints.

---

## Summary

| Check | Result | Notes |
|-------|--------|-------|
| All routes map to existing components | PASS | 67 routed components, all files exist |
| No broken imports | PASS | All module imports resolve |
| V2 endpoints for project detail | PASS | 5 V2 hooks active and wired |
| Legacy calls eliminated | PARTIAL | Project detail still has parallel legacy queries alongside V2 |
| Orphaned pages identified | 4 found | `department-scores`, `eng-template-admin`, `phase-templates`, `project-create` |
| ProgramProvider removed | PASS | Not used in any page |
| Dashboard aggregation | OBSERVATION | Client-side aggregation by design (enables filtering) |
| `dashboard_project_metrics` via V2 | N/A | This endpoint/table does not exist in the codebase |
| `operational_tasks`/`engineering_tasks` in pages | PASS | Only in permission labels (admin-roles), not in data fetching |
| Permissions from API | HYBRID | V2 project permissions from API + shared permission hook for entity access |
