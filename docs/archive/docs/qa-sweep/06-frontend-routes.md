# QA Sweep 06 — Frontend Route & Page Audit

**Date**: 2026-03-21
**Status**: PASS — all issues fixed

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

All `routeComponentKey` values in `PAGE_REGISTRY` resolve to valid entries in the `ROUTE_COMPONENTS` map in `App.tsx`. All imported page files exist on disk.

### 2b. Broken Imports — PASS

No broken imports detected. All page files import from valid modules:
- `@/components/*` — UI components
- `@/hooks/*` — custom hooks
- `@/lib/*` — utilities
- `@shared/*` — shared types/schemas

### 2c. useQuery Calls — V2 Endpoint Usage — PASS

V2 endpoints for the **project detail domain** in `client/src/hooks/use-project-v2.ts`:

| Hook | Endpoint |
|------|----------|
| `useProjectDetail` | `GET /api/v2/projects/:id` |
| `useProjectFinance` | `GET /api/v2/projects/:id/finance` |
| `useProjectPlan` | `GET /api/v2/projects/:id/plan` |
| `useProjectQuality` | `GET /api/v2/projects/:id/quality` |
| `useProjectEngineering` | `GET /api/v2/projects/:id/engineering` |

All other pages use domain-prefixed endpoints (e.g., `/api/eng/`, `/api/pd/`, `/api/pm/`).

### 2d. useMutation Calls — PASS

All mutations target current domain-scoped endpoints. No deprecated endpoint patterns found.

---

## 3. Orphaned Page Files

### FIXED: 4 orphaned pages deleted

| File | Action |
|------|--------|
| `pages/department-scores.tsx` | **Deleted** — no route, no import |
| `pages/eng-template-admin.tsx` | **Deleted** — no route, no import |
| `pages/phase-templates.tsx` | **Deleted** — no route, no import |
| `pages/project-create.tsx` | **Deleted** — no route, no import |

### FIXED: Dead route component references removed

| Entry | Action |
|-------|--------|
| `RoleSettingsPage` in ROUTE_COMPONENTS | **Removed** — no PAGE_REGISTRY entry mapped to it |
| `PMDashboard` in ROUTE_COMPONENTS | **Removed** — `/pm-dashboard` only redirects, component never renders |
| Corresponding imports in App.tsx | **Removed** |

### FIXED: Broken navigation repaired

| Location | Action |
|----------|--------|
| `project-lifecycle.tsx` — "New Project" buttons | **Fixed** — pointed to deleted `/project-create`; redirected to `/lifecycle-board` (has project creation dialog) |
| `app-navigation.ts` — Knowledge section | **Fixed** — removed `/department-scores` from URL matcher |

### Remaining utility files (not pages, expected)

| File | Status |
|------|--------|
| `pages/admin-roles.utils.ts` | Utility file for `admin-roles.tsx` |
| `pages/my-work-tasks-logic.ts` | Logic helper for `my-work-tasks.tsx` |

---

## 4. Project Detail Page (`/project/:projectName`) — PASS

**File**: `client/src/pages/project-detail.tsx`

### 4a. Primary V2 Call — PASS

```typescript
const { data: v2Detail } = useProjectDetail(projectInfoId);
// → GET /api/v2/projects/:id
```

### 4b. Tab Lazy-Loading — PASS

Each tab domain lazy-loads from V2 endpoints, gated by `activeSection`:

```typescript
const { data: v2Finance } = useProjectFinance(projectInfoId, activeSection === "commercial");
const { data: v2Plan } = useProjectPlan(projectInfoId, activeSection === "delivery");
const { data: v2Quality } = useProjectQuality(projectInfoId, activeSection === "quality");
const { data: v2Engineering } = useProjectEngineering(projectInfoId, activeSection === "engineering");
```

### 4c. Legacy KPI Queries — FIXED

**7 redundant legacy queries removed** from the project detail page. KPI computations now use `healthSummary` (server-side truth) and V2 data exclusively:

| Removed Query | Replaced By |
|---------------|-------------|
| `/api/planning-tasks/:name` | `healthSummary.schedule` + `v2Detail.planSummary` |
| `/api/program-inflows` | `v2Detail.financeSummary.totalRevenue` |
| `/api/program-expenses/:name` | `healthSummary.cost` + `v2Detail.financeSummary` |
| `/api/cashflow?project=` | Never consumed in JSX — dead code |
| `/api/projects/:id/eng-tasks` (overview) | `healthSummary.alerts` + `v2Engineering.workItems` |
| `/api/quality/project/:name/summary` | `healthSummary.quality` + `v2Detail.qualitySummary` |
| `/api/projects/:id/eng-stages` | `v2Engineering.stages` |

### Remaining domain endpoints (not legacy)

These provide unique data not available in V2 and are needed by the page:

| Endpoint | Purpose | Why Kept |
|----------|---------|----------|
| `/api/projects/:id/phase` (PATCH) | Phase mutation | Write operation |
| `/api/projects/:id/phase-history` | Phase timeline | Unique data (no V2 equivalent) |
| `/api/eng/tasks` (POST/PUT/DELETE) | Eng task CRUD | Write operations |
| `/api/pd/tickets` | PD tickets | Unique domain data |
| `/api/revenue-tab/:name` | Milestone details | Provides per-milestone status/reconciliation |
| `/api/expenditure-breakdown/:name` | Expenditure reconciliation | Provides risk signals not in V2 |
| `/api/ms-objects/project/:id` | MS integration | Unique integration data |
| `/api/exceptions` | Project exceptions | Unique exception tracking |
| `/api/projects/:name/health-summary` | Server-side KPI truth | This IS the authoritative source |

### 4d. Permissions — HYBRID (by design)

```typescript
const v2Perms: ProjectPermissions | null = v2Detail?.permissions ?? null;
```

- **Project-specific permissions**: Read from V2 API response (`v2Detail.permissions`)
- **Entity-level tab access**: Uses `usePermission()` hook with `checkPermission(userRole, entity, "view")`

This is intentional: entity-level access (can this role see engineering?) uses the shared permission system, while project-specific permissions (can this user edit this project?) come from the V2 API.

---

## 5. Dashboard / Execution Board Page — PASS

**File**: `client/src/pages/execution-board.tsx` (shell)
**Data**: `client/src/pages/execution-dashboard/use-execution-data.ts`

### 5a. Data Source

Single endpoint: `GET /api/lifecycle-board/execution-dashboard`

No `dashboard_project_metrics` endpoint exists in the codebase.

### 5b. ProgramProvider — PASS

**No `ProgramProvider` usage** in any page file. Replaced by `use-projects-summary.ts` which documents: _"Replaces ProgramProvider's projectsSummary context"_

### 5c. Client-Side Aggregation — by design

The execution dashboard aggregates data client-side via `useMemo` to enable real-time filtering by PM, region, status, etc. without server round-trips. This is a performance optimization, not a legacy pattern.

---

## 6. Task-Related Pages — PASS

```bash
grep -rn "operational_tasks\|engineering_tasks" client/src/pages/ --include="*.tsx"
```

**Results: 2 matches** (both in `admin-roles.tsx` permission labels only)

```
admin-roles.tsx:139: operational_tasks: "Operational Tasks — ad-hoc task tracking (via work_items)"
admin-roles.tsx:193: entities: [..., "operational_tasks", ...]
```

### Assessment — ACCEPTABLE (cannot change)

`operational_tasks` is a **permission entity name** defined in `shared/schema/users.ts` (line 176) as part of the `PermissionEntity` type union. It is used throughout the backend permission system. The admin-roles page displays the label for this entity — the label itself already says _"via work_items"_ documenting that the data model uses `work_items`.

Renaming this entity would require a coordinated schema migration across shared types, server permission checks, and database role records. No API calls to `operational_tasks` or `engineering_tasks` endpoints exist in any page.

---

## Fixes Applied

| Issue | Fix |
|-------|-----|
| 4 orphaned page files | Deleted: `department-scores`, `eng-template-admin`, `phase-templates`, `project-create` |
| Dead ROUTE_COMPONENTS entries | Removed `RoleSettingsPage` and `PMDashboard` from map + imports |
| Broken "New Project" navigation | Redirected to `/lifecycle-board` (has project creation) |
| `department-scores` URL in nav matcher | Removed from `app-navigation.ts` |
| 7 redundant legacy queries in project-detail | Removed; KPIs now use `healthSummary` + V2 hooks |
| DataSourceDebug references legacy endpoints | Updated to list V2 endpoints |

---

## Summary

| Check | Result | Notes |
|-------|--------|-------|
| All routes map to existing components | PASS | 65 routed components, all files exist |
| No broken imports | PASS | All module imports resolve |
| V2 endpoints for project detail | PASS | 5 V2 hooks active; 7 redundant legacy queries removed |
| Legacy calls eliminated | PASS | Remaining endpoints provide unique data (write ops, milestone details, reconciliation) |
| Orphaned pages | FIXED | 4 deleted, 2 dead references removed |
| ProgramProvider removed | PASS | Not used in any page |
| Dashboard aggregation | PASS | Client-side by design (enables filtering) |
| `dashboard_project_metrics` via V2 | N/A | This endpoint/table does not exist in codebase |
| `operational_tasks`/`engineering_tasks` in pages | PASS | Only in permission entity labels; entity name is in shared schema |
| Permissions from API | PASS | V2 project permissions from API + shared hook for entity access |
| TypeScript compilation | PASS | `tsc --noEmit` clean |
