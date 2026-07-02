# Execution & Functional Areas Audit — 2026-05-13

## Scope

This audit extends the same level of detail used in the priorities audit to the following operating areas:

1. Execution Dashboard
2. All Projects / Project List / Project Detail backbone
3. Milestone Tracker
4. Finance functions
5. Engineering functions
6. Quality functions

The audit is based on static review of the current repository. It does not change runtime behavior.

## Source files reviewed

### Shared rules, schema, and contracts

- `docs/AGENT_GUARDRAILS.md`
- `docs/operating-model/playbook-v2.0.md`
- `shared/schema/projects.ts`
- `shared/schema/finance.ts`
- `shared/schema/engineering.ts`
- `shared/schema/quality.ts`
- `shared/schema/tasks.ts`
- `shared/schema/users.ts`
- `shared/api-types/project-v2.ts`
- `shared/types/unified-task.ts`
- `shared/lib/financeAnalysis.ts`
- `shared/lib/engineering-ticket-view.ts`
- `shared/quality-governance.ts`

### Execution dashboard and lifecycle board

- `client/src/pages/execution-dashboard/index.tsx`
- `client/src/pages/execution-dashboard/use-execution-data.ts`
- `client/src/pages/execution-dashboard/OverviewPage.tsx`
- `client/src/pages/execution-dashboard/ProgramPage.tsx`
- `client/src/pages/execution-dashboard/ConstructionPage.tsx`
- `client/src/pages/execution-dashboard/FinancePage.tsx`
- `client/src/pages/execution-dashboard/RealisationKPIsPage.tsx`
- `client/src/lib/execution-dashboard.ts`
- `server/lifecycle-routes.ts`
- `server/routes/finance-legacy-extracted-routes.ts`

### All projects and project backbone

- `client/src/pages/projects.tsx`
- `client/src/pages/project-detail.tsx`
- `client/src/components/ProjectCommandHeader.tsx`
- `client/src/components/tabs/*`
- `server/departments/project-routes.ts`
- `server/api/v2/routes/v2-routes.ts`
- `server/api/v2/controllers/v2-controller.ts`
- `server/api/v2/services/project-v2-service.ts`
- `server/api/v2/repositories/project-v2-repository.ts`
- `server/routes/project-access-routes.ts`
- `server/project-events-routes.ts`

### Milestone tracker

- `client/src/pages/milestone-tracker.tsx`
- `client/src/pages/financial-linking.tsx`
- `server/departments/finance-routes.ts`
- `server/api/v2/routes/v2-routes.ts`
- `server/api/v2/repositories/project-v2-repository.ts`
- `shared/schema/finance.ts`
- `shared/schema/tasks.ts`

### Finance functions

- `client/src/pages/finance-gp.tsx`
- `client/src/pages/finance-gp-company.tsx`
- `client/src/pages/finance-quickbooks-links.tsx`
- `client/src/pages/finance-quickbooks-throughput.tsx`
- `client/src/pages/finance-quickbooks-customer-mapping.tsx`
- `client/src/components/tabs/FinanceCosTab.tsx`
- `client/src/components/tabs/FinanceRevenueTab.tsx`
- `client/src/components/finance/*`
- `server/departments/finance-routes.ts`
- `server/routes/finance-lines.routes.ts`
- `server/routes/finance-analysis.routes.ts`
- `server/routes/finance-trust-routes.ts`
- `server/repositories/finance-*.ts`
- `server/lib/finance/*`
- `server/lib/finance-trust/*`
- `server/policies/finance-policy.ts`

### Engineering functions

- `client/src/pages/engineering-dashboard.tsx`
- `client/src/pages/engineering-tasks.tsx`
- `client/src/pages/EngineeringTasksPage.tsx`
- `client/src/pages/engineering/*`
- `client/src/components/tabs/EngineeringStagesTab.tsx`
- `client/src/components/engineering/*`
- `server/engineering-routes.ts`
- `server/eng-stage-routes.ts`
- `server/routes/engineering.routes.ts`
- `server/routes/engineering-monthly-report-routes.ts`
- `server/services/*engineering*.ts`
- `server/lib/*engineering*.ts`

### Quality functions

- `client/src/pages/qm-dashboard.tsx`
- `client/src/pages/quality/quality-dashboard.tsx`
- `client/src/pages/quality/tasks.tsx`
- `client/src/components/tabs/QualityTab.tsx`
- `client/src/components/tabs/quality/*`
- `client/src/components/quality/*`
- `server/quality-routes.ts`
- `server/quality-ncr-routes.ts`
- `server/routes/quality-tasks.routes.ts`
- `server/repositories/quality-tasks-repository.ts`
- `server/lib/quality-task-filters.ts`

## Executive summary

The operating-system surfaces are broad and valuable. They already connect project delivery, milestones, finance, engineering, and quality around the project record. The strongest parts are the project spine, the finance hard-rule implementation work, the v2 project-scoped API, the engineering deliverable/task routes, and the quality checklist/NCR surfaces.

The main issue is not a lack of features. The main issue is **fragmentation**:

- Multiple route generations exist for the same business objects.
- Some pages read legacy endpoints while newer v2 endpoints have stronger project-scope middleware.
- Some dashboards expose finance and project metrics behind only `requireAuth`.
- Finance is more mature than the other areas on trust metadata, formula guardrails, and reconciliation diagnostics.
- Engineering and quality have rich workflow routes but less consistent dashboard-level trust and escalation semantics.
- Milestone tracking currently straddles finance revenue milestones, PM tasks, and v2 work-item milestones without one canonical milestone service.

Recommended path:

1. **Do not add more dashboards first.** Harden the existing surfaces.
2. **Make the project spine authoritative** across all pages: every row should resolve to `projectInfo.id`, not only project name.
3. **Move read-heavy pages to scoped v2 endpoints** where available.
4. **Apply finance-style trust metadata to execution, projects, engineering, and quality.**
5. **Create one milestone read model** that merges revenue milestones, PM plan milestones, engineering deliverables, and quality gates.
6. **Normalize authorization and audit across all functional areas.**

---

# 1. Execution Dashboard audit

## Current functionality map

### Frontend

The execution dashboard is split into route-tab pages:

- Overview: portfolio KPIs, filtered project list, high-level attention cards.
- Program: project execution/program view.
- Construction: construction-focused project list and status.
- Finance: overdue payment drill-downs and finance exposure.
- Realisation KPIs: separate KPI pull from `/api/realisation-kpis`.

The shared hook `use-execution-data.ts` loads `/api/lifecycle-board/execution-dashboard`, applies filters client-side, exposes filtered projects, KPI data, action-center rows, and refresh behavior.

### Backend

Primary execution endpoints are in `server/lifecycle-routes.ts`:

- `GET /api/lifecycle-board/execution-dashboard`
- `GET /api/lifecycle-board/overdue-payments`
- `GET /api/lifecycle-board/projects`
- `GET /api/lifecycle-board/lifecycle-model`
- `GET /api/lifecycle-board/projects/:id/stage-gates/evaluate`
- `POST /api/lifecycle-board/projects/:id/stage-gates/override`
- `PATCH /api/lifecycle-board/projects/:id/phase`
- `GET/PATCH /api/lifecycle-board/projects/:id/execution-gate`

The execution dashboard endpoint derives active projects from `projectInfo` + `projectExecutionState`, joins PM plan tasks, financial revenue/cost lines, and computes portfolio-level metrics.

## Current upgrades worth keeping

- A single execution dashboard payload exists, so the UI is not performing dozens of separate project-by-project calls.
- The dashboard filters are centralized in `client/src/lib/execution-dashboard.ts` and the shared hook, keeping tabs consistent.
- The dashboard uses financial-year boundaries and current date semantics instead of purely static totals.
- The execution board connects plan progress, expected progress, RAG, financial inflows/outflows, and action-center rows.
- The finance tab has a focused overdue-payment endpoint instead of forcing users to inspect all finance lines manually.
- Stage gate override routes already exist and align with the guardrail principle: record/override with reasons instead of blocking delivery.

## Bugs and defects

### P0 — Execution dashboard finance exposure is only behind `requireAuth`

**Evidence**

`GET /api/lifecycle-board/execution-dashboard` and `GET /api/lifecycle-board/overdue-payments` use `requireAuth`, but their payloads include finance-sensitive metrics such as outstanding revenue, COS exposure, overdue AR/AP, and project-level financial action rows.

**Impact**

Any authenticated user who can reach these endpoints may see finance summaries even if they do not have finance permissions. This is inconsistent with finance routes that use `requirePermission("financials", "view")`, `requirePermission("cashflow", "view")`, `requirePermission("cos", "view")`, or `requirePermission("revenue_tracker", "view")`.

**Fix**

Split execution payload into permission-aware sections:

- Always allowed: non-financial project health, phase, RAG, PM ownership, blockers.
- Finance-gated: revenue outstanding, COS outstanding, overdue payments, financial action-center rows.
- Add embedded permissions in the payload so UI can display locked/limited cards clearly.

**Priority**: P0.

### P0 — Execution dashboard duplicates finance formulas outside finance services

**Evidence**

The execution dashboard route directly queries `normalizedRevenueLines` and `normalizedCostLines` and builds derived finance metrics in the lifecycle route.

**Impact**

Finance formula integrity is a hard-rule area. Logic duplicated outside finance services is harder to keep aligned with the canonical finance modules and trust metadata.

**Fix**

Move dashboard finance computations behind finance repository/service functions that already apply:

- `effectiveTo IS NULL`
- deleted-row guards
- category-scoped revenue recognition
- COS realisation rules
- trust metadata / uncertainty fields

**Priority**: P0.

### P1 — Dashboard freshness is visible but not enforceable

**Evidence**

The UI displays `dataFreshness.generatedAt`, but the route is still live-computed and does not consistently return trust headers like finance-trust endpoints.

**Impact**

Users can see “as of” time, but cannot tell which sub-source is stale: Smart Import, QuickBooks, SharePoint, project status, or manual overrides.

**Fix**

Add a `trust` object to every execution dashboard payload:

- source tables
- generatedAt
- staleAfterSeconds
- stale component list
- exception count
- last successful refresh per integration

**Priority**: P1.

### P1 — Execution filters are client-side only after a large payload load

**Evidence**

The frontend loads the whole execution dashboard and filters in `use-execution-data.ts`.

**Impact**

This is fine for dozens of projects, but gets slow and expensive as the active portfolio grows. It also makes permission filtering harder because the server returns more data than the current view needs.

**Fix**

Add server-side query filters for:

- PM
- PD
- RAG
- execution phase
- exception-only
- behind-plan
- portfolio
- priority linked project

Keep client-side filtering only for instant secondary narrowing.

**Priority**: P1.

### P1 — Action-center rows need clearer ownership semantics

**Evidence**

The dashboard creates action-center rows from multiple domains, but not every row has a clear accountable role, owner user, source record, and resolution route.

**Impact**

The dashboard can tell leaders “something is wrong” but not always “who owns it and where to clear it”.

**Fix**

Standardize each action row:

- `sourceDomain`
- `sourceTable`
- `sourceId`
- `projectId`
- `ownerRole`
- `ownerUserId`
- `recommendedAction`
- `resolutionUrl`
- `severity`
- `createdAt`
- `staleAfter`

**Priority**: P1.

## Suggested removals / simplifications

- Stop putting finance formula code in lifecycle/dashboard route handlers.
- Avoid adding more execution dashboard tabs until the source payload is permission-aware and trusted.
- Retire duplicate dashboard endpoints where `/api/v2/dashboard/:role` or dashboard snapshots can replace older `/api/dashboard/*` routes.

## Missing features

- Explicit dashboard trust envelope.
- Server-side dashboard filters.
- Exportable “weekly execution pack” with the same source/trust metadata.
- Drill-through from every KPI to the exact source rows.
- Saved views: COO view, Programme Manager view, Construction view, Finance exposure view.
- Exception resolution workflow tied to `pending_approvals` / `audit_events`.

## UI/UX recommendations

- Add a top “data confidence” strip: Fresh / Stale / Partial / Error.
- Add role-aware locked finance cards instead of hiding finance context silently.
- Make action-center rows the main working surface, with owner and “clear this” route.
- Add “what changed since yesterday” for PMs and COO.
- Add skeleton states per tab instead of one whole-page spinner.
- Add a compact mobile action list for site users.

## Test gaps

- Permission tests for finance-containing dashboard payloads.
- Formula parity tests against finance services.
- Snapshot/trust metadata tests.
- Filter contract tests for server-side filters once added.
- Drill-through tests from dashboard KPI to source rows.

---

# 2. All Projects / Project List / Project Backbone audit

## Current functionality map

### Frontend

The Projects page uses `/api/projects-summary` for the main list, and also queries:

- `/api/pm-assignable-users`
- `/api/priorities`
- `/api/priorities/:id`
- export endpoint `/api/export/projects-summary`

The Project Detail page is the main project workspace and fans out into many tabs, including:

- Plan
- Timeline
- Engineering stages
- Finance COS
- Finance Revenue
- Quality
- Approvals
- RAID
- Procurement
- Construction
- Handover
- Communications
- History
- Team

### Backend

There are two major generations:

1. Legacy/project-department routes in `server/departments/project-routes.ts`:
   - `/api/projects-summary`
   - `/api/projects`
   - `/api/projects/:id`
   - `/api/projects/:id/header-kpis`
   - `/api/project-info`
   - `/api/project-info/:id/assign-pm`
   - `/api/project-info/:id`
   - `/api/key-dates/:projectName`
   - `/api/key-date-mappings/*`

2. Scoped v2 routes in `server/api/v2/routes/v2-routes.ts`:
   - `/api/v2/projects`
   - `/api/v2/projects/:projectId`
   - `/api/v2/projects/:projectId/overview`
   - `/api/v2/projects/:projectId/lifecycle`
   - `/api/v2/projects/:projectId/health`
   - `/api/v2/projects/:projectId/finance`
   - `/api/v2/projects/:projectId/plan`
   - `/api/v2/projects/:projectId/quality`
   - `/api/v2/projects/:projectId/engineering`
   - `/api/v2/projects/:projectId/work-items`
   - `/api/v2/projects/:projectId/milestones`
   - `/api/v2/projects/:projectId/procurement/*`
   - `/api/v2/projects/:projectId/finance/*`

The v2 routes use `attachProjectScope` and `requireProjectAccess` for project-scoped endpoints.

## Current upgrades worth keeping

- v2 project routes provide the right direction: project ID, scope middleware, consolidated subresources, and response validation.
- Project access routes exist for explicit project access management.
- Header KPI recompute route exists for refreshing project summary metrics.
- Project detail tabs are aligned to the project spine and cross-functional operating model.
- Project events routes provide a path toward a timeline/audit feed.

## Bugs and defects

### P0 — Projects list still relies heavily on legacy `/api/projects-summary`

**Evidence**

The Projects page reads `/api/projects-summary`, while v2 project listing exists at `/api/v2/projects` with project-scope middleware.

**Impact**

The main project list is not yet using the strongest access model and v2 response contract. This creates inconsistent behavior between list and detail/project-scoped routes.

**Fix**

Move the Projects page to `/api/v2/projects` or create a v2 summary endpoint with the same columns required by the current UI.

**Priority**: P0.

### P0 — Project name remains a functional identifier in several routes

**Evidence**

Several live routes still use `:projectName`, including key dates, finance revenue tab, expenditure breakdown, quality checklist/project routes, and milestone tracker calls.

**Impact**

Project names are mutable and can collide. This weakens the “project is the spine” rule because the canonical spine is `projectInfo.id`.

**Fix**

Add ID-first endpoints and migrate clients:

- `/api/projects/:projectId/key-dates`
- `/api/projects/:projectId/revenue-tab`
- `/api/projects/:projectId/quality/checklist`
- `/api/projects/:projectId/expenditure-breakdown`

Keep name routes as compatibility wrappers only.

**Priority**: P0.

### P1 — Project edit routes mix role gates and broad admin gates

**Evidence**

Some routes use `requirePermission('projects', 'edit')`, while others use `requireAdmin` or lifecycle-specific exec-role checks.

**Impact**

Users may be able to edit some project fields but not adjacent fields that should share a domain policy, or admins may be required for operational edits that a PM should own.

**Fix**

Define field-level ownership:

- PM assignment: Programme Manager / COO / configured project admin.
- Lifecycle phase: COO/Programme Manager with reason/audit.
- Finance fields: finance permission only.
- Engineering fields: engineering permission only.
- Quality fields: quality permission only.

**Priority**: P1.

### P1 — Project detail has too many direct tab-level contracts

**Evidence**

Project detail tabs each query different legacy endpoints and data shapes.

**Impact**

A project can show inconsistent PM, phase, RAG, percentage, finance totals, or quality state depending on which tab is open.

**Fix**

Use `/api/v2/projects/:projectId` as the page shell contract and only let tabs fetch domain-specific detail from v2 subresources.

**Priority**: P1.

### P1 — Project archive/delete semantics need one policy

**Evidence**

Lifecycle board has active/archive/deleted concepts; project execution state filters deleted rows; other list routes may handle deleted/archived differently.

**Impact**

“All projects” can disagree with lifecycle board or dashboards about what is active.

**Fix**

Define one project visibility model:

- Active
- On Hold
- Archived
- Deleted/Recoverable

Expose the same filter in all project list endpoints.

**Priority**: P1.

## Suggested removals / simplifications

- Reduce direct use of `/api/projects-summary` after v2 list parity exists.
- Stop adding new project-name endpoints.
- Move key-date mapping into project ID routes.
- Retire duplicate `/api/projects` if it is only a legacy wrapper.

## Missing features

- Project data quality panel: missing PM, missing phase, missing RAG reason, missing finance link, missing SharePoint root.
- Project access visibility: who can see/edit this project and why.
- Project source-of-truth badge per field: Pipedrive, Smart Import, SharePoint, app manual, QuickBooks.
- Project change-request workflow for sensitive fields.
- Bulk project update with reason and audit.

## UI/UX recommendations

- Add a “Data health” column to All Projects.
- Add saved filters: No PM, Red/Amber, Missing finance, No latest update, Behind plan, Priority-linked.
- Make project ID visible in debug/details drawer, not necessarily primary UI.
- Add a “why can I/can’t I edit this?” permission hint for disabled actions.
- Add column presets by role: COO, PM, Finance, Engineering, Quality.

## Test gaps

- `/api/projects-summary` vs `/api/v2/projects` parity tests.
- Project-name collision tests for remaining name endpoints.
- Project-scope tests for all detail tabs.
- Archive/deleted visibility tests.
- Field-level permission contract tests.

---

# 3. Milestone Tracker audit

## Current functionality map

### Frontend

`client/src/pages/milestone-tracker.tsx` loads:

- `/api/project-info`
- `/api/projects-summary`
- `/api/revenue-tab/:projectName` per project

It derives milestone urgency from revenue milestones:

- Overdue
- Upcoming 14 days
- Rest

It also allows latest update edits through `/api/projects-summary/:projectName/latest-update`.

### Backend and data model

Milestone-related data currently lives in multiple places:

- Finance revenue milestones: `normalized_revenue_lines` fields such as milestone name/no/percent/amount/dates/status.
- Task/work-item milestones: `work_items.is_milestone` and v2 `/api/v2/projects/:projectId/milestones`.
- Milestone task links: `milestone_task_links` links revenue milestone row numbers to tasks.
- Project key dates: `key-date` routes and mappings.

## Current upgrades worth keeping

- The Milestone Tracker gives a portfolio-wide operational view of upcoming/overdue revenue milestones.
- It connects milestone dates with project RAG/latest update context.
- It surfaces milestone status states: planned, invoiced, overdue, in bank.
- It already understands urgency grouping, making it useful for daily/weekly execution meetings.
- The v2 project milestone endpoint exists and can become the canonical PM milestone path.

## Bugs and defects

### P0 — Milestone Tracker is project-name and revenue-tab dependent

**Evidence**

The page queries `/api/revenue-tab/:projectName` for each project.

**Impact**

- It depends on mutable project names.
- It fans out N project requests.
- It ties the whole milestone tracker to finance revenue-tab shape.
- PM plan milestones and engineering/quality milestone gates are not first-class in the same model.

**Fix**

Create a single ID-first endpoint:

`GET /api/milestones/portfolio?from=&to=&type=revenue,plan,engineering,quality`

Each row should include:

- `projectId`
- `projectName`
- `milestoneId`
- `milestoneType`
- `sourceTable`
- `sourceId`
- `dueDate`
- `status`
- `amount` when financial
- `ownerRole`
- `ownerUserId`
- `resolutionUrl`
- `trust`

**Priority**: P0.

### P0 — Milestone tracker mixes operational milestones and financial recognition milestones without a type boundary

**Evidence**

Revenue milestones are used as the main milestone tracker source, while v2 also exposes work-item milestones.

**Impact**

A revenue milestone can be “planned” while PM execution milestone tasks are late, or vice versa. Users may think the tracker covers all milestones when it mainly covers revenue milestones.

**Fix**

Split milestone lanes clearly:

- Revenue milestone
- PM plan milestone
- Engineering deliverable milestone
- Quality gate/ITP milestone
- Handover milestone

**Priority**: P0.

### P1 — Per-project fan-out will become slow

**Evidence**

The page uses one query for project lists and then `useQueries` for each project’s revenue tab.

**Impact**

Portfolio pages become slow and noisy as project count grows. Errors on one project can create partial hidden failures.

**Fix**

Backend aggregation endpoint with pagination, filter, and partial-source error reporting.

**Priority**: P1.

### P1 — Latest update mutation invalidates project lists but not all milestone row queries

**Evidence**

The page invalidates project-info and projects-summary after latest update saves, but milestone query invalidation is per revenue-tab key.

**Impact**

Some displayed row context can remain stale depending on which query owns the field.

**Fix**

Create one invalidation helper for milestone tracker source keys, or move latest update into the aggregate endpoint response and invalidate one portfolio milestone key.

**Priority**: P1.

### P2 — Milestone row identity uses source row numbers in finance flows

**Evidence**

`milestone_task_links` links by project and `milestoneRowNumber`.

**Impact**

Row-number identities are fragile when imports reorder rows or workbook structure changes.

**Fix**

Link to stable normalized revenue line IDs or a dedicated canonical milestone ID, while keeping row number as display/import metadata.

**Priority**: P2.

## Suggested removals / simplifications

- Stop using project name as the milestone fetch key.
- Avoid adding more direct `revenue-tab` dependencies to non-finance pages.
- Retire row-number-only milestone linking once stable IDs are available.

## Missing features

- Unified milestone model.
- Milestone owner and accountable role.
- Milestone comments/notes with audit.
- Milestone snooze/override with reason.
- Milestone change history.
- Milestone-to-task dependency visibility.
- Milestone export for weekly delivery meeting.

## UI/UX recommendations

- Add milestone type badges.
- Add source badges: Finance, PM Plan, Engineering, Quality.
- Add a “blocked reason” column.
- Add owner column and quick filter by owner/PM/department.
- Add drill-through directly to the source row/tab.
- Show partial-data warnings when any project source fails.

## Test gaps

- Portfolio milestone aggregation tests.
- Project-name collision tests.
- Revenue milestone vs work-item milestone parity tests.
- Row-number link stability tests.
- Performance test for 100+ projects.

---

# 4. Finance functions audit

## Current functionality map

Finance is the broadest and most mature functional area. It includes:

### Portfolio finance

- GP tracker: `/api/gp-tracker`, `/api/gp-tracker/project/:projectName`, `/api/gp-tracker/month-detail`
- Revenue tracker: `/api/revenue-tracker`, `/api/revenue-tracker/project/:projectName`, `/api/revenue-tracker/month-detail`, reconciliation
- COS tracker: `/api/cos-tracker`, `/api/cos-tracker/project/:projectName`, month detail, reconciliation, period locks, overrides
- Cashflow: `/api/cashflow`, `/api/cashflow-2026`, detail, opening balance, OPEX budgets, overrides

### Project finance

- Revenue tab: `/api/revenue-tab/:projectName`
- Expenditure breakdown: `/api/expenditure-breakdown/:projectName`
- Project cost/revenue lines: `/api/projects/:projectName/cost-lines`, `/api/projects/:projectName/revenue-lines`
- v2 project finance endpoints: `/api/v2/projects/:projectId/finance/*`

### Line-level finance

- `/api/finance/lines/:projectId`
- `/api/finance/lines`
- `/api/finance/category-allocation-health`
- `/api/finance/recon-check/:projectId`
- `/api/finance/recon-grid`

### Analysis and trust

- `/api/finance/analysis/cashflow/*`
- `/api/finance/analysis/cos/*`
- `/api/finance/analysis/tolerance`
- `/api/finance/trust/exceptions/summary`
- `/api/finance/trust/exceptions/queue`
- `/api/finance/trust/sync-health`
- `/api/finance/trust/integrity-audit`
- `/api/finance/trust/revalidation-status`
- `/api/finance/trust/integration-freshness`

## Current upgrades worth keeping

- Finance routes consistently use domain permissions more often than other areas.
- Finance line-level endpoints are project ID based and portfolio aggregations are explicit.
- Trust endpoints exist and set a pattern for the whole app.
- Category allocation health exists, which directly protects revenue recognition quality.
- COS period lock endpoints exist.
- Finance tests cover snapshot guards, hard-rule revenue recognition, COS realisation, line-level performance, access governance, trust envelope, QuickBooks constraints, and read coherency.
- Finance helpers isolate critical formula logic in `server/lib/finance/*`.

## Bugs and defects

### P0 — Project-name finance routes still carry high-value functionality

**Evidence**

Live finance routes still include `/api/revenue-tab/:projectName`, `/api/expenditure-breakdown/:projectName`, `/api/gp-tracker/project/:projectName`, and `/api/revenue-tracker/project/:projectName`.

**Impact**

Finance is a hard-rule area. Mutable project-name routing increases the risk of wrong-project reads/writes, especially with duplicate names, renamed projects, and imported workbook names.

**Fix**

Move all project finance routes to project ID contracts:

- `/api/projects/:projectId/revenue-tab`
- `/api/projects/:projectId/expenditure-breakdown`
- `/api/finance/projects/:projectId/gp`
- `/api/finance/projects/:projectId/revenue-tracker`

Keep project-name routes as compatibility wrappers that resolve name to ID and emit deprecation metadata.

**Priority**: P0.

### P0 — Some finance read endpoints return sensitive finance data without finance permissions

**Evidence**

Several project-tab routes under finance legacy paths use only `requireAuth`, while newer finance tracker/line routes use explicit finance permissions.

**Impact**

Users may access finance data through project detail paths even if portfolio finance pages are correctly permission-gated.

**Fix**

Audit every finance-containing route and enforce one of:

- `financials:view`
- `cashflow:view`
- `cos:view`
- `revenue_tracker:view`
- `gp_tracker:view`

When project delivery roles need limited visibility, return masked/limited data with clear permission metadata.

**Priority**: P0.

### P0 — Finance calculations exist in multiple route layers

**Evidence**

Finance logic appears in `finance-routes.ts`, finance-line routes, finance-analysis routes, lifecycle dashboard routes, and legacy extracted finance routes.

**Impact**

Formula drift is the biggest finance risk. Guardrails say financial-formula integrity is a hard refusal category.

**Fix**

Make `server/lib/finance/*` and repositories the only place formulas live. Routes should orchestrate and shape responses, not compute formulas.

**Priority**: P0.

### P1 — Trust metadata is not yet universal on finance responses

**Evidence**

Finance-trust endpoints provide trust envelopes and headers, but older tracker endpoints do not consistently expose the same trust shape.

**Impact**

Users cannot always distinguish canonical, stale, partial, manually overridden, or legacy-derived finance values.

**Fix**

Add a standard `trust` object to all finance responses:

- source layer
- canonical table(s)
- refreshedAt
- staleAfterSeconds
- exceptionCount
- uncertainty
- manualOverrideCount
- periodLock status

**Priority**: P1.

### P1 — Overrides and manual edits need consistent reason/audit shape

**Evidence**

Finance has several override endpoints: cashflow date overrides, revenue tracking overrides, expenditure overrides, COS status overrides, class overrides, planning overrides.

**Impact**

If reason/audit semantics differ by endpoint, finance review becomes harder.

**Fix**

Standardize override payload:

- `reason`
- `sourceField`
- `oldValue`
- `newValue`
- `effectiveFrom`
- `approvedBy` when required
- audit event linkage

**Priority**: P1.

### P1 — Period locks need to be visible in all edit UIs

**Evidence**

COS period lock endpoints exist, but not every finance editing UI necessarily shows lock state before a user acts.

**Impact**

Users may hit preventable errors, or worse, a route may miss lock enforcement.

**Fix**

Expose period lock state in the finance shell and every edit dialog. Server remains authoritative.

**Priority**: P1.

## Suggested removals / simplifications

- Retire name-based finance routes after ID route parity.
- Keep only one GP/revenue/COS source contract per page.
- Remove formula logic from UI and route handlers.
- Consolidate QuickBooks diagnostics under finance trust/integrations.

## Missing features

- Universal finance trust strip.
- Project finance source map: which rows came from Smart Import, QuickBooks, manual override.
- Finance exception work queue with assignment and closure reasons.
- Finance period close checklist.
- CFO approval flow for sensitive overrides.
- Diff view: last import vs current finance snapshot.

## UI/UX recommendations

- Every finance number should show source/trust on hover or click.
- Show period lock state in the page header.
- Use one finance shell for GP, revenue, COS, cashflow, trust, and analysis pages.
- Add exception-first workflow for finance users.
- Add “explain this number” drill-down for GP and cashflow totals.

## Test gaps

- Permission tests for every finance route returning financial amounts.
- Project ID migration tests for all project finance pages.
- Trust envelope tests for legacy tracker endpoints.
- Override reason/audit contract tests.
- Period-lock enforcement tests across every write route.

---

# 5. Engineering functions audit

## Current functionality map

Engineering includes:

### Engineering tasks

- `/api/eng/tasks`
- create/update/delete/bulk update
- send for approval
- send deliverable
- comments
- activity
- subtasks
- watchers
- task linking

### Deliverables and document control

- `/api/deliverables`
- `/api/deliverables/:id`
- deliverable feedback/revise/files/file approval
- file pointers
- deliverable download
- document control badges/actions

### Engineering dashboard and audit

- `/api/eng/dashboard/overview`
- `/api/eng/dashboard/projects`
- `/api/eng/unified-audit`
- `/api/eng/audit-log`
- audit stats and phase history
- warnings scan and warnings management

### Project engineering lifecycle

- CP signed status
- project phase change
- engineering tasks by project
- generate engineering tasks
- project team routes
- engineering constants
- home action hub

## Current upgrades worth keeping

- Engineering task routes have explicit `eng_tasks` permissions for view/create/edit/delete.
- Deliverable routes separate task, deliverable, file, approval, and acknowledge concepts.
- Engineering has audit-log routes, warning scan routes, and dashboard project routes.
- Project-team and assignee routes exist.
- Tests cover engineering roles, workflow regressions, IFC guardrails, containment, KPI trust, control state, hold validation, UI copy, data model consistency, and intake/canonical API flows.

## Bugs and defects

### P0 — Engineering has two route namespaces and page generations

**Evidence**

There are engineering routes in `server/engineering-routes.ts`, an empty/default `server/routes/engineering.routes.ts`, v2 project engineering endpoints, old `engineering-tasks.tsx`, newer `EngineeringTasksPage.tsx`, and `/engineering/*` pages.

**Impact**

Different pages can use different task shapes, permissions, and workflow semantics.

**Fix**

Create a route/page consolidation map:

- Canonical task API: one endpoint family.
- Canonical deliverable API: one endpoint family.
- Canonical project engineering API: v2 project subresource.
- Legacy pages become redirects or wrappers.

**Priority**: P0.

### P0 — Engineering route file is too large and route handlers own too much business logic

**Evidence**

`server/engineering-routes.ts` contains many route groups: local synced config, project teams, tasks, approvals, deliverables, file pointers, warnings, dashboard, audit, project phase, reconciliation, constants, and home action hub.

**Impact**

Large route files increase regression risk and make it hard to enforce repository/service boundaries.

**Fix**

Split into:

- `engineering-task.routes.ts`
- `engineering-deliverable.routes.ts`
- `engineering-dashboard.routes.ts`
- `engineering-warning.routes.ts`
- `engineering-audit.routes.ts`
- `project-engineering.routes.ts`

Move DB access into repositories/services.

**Priority**: P0.

### P1 — Engineering approval/deliverable flows need a single audit narrative

**Evidence**

Engineering tasks can be sent for approval, deliverables can be sent/acknowledged/revised, files can be approved, and activities/comments exist.

**Impact**

Users need one clear timeline: requested → assigned → submitted → reviewed → returned/approved → delivered → acknowledged.

**Fix**

Create a single engineering activity feed model per task/deliverable/project, with source event IDs and actor snapshots.

**Priority**: P1.

### P1 — Engineering project phase routes overlap project lifecycle routes

**Evidence**

Engineering routes include project phase and CP status endpoints, while lifecycle board and v2 project lifecycle endpoints also manage phases/history.

**Impact**

Phase changes can drift between surfaces unless all write paths share the same lifecycle service.

**Fix**

Route all project phase changes through one lifecycle service that records phase history, actor, role, reason, and override information.

**Priority**: P1.

### P1 — Engineering warnings need owner/resolution workflow

**Evidence**

Warnings can be scanned, listed, patched, and acknowledged.

**Impact**

A warning list without accountable owner, due date, and closure reason becomes a passive report rather than an execution tool.

**Fix**

Add warning owner, due date, status, closure reason, and link to source record.

**Priority**: P1.

## Suggested removals / simplifications

- Remove empty placeholder `server/routes/engineering.routes.ts` if it is not used, or turn it into the canonical route registry.
- Consolidate old/new engineering task pages.
- Stop allowing project phase writes outside the lifecycle service.
- Merge duplicate assignee/team lookup endpoints.

## Missing features

- Engineering SLA by task/deliverable type.
- Design revision comparison and reason capture.
- Engineering blocker escalation into priorities/RAID.
- Engineering workload/capacity view.
- Deliverable quality gate before construction handover.
- Engineering daily standup roll-forward from open blockers.

## UI/UX recommendations

- Separate “task status” from “deliverable approval status” visually.
- Add lane counts and SLA badges to engineering task boards.
- Add a single “next action” CTA per engineering item.
- Show source project phase and linked priority on each engineering item.
- Add a timeline drawer for every task/deliverable.

## Test gaps

- Route consolidation tests after split.
- Lifecycle phase single-service tests.
- Engineering activity feed tests.
- Warning owner/resolution tests.
- Permission matrix tests across task, deliverable, file, and dashboard actions.

---

# 6. Quality functions audit

## Current functionality map

Quality includes:

### Quality dashboard and checklist workspace

- `/api/quality/dashboard`
- `/api/quality/checklists`
- `/api/quality/all-items`
- `/api/quality/project/:projectName/checklist`
- `/api/quality/project/:projectName/summary`
- `/api/quality/project/:projectName/workspace`
- checklist item update/approve/delete/create
- evidence upload/link/delete
- send for approval

### Warnings, governance, and plans

- project warnings
- all warnings
- acknowledge/resolve warning
- plan links
- plan warnings
- recalculate warnings
- risk answers
- holidays
- users/roles
- admin bulk-create checklists

### NCRs and quality tasks

- `/api/quality/ncrs`
- NCR create/read/update/waive/delete/comments
- `/api/quality/tasks`

## Current upgrades worth keeping

- Quality checklist/project workspace is already project-centered in the UI, even if some routes are name-based.
- Evidence upload and evidence deletion routes exist.
- Warning acknowledge/resolve flows exist.
- NCR routes exist as a separate quality incident/nonconformance surface.
- Quality task route provides a dedicated task list with filters in `quality-task-filters`.
- Tests cover quality governance, role accountability, UI consistency, integration consistency, NCR containment, task route contract, and governance surfaces.

## Bugs and defects

### P0 — Quality project routes are project-name based

**Evidence**

Most quality project routes use `:projectName`.

**Impact**

Quality evidence, checklist approvals, and warnings are project-spine records. Using mutable names risks wrong-project linkage and breaks consistency with v2 project-scoped routes.

**Fix**

Add project ID routes:

- `/api/projects/:projectId/quality/checklist`
- `/api/projects/:projectId/quality/items/:itemInstanceId`
- `/api/projects/:projectId/quality/warnings`
- `/api/projects/:projectId/quality/evidence`
- `/api/projects/:projectId/quality/workspace`

Keep name-based routes as wrappers only.

**Priority**: P0.

### P0 — Quality access verification appears separate from app RBAC

**Evidence**

Quality routes include `/api/quality/access/verify` and `/api/quality/access/status` in addition to standard auth/permission patterns.

**Impact**

If quality access state diverges from role-based permissions, UI and API can disagree about who can approve, upload evidence, or edit quality records.

**Fix**

Define whether quality access verification is:

- a second-factor/access token gate,
- a legacy compatibility layer,
- or a UI-only feature.

Then integrate it with `requirePermission('quality', ...)` and project access middleware.

**Priority**: P0.

### P1 — Quality evidence needs a stronger trust/audit envelope

**Evidence**

Evidence upload/link/delete endpoints exist, but trust metadata is less developed than finance trust.

**Impact**

Quality evidence is compliance-critical. Users need to know who uploaded it, where it is stored, whether it is linked to SharePoint, whether it was deleted, and why.

**Fix**

Every evidence row should expose:

- storage provider
- storage ref/deep link
- uploaded by
- uploaded at
- approved by
- approved at
- deleted by/reason if deleted
- source checklist item
- immutable audit event ID

**Priority**: P1.

### P1 — Warning acknowledge/resolve needs role and reason consistency

**Evidence**

Quality warnings can be acknowledged and resolved.

**Impact**

Without consistent reason and role capture, warning closure can become a hidden override.

**Fix**

Require closure reason for resolve, optional comment for acknowledge, and record actor role snapshot.

**Priority**: P1.

### P1 — NCR lifecycle should be explicit in UI and API

**Evidence**

NCR routes support create/update/waive/delete/comments, but lifecycle state semantics are not clearly visible from route names alone.

**Impact**

NCRs need a clear lifecycle: draft/open → contained → root cause → corrective action → verified → closed/waived.

**Fix**

Add explicit NCR actions/endpoints or service methods for lifecycle transitions, each with reason/audit.

**Priority**: P1.

## Suggested removals / simplifications

- Retire project-name quality routes after project ID parity.
- Consolidate `qm-dashboard.tsx` and `quality/quality-dashboard.tsx` if they overlap.
- Avoid separate quality access logic unless it is a documented security requirement.
- Merge warnings and governance summary into one quality health service.

## Missing features

- Quality evidence trust strip.
- NCR lifecycle board.
- Quality hold/override workflow tied to stage gates.
- Quality checklist templates versioning.
- Audit trail drawer for checklist item changes.
- Quality SLA and ageing by item/NCR/warning.
- Quality-to-priority escalation.

## UI/UX recommendations

- Make checklist item state machine visible.
- Show evidence count, approval state, and missing-evidence warnings on each item.
- Add “why blocked” and “who can override” messages on quality gates.
- Add NCR severity/ageing cards to the dashboard.
- Add one-click drill from quality warning to source checklist item/project tab.

## Test gaps

- Project ID route tests for quality once added.
- Quality access/RBAC consistency tests.
- Evidence audit/trust tests.
- Warning close reason tests.
- NCR lifecycle transition tests.
- Template versioning tests.

---

# Cross-functional findings

## P0 — Project ID migration is the common critical path

The same issue appears in projects, milestones, finance, and quality: high-value routes still use project names.

Recommended policy:

- All new routes must be project ID first.
- Name-based routes are compatibility wrappers only.
- Every wrapper should resolve name → ID once, record ambiguity failures, and include deprecation metadata.

## P0 — Permission model must be consistent by data sensitivity

Current pattern:

- v2 project endpoints: scoped middleware.
- Finance line/tracker endpoints: strong permissions.
- Execution dashboard: broad `requireAuth` despite finance data.
- Some project detail finance/quality legacy routes: mixed gates.

Recommended policy:

- Project non-financial summary: project access.
- Finance values: finance permission or masked limited view.
- Engineering task/deliverable: engineering permission + project access.
- Quality checklist/evidence/NCR: quality permission + project access.
- Executive dashboard: section-level embedded permissions.

## P0 — Route handlers need to move business logic into services/repositories

The codebase guardrails state DB access should go through repositories. Several legacy route files still contain substantial query/formula/business logic.

Recommended sequence:

1. New code must use repositories/services.
2. Do not refactor everything at once.
3. Extract the riskiest logic first: finance formulas, project phase transitions, quality evidence transitions, engineering deliverable state transitions.

## P1 — Trust metadata should become a platform pattern

Finance has the strongest trust model. Apply the same shape to:

- Execution dashboard
- Project list/header KPIs
- Milestone tracker
- Engineering dashboard
- Quality dashboard

Standard trust shape:

```ts
{
  sourceLayer: "raw" | "normalized" | "derived" | "view_model";
  canonicalTable: string;
  refreshedAt: string | null;
  staleAfterSeconds: number;
  exceptionCount: number;
  uncertainty: string | null;
  manualOverrideCount?: number;
}
```

## P1 — Every cross-functional exception needs a resolution route

Dashboards should not only report exceptions. Each exception row should include:

- owner
- action
- route
- due date
- reason/audit on closure
- source record
- related priority/RAID item where applicable

## P1 — “Soft rule override” needs consistent UX

Across execution, finance, engineering, and quality, soft-rule violations should use the same pattern:

- Explain rule.
- Identify allowed authorizer.
- Require reason.
- Record audit.
- Continue if authorized.
- Show override later.

## Recommended implementation sequence

### Sprint 1 — Safety and visibility

1. Gate execution dashboard finance sections by finance permissions.
2. Add trust metadata to execution dashboard and milestone tracker.
3. Create project-ID wrappers for the highest-risk name routes: revenue tab, quality checklist, expenditure breakdown.
4. Add permission tests for finance-containing execution/project routes.
5. Add visible source/trust strips to execution, project header, and milestone tracker.

### Sprint 2 — Canonical read models

1. Move Projects page to v2 project list or add v2 summary parity.
2. Build portfolio milestone aggregate endpoint.
3. Move milestone tracker to aggregate endpoint.
4. Build project data health service.
5. Add drill-through URLs for all dashboard action rows.

### Sprint 3 — Workflow hardening

1. Consolidate engineering task/deliverable APIs.
2. Move project phase writes into one lifecycle service.
3. Add quality evidence trust/audit envelope.
4. Add NCR lifecycle transitions.
5. Normalize finance override payloads.

### Sprint 4 — Cleanup and removals

1. Retire project-name routes after usage is removed.
2. Retire duplicate dashboard/project summary endpoints.
3. Split large engineering and finance route files by domain.
4. Remove placeholder/empty route files or make them canonical registries.
5. Add route migration checks for banned new project-name endpoints.

## Final recommendation

The current system has the right ingredients. The next phase should be a **consolidation and trust phase**, not a feature-expansion phase.

Prioritize:

1. Project ID everywhere.
2. Permission-aware dashboard payloads.
3. Finance formula logic only in finance services.
4. Unified milestone read model.
5. Engineering/quality workflow audit trails.
6. Trust metadata on every leadership-facing KPI.
