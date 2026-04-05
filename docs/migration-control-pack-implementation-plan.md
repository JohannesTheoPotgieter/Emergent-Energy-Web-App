# Migration Control Pack — Implementation Plan

**Generated from:** Migration Control Pack (6-map operating system)
**Repo state as of:** 2026-04-05
**Branch:** `claude/migration-control-pack-Bd5uu`
**Status:** ALL 7 WAVES COMPLETE + POST-MIGRATION ACTIVE

## Post-Migration Status (2026-04-05)

| Item | Status |
|------|--------|
| Department shell enabled (default on) | **DONE** |
| All 7 waves implemented | **DONE** |
| Schema foundation (Phases A-H) | **DONE** (PR #526) |
| View-swap INSTEAD OF triggers (8 domains) | **DONE** — transparent dual-write |
| Reconciliation automated | **DONE** — 12 SQL checks + scheduler |
| Parity audit | **DONE** — 13 domains, 0 gaps |
| Bridge exit plan documented | **DONE** |
| Legacy consumers | **BRIDGE_ACTIVE** — view-swap triggers make reads transparent |
| Smart import migration | **FUTURE** — writes to finance_records with change detection |
| Auth migration to user_accounts | **FUTURE** |

---

---

## Section 1: Gap Analysis (REVISED — All decisions applied)

Cross-referencing the Migration Control Pack against the live codebase, with all 25 business decisions from Johannes applied.

---

### BLOCKERS — Status after decisions

| # | Original gap | Decision | New status | Build action | Wave |
|---|-------------|----------|-----------|-------------|------|
| B1 | No `party` entity | **Flexible multi-role** — one party can hold multiple roles | **UNBLOCKED** | Build `party` + `party_role` + `contact_method` + `project_party_link`. Merge `users`, `clients`, `counterparties` via legacy_id_map. | Wave 2 |
| B2 | No `governed_process` entity | **Standard pattern first, extensible later** | **UNBLOCKED** | Build `governed_process` + `governed_process_checklist_item` with standard lifecycle (initiate → checklist → review → approve → close). Migrate handovers (C3 confirmed), financial reviews, phase gates, change requests, payment batches. | Wave 3 |
| B3 | No `finance_record` entity | **All part of the same process** — finance team sees POs/invoices/payments as one workflow | **UNBLOCKED** | Build `finance_record` with `type` discriminator. Merge POs, payment requests, invoices, VOs. Smart import writes to `finance_record` with change detection (C4 confirmed). `program_expense`/`program_inflows` become read-only reporting views. | Wave 5 |
| B4 | `project_instance` split axis mismatch | **A project is a project, metadata describes it** | **UNBLOCKED** | Rename `projectInfo` → `project_instance` (identity). Descriptive fields (sizeKwp, deliveryModel, contractValue) become `project_info` metadata. `projectExecutionState` key dates fold into stage lifecycle over time (R5 confirmed). | Wave 2 |
| B5 | No `approval_requirement` split | **Both templates and one-offs** | **UNBLOCKED** | Build `approval_requirement` (reusable templates) + `approval_instance` (events). Support ad-hoc approvals with null requirement FK. | Wave 4 |
| B6 | No `deliverable_definition` split | **Both templates and one-offs** | **UNBLOCKED** | Build `deliverable_definition` (templates) + `deliverable_instance` (project-specific). Support ad-hoc deliverables. Migrate QC templates into new structure (C5 confirmed). | Wave 4 |
| B7 | No `work_package` entity | **Both work packages and tasks needed** | **UNBLOCKED** | Build `work_package` as first-class entity above `work_item`. Keep parent/child within work_items. | Wave 2 |

**All 7 blockers are now UNBLOCKED.** Decisions are sufficient to begin schema design for every wave.

---

### RISKS — Status after decisions

| # | Original risk | Decision | New status | Residual risk |
|---|-------------|----------|-----------|--------------|
| R1 | Opportunity model mismatch | **Keep Pipedrive integration, keep opportunities table** | **MITIGATED** | Align FKs to spine (party, site). Pipedrive sync stays functional. Low residual risk. |
| R2 | Budget baseline incomplete | **Investigated.** Table exists with header-only fields (revenue/COS/margin baselines, versioning, lock/approval). Routes exist in `budget-baseline-routes.ts` (GET, POST, lock). | **MITIGATED — needs line items** | Existing header is sufficient for Wave 2. Add `budget_baseline_line` in Wave 5 for category-level variance. No blocker. |
| R3 | Site/portfolio rule undecided | **One project = one site** | **RESOLVED** | Add unique constraint on `project_instance.siteId`. No portfolio entity needed (Portfolio = tab under Project Management). |
| R4 | Permission model fragmented | **Simplify and fix — make roles and permissions work properly** | **MITIGATED — significant work** | Full consolidation: merge 3 systems into one. Elevated to Wave 1 priority. This is the highest-risk item remaining. |
| R5 | projectExecutionState split axis | **Execution state = PM dates, lifecycle = company lens. Can be incorporated.** | **RESOLVED** | Key dates migrate into stage lifecycle. projectExecutionState becomes compatibility view, demoted in Wave 6. |
| R6 | Legacy route proliferation | **Ongoing work, known issue** | **ACCEPTED** | Flag stale routes as encountered per wave. No preemptive cleanup. |
| R7 | Frontend nav mismatch (11 vs 8) | **HSE→PM, Reports→per dept, Portfolio→PM tab, Priorities stays** | **RESOLVED** | 9 top-level items: Home, Priorities, PD, PM (+HSE +Portfolio tabs), Engineering, Quality, Finance, Parties, Admin. Reports distributed. |
| R8 | No activity/audit log split | **Both needed** | **UNBLOCKED** | Build `activity_log` (human-readable) + `audit_log` (technical). Wave 2 work. |

**6 of 8 risks resolved. 2 mitigated (R2 needs line items in Wave 5, R4 needs significant permissions work in Wave 1).**

---

### CLARIFICATIONS — All resolved

| # | Question | Decision | Action |
|---|----------|----------|--------|
| C1 | Work package table needed? | **Yes, both** (same as B7) | Build `work_package` table. |
| C2 | PD tickets fate | **PD tickets = engineering intake requests, not deals** | Retain `pdTickets`. Link to `work_item` or `governed_process` as intake mechanism. Not the same as opportunities. |
| C3 | Handover record fate | **Becomes a governed process** | Migrate `projectPdPmHandover` → `governed_process` type='pd_pm_handover'. Old table becomes compatibility, retired Wave 6. |
| C4 | Smart import write target | **Write to `finance_record`, change detection only** | Smart import creates/updates `finance_record` entries. `program_expense`/`program_inflows` become read-only views. |
| C5 | QC template hierarchy | **Migrate to new structure, same functionality** | QC templates migrate into `deliverable_definition` / `approval_requirement` pattern. Same functionality, new tables. Wave 4. |
| C6 | Stage lifecycle adopt or simplify? | **Adopt as-is** | Keep S01–S10 stage gate model. Rename to match control pack vocabulary. No flattening. |
| C7 | External resource/link tables | **Build from scratch** | New `external_resource` + `resource_link` tables for SharePoint, Teams, email linking. Wave 4–5. |
| C8 | Notifications | **Crucial but smarter — fewer, actionable only** | Redesign: kill noise, flag only actionable items (overdue, pending approval, blocked). |
| C9 | HSE / construction | **HSE: build out under PM. Construction: ignore, already covered.** | HSE module expands under Project Management. Construction tables retained as-is. |
| C10 | Gamification | **Ensure working** | Fix and retain leaderboard, badges, training, points. Don't retire. |

**All 10 clarifications resolved.**

---

### R2 Investigation: Budget Baseline Audit

**Existing table** (`shared/schema/finance.ts:1012`):
- `budget_baselines`: id, projectId, version, revenueBaseline, cosBaseline, marginBaseline, contingency, approvedByUserId, approvedDate, changeLocked, notes
- Unique constraint on (projectId, version) — supports versioning
- Lock mechanism: once approved, `changeLocked=true` prevents edits

**Existing routes** (`server/departments/budget-baseline-routes.ts`):
- `GET /api/budget-baselines?projectId=X` — fetch all versions for a project
- `POST /api/budget-baselines` — create new version (auto-increments)
- `POST /api/budget-baselines/:id/lock` — approve and lock a version

**Assessment:**
- **Header-level baseline: SUFFICIENT** for Wave 2. Revenue/COS/margin totals with versioning and approval workflow.
- **Missing for full variance control:** No `budget_baseline_line` table for category-level breakdown (e.g. "Panels: R200k budgeted"). Without this, variance reports can only show "project is R50k over budget" but not "panels are R30k over and labor is R20k over."
- **Recommendation:** Adopt existing table into core now. Add `budget_baseline_line` in Wave 5 when `finance_record` provides category-level actuals to compare against.

---

### Revised Summary

| Category | Original count | Resolved | Remaining |
|----------|---------------|----------|-----------|
| Blockers | 7 | **7** | **0** |
| Risks | 8 | **6 resolved, 2 mitigated** | **0 blocking** |
| Clarifications | 10 | **10** | **0** |

---

### WAVE 1 READINESS ASSESSMENT

| Prerequisite | Status | Notes |
|-------------|--------|-------|
| All Wave 0 decisions signed off | **READY** | All 5 open decisions have answers from Johannes |
| All blockers resolved for Wave 1 scope | **READY** | Wave 1 is shell + read contracts only — no new core entities needed |
| Navigation structure decided | **READY** | 9 top-level: Home, Priorities, PD, PM, Engineering, Quality, Finance, Parties, Admin |
| Permission approach decided | **READY** | Simplify and consolidate — elevated to Wave 1 priority |
| Rollback path clear | **READY** | Legacy screens and routes remain callable; feature flag controls new shell |
| Known risks for Wave 1 | **R4 (permissions)** | Highest-effort item in Wave 1. May need its own sub-wave. |

### VERDICT: READY TO START WAVE 1

No blockers remain. All design decisions are captured. The implementation prompts in Sections 3–8 of this document can be executed in sequence.

**Recommended first action:** Wave 1 Step 1 (Navigation Shell + Department Layout)

---

*Next section: Wave 0 Decision Briefs (updated with final answers)*

---

## Section 2: Wave 0 Decision Briefs

These five decisions must be documented and signed off by Johannes before Wave 1 can begin safely. For each, I provide the trade-offs, a recommended default, and downstream impact.

---

### Decision 1: Do PD opportunities become `project_instance` early?

**Current state:** The `opportunities` table exists (`shared/schema/projects.ts:69`) with its own lifecycle (prospect → qualification → proposal → negotiation → won → lost), Pipedrive integration, and handover readiness tracking. `projectInfo` has an `opportunityId` FK linking won deals to projects.

**Option A — Keep opportunity as a separate pre-project entity**
- Opportunities stay in their own table with their own lifecycle
- When a deal is won, a `project_instance` row is created and linked via FK
- PD dashboard queries opportunities directly; PM dashboard never sees them
- *Pro:* Clean separation. PD can manage pipeline without polluting project lists. Pipedrive sync stays isolated.
- *Con:* Two entities to maintain. Handover becomes a data-copy event. Any PD work done pre-signature (site assessments, proposals) lives in opportunity-land and must be re-linked after conversion.

**Option B — Every serious PD item becomes a `project_instance` early (with a pre-signature phase)**
- Opportunities are absorbed into project_instance with phases like `PROSPECT`, `QUALIFICATION`, `PROPOSAL`, `NEGOTIATION` before the existing S01–S10 lifecycle kicks in
- The `opportunities` table becomes a compatibility view or is retired
- *Pro:* One entity from cradle to grave. No data-copy at handover. All history lives on one project timeline.
- *Con:* Project lists get cluttered with prospects. Pipedrive sync must write to project_instance. Phase model gets more complex. Lost deals remain as dead project rows.

**Option C — Hybrid: opportunity table stays but shares party/site FKs with core spine**
- Keep `opportunities` but ensure it uses `party` (not `clients`) and `site` FKs from the spine
- When won, create project_instance and set `opportunityId` FK (current pattern)
- *Pro:* Minimal disruption. Existing PD dashboard and Pipedrive routes keep working. Clean handover point.
- *Con:* Still two entities. But the FK alignment makes the bridge thinner.

**DECIDED: Option C (Hybrid) — APPROVED by Johannes**
Johannes confirmed: keep Pipedrive integration working, keep opportunities table. Align FKs to spine.

**Downstream impact (updated):**
- Wave 2: `project_instance` schema doesn't need pre-signature phases. `opportunities` aligned to spine FKs (party, site).
- Wave 1–2: PD dashboard keeps reading from opportunities table. Pipedrive integration stays functional.
- Wave 3: PD→PM handover becomes `governed_process` type='pd_pm_handover', reads opportunity + creates project_instance.

---

### Decision 2: Do we need budget baseline in core?

**Current state:** `budget_baselines` table exists (`shared/schema/finance.ts:1012`) with fields: projectId, version, contractValue, totalBudget, contingencyPct, marginTarget, approvedBy, approvedAt, notes. `projectExecutionState` also has `costBaseline` and `marginBaseline` quick-reference fields.

**Option A — Existing `budget_baselines` table is sufficient; adopt into core**
- Rename/adopt the existing table as the canonical budget baseline
- Add line-level breakdown (budget_baseline_line) for category-level variance tracking
- Wire variance computations: actual spend (from finance_record) vs baseline
- *Pro:* Already exists. Low effort. Can be enriched incrementally.
- *Con:* Current table is header-only (no line items). Variance control against total is coarse.

**Option B — Add `budget_baseline` + `budget_baseline_line` as new core entities**
- Header: project, version, approved totals, approval status
- Lines: category, amount, unit rate, qty — matching the structure of `program_expense` categories
- Variance computed as: baseline line amount vs actual finance_record amounts by category
- *Pro:* Granular variance and margin control. Supports "where did the budget blow out?" analysis.
- *Con:* More schema work. Must map existing program_expense categories to baseline line categories.

**Option C — Defer to Wave 5; use `projectExecutionState.costBaseline` as interim**
- Quick-reference fields already exist. Use them for basic margin tracking.
- Build proper baseline when finance_record lands in Wave 5.
- *Pro:* Zero effort now.
- *Con:* No formal approval workflow on baseline. No line-level control. Margin tracking stays fuzzy through Waves 2–4.

**DECIDED: Option A with enrichment plan — APPROVED by Johannes**
Investigation confirmed: existing table has header-level fields (revenue/COS/margin baselines, versioning, lock/approval) and working routes. Adopt into core now, add line items in Wave 5.

**Downstream impact (updated):**
- Wave 2: `budget_baselines` adopted into core spine, linked to project_instance. Existing routes retained.
- Wave 5: `budget_baseline_line` added for category-level variance against `finance_record` actuals.
- Wave 3: Governed processes (financial review) reference budget baseline for approval context.

---

### Decision 3: Do we need multi-assignee?

**Current state:** `work_items` has `ownerUserId` (single owner) + `ownerName` (denormalized display). Engineering deliverables have `ownerUserId`, `reviewerUserId`, `qcReviewerUserId` (three named roles). Approvals have `requestedBy`, `decidedBy`, `assignedApprover`.

**Option A — Single owner is sufficient; use work_item comments/mentions for collaboration**
- Keep `ownerUserId` as the sole assignee on work_items
- Reviewer/QC roles stay on deliverables only (domain-specific, not generic)
- *Pro:* Simple. Clear accountability. No join table overhead.
- *Con:* Cannot assign support roles (reviewer, contributor, watcher) to generic work items.

**Option B — Add `work_item_assignment` join table**
- Schema: work_item_id, user_id, assignment_role (owner, reviewer, contributor, watcher), assigned_at, assigned_by
- `ownerUserId` stays as quick-reference but `work_item_assignment` is authoritative for role=owner
- *Pro:* Supports teams, handoffs, and "who needs to act?" queries across roles.
- *Con:* Every work_item query that filters by "my work" needs a join. Adds migration complexity.

**Option C — Add generic `entity_assignment` table (polymorphic)**
- Schema: entity_type (work_item, deliverable, governed_process, etc.), entity_id, user_id, role, assigned_at
- One table for all assignment patterns across the spine
- *Pro:* Maximum flexibility. "My work" dashboard can query one table for everything assigned to me.
- *Con:* Polymorphic FKs are harder to enforce. Index strategy more complex. Violates the "don't make governed_process a junk drawer" spirit.

**DECIDED: Option B (work_item_assignment) — APPROVED by Johannes**
Johannes confirmed: both work packages and tasks needed. `work_item_assignment` table already exists in the schema (`shared/schema/tasks.ts`). Build `work_package` as first-class entity above `work_item`.

**Downstream impact:**
- Wave 2: `work_item_assignment` table created alongside work_item migration
- Wave 1: Home dashboard "my work" query joins through work_item_assignment
- Wave 4: Deliverables keep their own reviewer/QC fields (no change)

---

### Decision 4: How are permissions modeled?

**Current state:** Three overlapping systems:
1. **Code-level role groups** (`shared/schema/users.ts:100–129`): `FINANCE_VIEW_ROLES`, `ENG_EDIT_ROLES`, etc. — static arrays checked in middleware
2. **`rolePermissions` DB table** (`shared/schema/users.ts:1276`): JSON maps of entity → action permissions per role, editable via Admin UI
3. **`workstreamVisibilityConfig`** (`shared/schema/users.ts:1374`): Per-role/user UI filtering for workstreams, ticket types, sections

**Option A — Consolidate into `rolePermissions` DB table only**
- Remove code-level role group arrays. All permission checks read from `rolePermissions` table.
- Keep `workstreamVisibilityConfig` as a UI-only filter (not authorization).
- Add user-level overrides via existing `userPermissionOverrides` table.
- *Pro:* Single source of truth. Admin can change permissions without code deploy.
- *Con:* Must migrate all code-level checks. Risk of breaking existing middleware.

**Option B — Add `permission_definition` + `role_permission` + user override**
- New normalized tables: `permission_definition` (entity, action, label), `role_permission` (role, permission_id, granted), `user_permission_override` (user_id, permission_id, granted)
- Replace JSON permission maps with relational model
- *Pro:* Clean, queryable, auditable. Can enforce at API layer with middleware.
- *Con:* Significant schema change. Must migrate existing JSON permissions.

**Option C — Keep current hybrid; add enforcement middleware**
- Keep code-level groups for compile-time safety
- Keep DB table for runtime admin overrides
- Add a unified `checkPermission(userId, entity, action)` middleware that checks both
- *Pro:* Minimal migration. Additive only.
- *Con:* Two sources of truth remain. Drift risk between code arrays and DB records.

**DECIDED: Option A (full consolidation) — OVERRIDDEN by Johannes**
Johannes directed: "Simplify, fix, and make the roles and permissions working." This overrides the conservative recommendation. Full consolidation into `rolePermissions` DB table as single source of truth. Code-level arrays removed. Elevated to Wave 1 priority.

**Downstream impact (updated — full consolidation):**
- Wave 1: Full permission consolidation. Merge code-level arrays + DB table + workstream visibility into one `rolePermissions` DB-driven model.
- Wave 1: `checkPermission` middleware added; all routes (new AND legacy) use unified enforcement.
- Wave 2–6: Every endpoint enforces permissions via single model. No dual sources of truth.
- Admin UI for managing role permissions becomes critical path in Wave 1.

---

### Decision 5: Is one project always one site?

**Current state:** `projectInfo.siteId` is a nullable FK to `sites`. Multiple projects can reference the same site. Sites are linked to clients. A `portfolios` page exists in the frontend but the schema is unclear (no portfolios table found in schema files — may be a view or computed grouping).

**Option A — One project, one site (enforce 1:1)**
- Add unique constraint on `project_instance.siteId`
- Site is part of project identity, not shared infrastructure
- Portfolio = grouping of projects by client or geography (computed, not a table)
- *Pro:* Simple. No ambiguity about which project "owns" a site.
- *Con:* Clients with multiple projects at the same physical location need duplicate site records.

**Option B — Many projects, one site (current pattern, keep as-is)**
- Sites are shared resources. Multiple projects can operate at the same site.
- Portfolio = grouping of projects by site, client, or region
- *Pro:* Matches reality (a large commercial campus may have Phase 1, Phase 2, Phase 3 as separate projects at one site).
- *Con:* Must handle site-level aggregations carefully (total kWp at site, etc.).

**Option C — Add explicit `portfolio` entity above projects**
- `portfolio` table: id, name, client_id, description, status
- `project_instance.portfolioId` FK
- Sites remain linked to projects (many:1)
- *Pro:* Clean grouping for programme-level reporting. Maps to real business concept.
- *Con:* Another entity. Must decide if portfolio is per-client or per-geography.

**DECIDED: Option A (1:1 project-site) — OVERRIDDEN by Johannes**
Johannes directed: "One project = one site." Enforce unique constraint on project_instance.siteId. No separate portfolio entity — portfolio becomes a filtered view/tab under Project Management.

**Downstream impact (updated — 1:1 site, no portfolio entity):**
- Wave 2: `project_instance.siteId` gets unique constraint (1:1 enforcement)
- Wave 1: Portfolio page becomes a filtered project list tab under Project Management — no new entity needed
- Wave 2: Sites that currently have multiple projects may need data cleanup (duplicate site records created per project)
- Wave 5–6: No portfolio-level aggregation entity. Group by client or site for programme reporting.

---

### Decision Summary — SIGNED OFF

| # | Decision | Final answer (Johannes) | Implementation action |
|---|----------|----------------------|---------------------|
| D1 | Opportunity/deal handling | **Keep Pipedrive integration, keep opportunities table** | Retain `opportunities`. Align FKs to spine (party, site). Pipedrive sync stays. Handover creates `project_instance` + `governed_process`. |
| D2 | Budget baseline | **Adopt existing table; add line items in Wave 5** | `budget_baselines` adopted into core (Wave 2). `budget_baseline_line` added in Wave 5 for category-level variance. |
| D3 | Assignment model | **Both work packages and tasks needed** | Build `work_package` as first-class entity. `work_item_assignment` already exists in schema. |
| D4 | Permission model | **Simplify and fix — make it work properly** | Full consolidation of 3 overlapping systems into one clean model. Elevated to Wave 1 priority. |
| D5 | Site/portfolio rule | **One project = one site. Portfolio = tab under PM.** | Enforce 1:1 project-site. No separate portfolio entity. Portfolio view = filtered project list under PM department. |

---

*Next section: Wave 1 Implementation Prompts*

---

## Section 3: Wave 1 — Shell + Control Pack Live

**Cutover map summary:**
- Frontend: New top nav, department shells, project workspace header, parties shell, admin migration view
- Compatibility: Read-first contracts only
- Rollback: Legacy screens and routes still callable
- Done when: Frontend shell is stable and usable without data loss

---

### Wave 1 — Step 1: Navigation Shell + Department Layout

**Depends on:** Wave 0 decisions signed off
**Rollback:** Legacy screens and routes still callable — current AppLayout and page-registry remain untouched until new shell is proven
**Guardrails:** [1] Do not let new frontend pages call random legacy routes. [5] Do not sign off on UI polish if the write authority is still fuzzy underneath.

```
PROMPT:

You are migrating the Emergent Energy web app frontend to a department-based navigation shell.

CONTEXT:
- Current navigation uses 11 APP_SECTIONS defined in shared/schema/users.ts:158-185
- Current routing uses wouter in client/src/App.tsx with PAGE_REGISTRY from client/src/config/page-registry.ts
- Current layout is in client/src/components/layout/AppLayout.tsx
- Target navigation has 9 top-level items (revised per Johannes): Home, Priorities, Project Development, Project Management (+HSE tab +Portfolio tab), Engineering, Quality, Finance, Parties, Admin. Reports distributed into each department section.

TASK:
1. Create a new navigation config file at client/src/config/department-nav.ts that defines the 9 target departments, each with:
   - key, label, icon, basePath
   - Sub-navigation items (mapped from current PAGE_REGISTRY entries)
   - Tab items where applicable (PM has HSE tab and Portfolio tab)
   - Required permission entity for access control

2. Create a new layout wrapper at client/src/components/layout/DepartmentShell.tsx that:
   - Renders a top nav bar with the 9 department tabs
   - Shows sub-navigation within each department
   - Uses the existing useAccessMatrix() hook for permission gating
   - Falls back to current AppLayout if a feature flag DEPARTMENT_SHELL_ENABLED is false

3. Add DEPARTMENT_SHELL_ENABLED to shared/feature-flags.ts (default: false)

4. Update client/src/App.tsx to conditionally use DepartmentShell when the flag is on, keeping all existing routes working

5. Map every existing page to its target department (revised per Johannes's nav decisions):
   - Home: home, my-work-*, inbox, dashboard
   - Priorities: priorities, priority-detail, department-scores
   - Project Development: pd-*, opportunities, clients, client-detail, PD reports
   - Project Management: pm-*, execution-board, weekly-reviews, milestone-tracker, PM reports, +HSE tab (hse-*), +Portfolio tab (portfolios, portfolio-detail)
   - Engineering: engineering-*, standups, engineering reports
   - Quality: qm-dashboard, quality/*, commissioning-*
   - Finance: cashflow, revenue-tracker, cos, gp-tracker, financial-*, payment-*, po-*, invoice-*, finance reports
   - Parties: counterparties, subcontractor-dashboard, sites
   - Admin: admin-*, smart-import, database-migration, system-activity-log, role-settings

DO NOT:
- Remove any existing routes or pages
- Change any existing API calls
- Wire new department shells to new API contracts yet (those come in later steps)
- Break the existing AppLayout — it must remain as fallback

VERIFY:
- Feature flag off: app behaves exactly as before
- Feature flag on: all 8 department tabs render, all existing pages accessible under their new department grouping
- No console errors, no broken links
- Permission gating works: users without Finance access don't see Finance tab
```

---

### Wave 1 — Step 2: Project Workspace Header (Read-Only)

**Depends on:** Wave 1 Step 1
**Rollback:** Legacy project-detail page still accessible at /projects/:id
**Guardrails:** [1] New screen must use a locked contract, not random legacy routes. [5] Read-only first — no write authority until core objects are migrated.

```
PROMPT:

You are building the Project Workspace Header — a shared component that appears at the top of every project-scoped page across all departments.

CONTEXT:
- Current project detail page: client/src/pages/project-detail.tsx
- Current project data comes from GET /api/projects/:id (server/routes/projects.routes.ts)
- Target API contract (Control Map 4): GET /api/projects/:id/workspace-summary
- The workspace header shows: project name, code, phase, client, PM, PD, key dates, health status
- This is READ-ONLY in Wave 1. Writes come in Wave 2.

TASK:
1. Create a new API endpoint GET /api/projects/:id/workspace-summary in server/routes/projects.routes.ts that returns:
   {
     id, projectName, projectCode, phase, clientName, pmName, pdName,
     sizeKwp, contractValue, deliveryModel,
     keyDates: { pdHandover, constructionStart, commissioning, clientHandover },
     health: { onTrack: boolean, openBlockers: number, completionPct: number }
   }
   - Read from projectInfo + projectExecutionState + clients (via JOIN)
   - Health data computed from projectExecutionState fields
   - This is a COMPATIBILITY read: it reads from current tables but shapes data for the target contract

2. Create client/src/components/project/ProjectWorkspaceHeader.tsx that:
   - Calls GET /api/projects/:id/workspace-summary via react-query
   - Renders project identity, phase badge, key dates, health indicators
   - Is designed to be embedded at the top of any project-scoped department page
   - Falls back gracefully if the endpoint returns an error (show existing project-detail header)

3. Wire ProjectWorkspaceHeader into project-detail.tsx as an optional replacement for the current header section (controlled by DEPARTMENT_SHELL_ENABLED flag)

DO NOT:
- Create any new write endpoints
- Modify the existing GET /api/projects/:id response shape
- Change projectInfo or projectExecutionState schema
- Call any legacy routes from the new component

VERIFY:
- GET /api/projects/:id/workspace-summary returns correct data for 3+ test projects
- Component renders cleanly inside project-detail page
- No regression on existing project-detail page functionality
- Loading and error states handled
```

---

### Wave 1 — Step 3: Parties Shell (Read-Only)

**Depends on:** Wave 1 Step 1
**Rollback:** Current clients, counterparties, subcontractor pages still accessible
**Guardrails:** [1] Locked contract only. [5] Read-only until party entity exists in Wave 2.

```
PROMPT:

You are building the Parties department shell — a unified view of all business relationships.

CONTEXT:
- Current state: separate pages for clients (client/src/pages/clients.tsx), counterparties (counterparties.tsx), subcontractors (subcontractor-dashboard.tsx)
- Current data: clients table, counterparties table (finance.ts), users table
- Target (Control Map 3): Parties department shows party registry with kind/role filters
- Target API (Control Map 4): GET /api/parties, GET /api/parties/:id
- The party entity doesn't exist yet (Wave 2). This step creates a READ-ONLY compatibility endpoint that UNIONS existing tables.

TASK:
1. Create GET /api/parties endpoint in a new server/routes/parties.routes.ts that:
   - UNIONs clients, counterparties, and users (filtered to external contacts) into a unified response
   - Each row returns: { id, sourceTable, sourceId, name, kind (client/supplier/subcontractor/internal), status, primaryContact, email, phone, projectCount }
   - kind is derived: clients → 'client', counterparties → mapped from counterparty_type, users with specific roles → 'internal'
   - This is explicitly a COMPATIBILITY read — it does NOT create a party table yet

2. Create GET /api/parties/:id endpoint that returns detail for a specific party (routed to the correct source table based on sourceTable parameter or path)

3. Create client/src/pages/parties-registry.tsx that:
   - Calls GET /api/parties
   - Shows a unified table with columns: Name, Kind, Status, Primary Contact, Projects
   - Filterable by kind (client, supplier, subcontractor, internal)
   - Searchable by name
   - Click-through navigates to existing detail pages (client-detail, counterparty detail, etc.)

4. Register the new page under the Parties department in the department nav config

DO NOT:
- Create the party table (that's Wave 2)
- Add any write endpoints for parties
- Modify existing clients, counterparties, or subcontractor pages
- Remove any existing routes

VERIFY:
- GET /api/parties returns unified list from all three source tables
- Parties registry page renders and filters correctly
- Click-through to existing detail pages works
- No data loss or duplication in the unified view
```

---

### Wave 1 — Step 4: Home Dashboard (Read-Only)

**Depends on:** Wave 1 Step 1
**Rollback:** Current home.tsx and my-work pages still accessible
**Guardrails:** [1] Locked contract. [5] Read-only writes come later.

```
PROMPT:

You are building the Home dashboard — a cross-role attention cockpit.

CONTEXT:
- Current state: home.tsx + my-work-home.tsx + my-work-tasks.tsx + inbox.tsx + my-work-priorities.tsx
- Target (Control Map 3): Home shows my tasks, approvals, meetings, alerts filtered by logged-in party
- Target API (Control Map 4): GET /api/home/summary, supporting reads from /api/my-work + /api/my-approvals
- Current backend: work items via task-management-routes.ts, approvals via approvals-routes.ts

TASK:
1. Create GET /api/home/summary endpoint in a new server/routes/home-summary.routes.ts that returns:
   {
     myTasks: { overdue: number, dueToday: number, inProgress: number, total: number },
     myApprovals: { pending: number, urgent: number },
     upcomingMeetings: [ { title, date, projectName } ] (from meetings table if exists, else empty),
     alerts: [ { type, message, severity, linkedEntityType, linkedEntityId } ],
     recentActivity: [ { action, entity, timestamp } ]
   }
   - Filter all data by the authenticated user's ID
   - Tasks from work_items where ownerUserId = current user
   - Approvals from approvals where assignedApprover = current user AND status = 'pending'
   - Alerts computed from: overdue tasks, expiring approvals, blocked work items

2. Create client/src/components/home/HomeDashboardV2.tsx that:
   - Calls GET /api/home/summary
   - Renders cards: My Tasks (with overdue highlight), Pending Approvals, Upcoming Meetings, Recent Alerts
   - Each card links to the relevant detail page
   - Responsive for mobile

3. Wire HomeDashboardV2 into the Home department shell (shown when DEPARTMENT_SHELL_ENABLED is on)

DO NOT:
- Replace the existing home.tsx — keep it as fallback
- Add write endpoints
- Change work_items or approvals schema

VERIFY:
- GET /api/home/summary returns correct counts for the test user
- Dashboard renders all cards
- Links navigate to correct pages
- Empty states handled (no tasks, no approvals, etc.)
```

---

### Wave 1 — Step 5: Admin Migration Control View

**Depends on:** Wave 1 Step 1
**Rollback:** Current admin-control-center.tsx and database-migration.tsx still accessible
**Guardrails:** [1] Locked contract. [4] Every bridge object tracked must have an exit trigger visible.

```
PROMPT:

You are building the Admin Migration Control view — the control tower for tracking migration progress.

CONTEXT:
- Current state: admin-control-center.tsx, database-migration.tsx, smart-import pages
- Import infrastructure: import_batch/legacy_id_map pattern referenced in control pack
- Target API (Control Map 4): GET /api/admin/migration-status, GET /api/admin/unresolved-mappings, POST /api/admin/backfill-run
- The smart_import_runs table exists (shared/schema/imports.ts) but there's no legacy_id_map table yet

TASK:
1. Create the legacy_id_map table in a new migration file:
   - Schema: id, source_table, source_id, target_table, target_id, mapped_at, mapped_by, status (mapped/pending/conflict/retired)
   - Add to shared/schema/imports.ts
   - This table will be populated during Wave 2+ as entities are migrated

2. Create GET /api/admin/migration-status endpoint:
   - Returns per-entity migration progress: { entity: string, totalLegacyRows: number, mappedRows: number, pendingRows: number, conflictRows: number }
   - Initially returns counts for: clients, counterparties, users, projectInfo, workItems, approvals, deliverables
   - Queries source tables for totals, legacy_id_map for mapped counts

3. Create GET /api/admin/unresolved-mappings endpoint:
   - Returns rows from legacy_id_map where status = 'pending' or 'conflict'
   - Paginated, filterable by source_table

4. Create POST /api/admin/backfill-run endpoint:
   - Placeholder that logs the request and returns { status: 'queued', message: 'Backfill not yet implemented' }
   - Will be wired to actual backfill logic in Wave 2

5. Create client/src/pages/admin-migration-control.tsx:
   - Dashboard showing migration progress per entity (progress bars)
   - Table of unresolved mappings with filtering
   - "Run Backfill" button (calls POST /api/admin/backfill-run)
   - Wave progress tracker showing Wave 0–6 status (manually configured for now)

6. Register under Admin department in nav config

DO NOT:
- Actually run any data migration yet
- Modify existing import tables
- Remove existing admin pages

VERIFY:
- legacy_id_map table created via migration
- GET /api/admin/migration-status returns correct counts (all zeros for mapped initially)
- Admin page renders with progress indicators
- Backfill button responds with queued status
```

---

### Wave 1 — Step 6: Permission System Consolidation + Enforcement Middleware

**Depends on:** Wave 0 Decision 4 signed off (Johannes directed: FULL CONSOLIDATION)
**Rollback:** Existing middleware continues to work; old code-level arrays retained as dead code until verified
**Guardrails:** [1] All API contracts (new AND legacy) must use this middleware. [5] Write authority must be clear.

```
PROMPT:

You are consolidating and fixing the permission system. Johannes directed: "Simplify, fix, and make the roles and permissions working." This is a FULL CONSOLIDATION, not an additive middleware.

CONTEXT:
- Current permission systems (see Gap Analysis R4):
  1. Code-level role groups in shared/schema/users.ts (FINANCE_VIEW_ROLES, ENG_EDIT_ROLES, etc.) — static arrays
  2. rolePermissions DB table with JSON permission maps — editable via admin UI
  3. workstreamVisibilityConfig for UI filtering — per-role/user overrides
- These three systems overlap, sometimes conflict, and make permission debugging hard.
- Current middleware: server/permission-middleware.ts, server/workstream-visibility-middleware.ts
- Decision 4 outcome: FULL CONSOLIDATION into rolePermissions DB table as single source of truth

TASK:
1. Audit all code-level role group arrays in shared/schema/users.ts:
   - FINANCE_VIEW_ROLES, FINANCE_EDIT_ROLES, ENG_VIEW_ROLES, ENG_EDIT_ROLES,
     QUALITY_HSE_VIEW_ROLES, QUALITY_HSE_EDIT_ROLES, DELIVERY_VIEW_ROLES,
     PD_VIEW_ROLES, PD_EDIT_ROLES, ALL_STAFF_ROLES, ADMIN_ROLES
   - For each, ensure the equivalent permission grants exist in the rolePermissions DB table
   - Create a migration seed that backfills rolePermissions rows for any missing grants

2. Create server/middleware/check-permission.ts that exports:
   - checkPermission(entity: PermissionEntity, action: PermissionAction) — Express middleware
   - Implementation:
     a. Get user from req (via existing auth context)
     b. Query rolePermissions DB table for the user's role + entity + action
     c. Check userPermissionOverrides for user-specific grants/denials
     d. Return 403 with { error: 'Forbidden', entity, action, role } if denied
     e. Cache permission lookups with 60-second TTL (matching existing pattern)
   - Log permission checks to audit when action is 'approve', 'override', or 'delete'
   - DO NOT check code-level arrays — DB is sole source of truth

3. Create server/middleware/require-auth.ts that:
   - Validates session/JWT
   - Attaches user to req.user
   - Returns 401 if not authenticated
   - Wraps existing auth-context.ts logic into reusable middleware

4. Update the 5 new endpoints created in Steps 2–5 to use checkPermission

5. Deprecate code-level role arrays:
   - Add @deprecated JSDoc comments to all arrays in users.ts
   - DO NOT delete them yet — they stay as dead code until all legacy routes are migrated
   - Ensure workstreamVisibilityConfig only controls UI filtering, not authorization

6. Update Admin Roles page to ensure rolePermissions can be managed:
   - Verify that the existing admin-roles.tsx page allows editing role → entity → action grants
   - If not, add the missing CRUD for rolePermissions

VERIFY:
- All 5 new endpoints enforce permissions via DB-only checks
- 403 response includes entity/action/role for debugging
- Audit log entries created for sensitive actions
- Existing routes still work (they may still use old middleware temporarily)
- Admin can add/remove permission grants via UI without code deploy
- rolePermissions table has complete coverage for all 16 company roles
```

---

### Wave 1 — Step 7: Verification & QA Checklist

**Depends on:** Wave 1 Steps 1–6
**Rollback:** N/A (this is validation only)
**Guardrails:** All five non-negotiable rules checked.

```
PROMPT:

You are running the Wave 1 completion checklist. Verify every item below and report pass/fail with evidence.

WAVE 1 DONE-WHEN CRITERIA (from Cutover Map):
"Frontend shell is stable and usable without data loss"

CHECKLIST:

1. SHELL STABILITY
   [ ] DepartmentShell renders all 9 department tabs (Home, Priorities, PD, PM, Engineering, Quality, Finance, Parties, Admin)
   [ ] PM department has HSE tab and Portfolio tab
   [ ] Every existing page is accessible under its mapped department
   [ ] Feature flag OFF: app behaves identically to pre-migration
   [ ] Feature flag ON: new shell works, no broken routes
   [ ] Mobile responsive: department tabs usable on small screens

2. READ CONTRACTS
   [ ] GET /api/projects/:id/workspace-summary returns valid data
   [ ] GET /api/parties returns unified client/counterparty/user list
   [ ] GET /api/home/summary returns correct per-user counts
   [ ] GET /api/admin/migration-status returns entity progress
   [ ] GET /api/admin/unresolved-mappings returns paginated results
   [ ] No new endpoint calls any legacy route internally (Guardrail 1)

3. DATA INTEGRITY
   [ ] No data was modified by any Wave 1 change
   [ ] legacy_id_map table exists with correct schema
   [ ] All new endpoints are read-only (except admin backfill placeholder)
   [ ] No analytical tables were touched (Guardrail 2)

4. PERMISSIONS (CONSOLIDATED — per Johannes directive)
   [ ] checkPermission middleware enforces access on all new endpoints via DB-only checks
   [ ] rolePermissions DB table has complete coverage for all 16 company roles
   [ ] Code-level role arrays deprecated (marked @deprecated, not deleted)
   [ ] Admin Roles page allows CRUD on rolePermissions without code deploy
   [ ] Unauthorized access returns 403 with structured error
   [ ] Unauthenticated access returns 401

5. COMPATIBILITY
   [ ] All existing routes still work
   [ ] All existing pages still render
   [ ] No database schema changes break existing functionality
   [ ] Import pipeline (smart import) unaffected

6. NON-NEGOTIABLE RULES
   [ ] Rule 1: No new frontend page calls a random legacy route ✓/✗
   [ ] Rule 2: No analytical tables moved into core ✓/✗
   [ ] Rule 3: No governed_process misuse (N/A for Wave 1) ✓
   [ ] Rule 4: legacy_id_map bridge has exit trigger documented ✓/✗
   [ ] Rule 5: No UI sign-off if write authority is fuzzy ✓/✗

Report results as a markdown table. Flag any failures as blockers for Wave 2.
```

---

*Next section: Wave 2 Implementation Prompts*

---

## Section 4: Wave 2 — Core Master Objects

**Cutover map summary:**
- Frontend + backend: party, project_instance, project_info, project_party_link, work_package, work_item
- Compatibility: Bridge old project/task routes
- Rollback: Fallback to current project/task routes
- Done when: Core objects can read/write without breaking current project operations

---

### Wave 2 — Step 1: Party Entity + Migration

**Depends on:** Wave 1 complete, Wave 0 Decision 1 (opportunity hybrid) signed off
**Rollback:** Fallback to current clients/counterparties/users routes. Party table can be dropped without affecting legacy.
**Guardrails:** [1] New party endpoints are the locked contract. [2] Do not move analytical tables into core.

```
PROMPT:

You are creating the unified party entity and migrating existing identity data into it.

CONTEXT:
- Current tables: users (shared/schema/users.ts), clients (shared/schema/projects.ts:14), counterparties (shared/schema/finance.ts)
- Entity Migration Map: users → Split to party + user_account + microsoft_identity + role_assignment; clients + counterparties + contacts → Merge to party + party_role + contact_method
- The Wave 1 GET /api/parties endpoint already UNIONs these tables for reads

TASK:

SCHEMA (create migration file + update shared/schema/):

1. Create party table:
   - id (serial PK), party_kind ('person'|'organization'), legal_name (text, not null), trading_name (text), status ('active'|'inactive'|'prospect'), created_at, updated_at, deleted_at
   - Index on party_kind, status

2. Create party_role table:
   - id (serial PK), party_id (FK→party), role_type ('client'|'supplier'|'subcontractor'|'internal_user'|'contact'|'investor'), is_active (boolean), granted_at, revoked_at
   - Unique constraint on (party_id, role_type)

3. Create contact_method table:
   - id (serial PK), party_id (FK→party), method_type ('email'|'phone'|'address'|'website'), value (text), label (text, e.g. 'primary', 'billing'), is_primary (boolean), created_at

4. Create project_party_link table:
   - id (serial PK), project_id (FK→projectInfo for now, will FK to project_instance later), party_id (FK→party), link_role ('client'|'pm'|'pd'|'subcontractor'|'investor'|'contact'), is_active (boolean), linked_at, linked_by (FK→users)

5. Create user_account table:
   - id (serial PK), party_id (FK→party, unique), username (text, unique), email (text, unique), password_hash (text), role (text), department (text), is_active (boolean), created_at, deleted_at
   - This absorbs identity fields from users table

6. Create microsoft_identity table:
   - id (serial PK), user_account_id (FK→user_account, unique), microsoft_id (text, unique), access_token (text), refresh_token (text), token_expires_at (timestamp), status ('active'|'disconnected'|'expired'), linked_at

DATA MIGRATION (in the same migration file, as SQL):

7. Backfill party from clients:
   - INSERT INTO party (party_kind, legal_name, trading_name, status) SELECT 'organization', name, trading_name, status FROM clients
   - INSERT INTO party_role (party_id, role_type, is_active) for each with role_type='client'
   - INSERT INTO contact_method for primary_contact_email, primary_contact_phone
   - INSERT INTO legacy_id_map (source_table, source_id, target_table, target_id, status) for each

8. Backfill party from counterparties:
   - Similar pattern, role_type mapped from counterparty_type enum

9. Backfill party + user_account from users:
   - INSERT INTO party (party_kind='person', legal_name=name)
   - INSERT INTO user_account (party_id, username, email, password_hash=password, role, department)
   - INSERT INTO microsoft_identity where microsoft_id is not null
   - INSERT INTO legacy_id_map

10. Backfill project_party_link from projectInfo:
    - For each project, create links for clientId→party (role='client'), pmUserId→party (role='pm'), pdUserId→party (role='pd')

API CONTRACTS:

11. Update GET /api/parties to read from party + party_role + contact_method (replacing the UNION compatibility query from Wave 1)

12. Create POST /api/parties:
    - Body: { partyKind, legalName, tradingName?, roles: [roleType], contacts: [{method, value, label}] }
    - Creates party + party_role + contact_method rows
    - Uses checkPermission('counterparties', 'create')

13. Create PATCH /api/parties/:id:
    - Updates party fields, can add/remove roles and contacts
    - Uses checkPermission('counterparties', 'edit')

14. Create POST /api/project-party-links:
    - Body: { projectId, partyId, linkRole }
    - Uses checkPermission('projects', 'edit')

15. Update GET /api/parties/:id to read from party tables with full detail

BRIDGE:
16. Keep existing clients, counterparties, users tables intact
17. Add a compatibility view or trigger that syncs writes TO party back to legacy tables (bridge-writer pattern)
18. Existing routes (GET /api/clients, etc.) continue to work reading from original tables

DO NOT:
- Drop or rename the users, clients, or counterparties tables
- Change the existing auth flow (it still reads from users table via bridge)
- Move any analytical/reporting tables

VERIFY:
- party table populated with all clients + counterparties + users
- legacy_id_map has entries for every migrated row
- GET /api/parties returns data from party table (not UNION)
- POST /api/parties creates correctly in party + syncs to legacy table
- Existing GET /api/clients still works
- Auth login still works (users table untouched or bridged)
```

---

### Wave 2 — Step 2: Project Instance + Project Info Split

**Depends on:** Wave 2 Step 1 (party entity exists for FKs)
**Rollback:** Fallback to current projectInfo + projectExecutionState reads
**Guardrails:** [1] New endpoints are locked contracts. [5] Write authority must be clear — project_instance is the master, project_info is descriptive.

```
PROMPT:

You are splitting the current project model into project_instance (master identity) and project_info (descriptive parameters).

CONTEXT:
- Current: projectInfo (shared/schema/projects.ts:100) has identity + descriptive fields; projectExecutionState (projects.ts:128) has lifecycle/dates
- Control pack target: project_instance (id, name, code, type, status, phase, clientPartyId, siteId, portfolioId) + project_info (configurable descriptive parameters per project type)
- Risk R5: The existing split axis (identity vs execution) differs from target (identity+status vs descriptive). Must reconcile.

TASK:

SCHEMA:

1. Create project_type table:
   - id (serial PK), code (text, unique), name (text), description (text), is_active (boolean), created_at
   - Seed with: 'SOLAR_EPC', 'SOLAR_PPA', 'CONSULTING', 'MAINTENANCE', 'HYBRID'

2. Create project_instance table:
   - id (serial PK), project_name (text, unique, not null), project_code (text, unique)
   - project_type_id (FK→project_type), client_party_id (FK→party), site_id (FK→sites)
   - portfolio_id (FK→portfolio, nullable — portfolio table from Decision 5)
   - phase (text), phase_updated_at (timestamp), phase_updated_by (FK→user_account)
   - status ('active'|'on_hold'|'completed'|'cancelled'), delivery_model (text)
   - pm_party_id (FK→party), pd_party_id (FK→party)
   - size_kwp (decimal), contract_value (decimal)
   - created_at, updated_at, deleted_at
   - NOTE: This absorbs identity fields from projectInfo AND phase fields from projectExecutionState

3. Create project_info_parameter_value table (key-value descriptive metadata):
   - id (serial PK), project_instance_id (FK→project_instance), parameter_key (text), parameter_value (text), updated_at, updated_by (FK→user_account)
   - Unique on (project_instance_id, parameter_key)
   - This replaces miscellaneous descriptive columns that vary by project type

4. Create portfolio table (if Decision 5 approved):
   - id (serial PK), name (text), client_party_id (FK→party), description (text), status ('active'|'archived'), created_at

DATA MIGRATION:

5. Backfill project_instance from projectInfo + projectExecutionState:
   - Map: projectInfo.projectName → project_instance.project_name
   - Map: projectInfo.projectCode → project_instance.project_code
   - Map: projectInfo.clientId → look up party via legacy_id_map → project_instance.client_party_id
   - Map: projectInfo.siteId → project_instance.site_id
   - Map: projectInfo.pmUserId/pdUserId → look up party → pm_party_id/pd_party_id
   - Map: projectExecutionState.phase → project_instance.phase
   - Map: projectInfo.sizeKwp, contractValue, deliveryModel → direct copy
   - INSERT INTO legacy_id_map for each

6. Migrate descriptive fields to project_info_parameter_value:
   - Fields like canonicalProjectId, opportunityId → parameter_value rows

API CONTRACTS:

7. Create GET /api/v2/projects/:id — returns project_instance + joined party names + site + portfolio
   (v2 prefix to distinguish from legacy GET /api/projects/:id)

8. Create PATCH /api/v2/projects/:id — updates project_instance fields
   - Uses checkPermission('projects', 'edit')
   - Syncs changes back to projectInfo via bridge writer

9. Update GET /api/projects/:id/workspace-summary (Wave 1) to read from project_instance instead of projectInfo

BRIDGE:
10. Create bridge writer: changes to project_instance sync back to projectInfo + projectExecutionState
11. Keep existing GET /api/projects/:id reading from projectInfo (legacy routes untouched)
12. Keep projectInfo and projectExecutionState tables — they become compatibility layer

DO NOT:
- Drop projectInfo or projectExecutionState tables
- Change existing GET /api/projects routes
- Move execution key dates out of projectExecutionState yet (they move when compatibility layer shrinks in Wave 6)

VERIFY:
- project_instance populated for all existing projects
- legacy_id_map entries exist for every project
- GET /api/v2/projects/:id returns correct data
- PATCH /api/v2/projects/:id updates project_instance AND syncs to projectInfo
- GET /api/projects/:id (legacy) still works
- Workspace header now reads from project_instance
```

---

### Wave 2 — Step 3: Work Engine Migration (work_package + work_item)

**Depends on:** Wave 2 Step 2 (project_instance exists)
**Rollback:** Fallback to current work_items routes
**Guardrails:** [1] Locked contracts. [3] Do not let governed_process leak into work engine. [5] Write authority clear.

```
PROMPT:

You are migrating the work engine to align with the target spine.

CONTEXT:
- Current: work_items table (shared/schema/tasks.ts:143) with parentId self-reference, ownerUserId single assignee
- Target: work_package (grouping container) + work_item (atomic tasks) + work_item_dependency + work_item_assignment
- Decision 3: Add work_item_assignment for multi-assignee
- Clarification C1: work_package can be modeled as work_items with is_package=true rather than a separate table (recommended to avoid breaking existing hierarchy)

TASK:

SCHEMA:

1. Add columns to work_items table (migration, not new table):
   - is_package (boolean, default false) — marks top-level work packages
   - project_instance_id (FK→project_instance, nullable) — new FK alongside existing projectId
   - Backfill: SET is_package = true WHERE parent_id IS NULL AND indent_level = 0

2. Create work_item_dependency table:
   - id (serial PK), predecessor_id (FK→work_items), successor_id (FK→work_items), dependency_type ('finish_to_start'|'start_to_start'|'finish_to_finish'|'start_to_finish'), lag_days (integer, default 0), created_at
   - Unique on (predecessor_id, successor_id)

3. Create work_item_assignment table:
   - id (serial PK), work_item_id (FK→work_items), user_account_id (FK→user_account), assignment_role ('owner'|'reviewer'|'contributor'|'watcher'), assigned_at (timestamp), assigned_by (FK→user_account), is_active (boolean)
   - Unique on (work_item_id, user_account_id, assignment_role)

DATA MIGRATION:

4. Backfill project_instance_id on work_items:
   - Look up project_instance via legacy_id_map where source_table='project_info' AND source_id=work_items.projectId

5. Backfill work_item_assignment from existing ownerUserId:
   - For each work_item with ownerUserId, create assignment (role='owner') looking up user_account via legacy_id_map

API CONTRACTS:

6. Create GET /api/projects/:id/work-packages:
   - Returns work_items WHERE project_instance_id = :id AND is_package = true
   - Includes nested work_items count, completion percentage

7. Create GET /api/projects/:id/work-items:
   - Returns work_items filtered by project_instance_id
   - Supports query params: ?package_id=, ?assignee=, ?status=, ?workstream=
   - Includes assignments (via JOIN to work_item_assignment)

8. Create POST /api/work-items:
   - Body: { projectInstanceId, title, parentId?, isPackage?, workstream, assignments: [{userId, role}] }
   - Creates work_item + work_item_assignment rows
   - Uses checkPermission('work_items', 'create')

9. Create PATCH /api/work-items/:id:
   - Updates work_item fields + manages assignments
   - Bridge: syncs ownerUserId from assignment where role='owner'

10. Create POST /api/work-items/:id/dependencies:
    - Body: { predecessorId, dependencyType, lagDays? }

BRIDGE:
11. Keep existing task-management-routes.ts, planning-tasks-routes.ts working
12. Bridge writer: new work_item writes sync ownerUserId back to work_items.ownerUserId for legacy route compatibility

DO NOT:
- Drop or rename the work_items table
- Remove existing task routes
- Use work_items for formal workflow tracking (that's governed_process in Wave 3)

VERIFY:
- is_package flag correctly set on top-level items
- work_item_assignment populated for all items with owners
- GET /api/projects/:id/work-packages returns correct groupings
- POST /api/work-items creates item + assignment
- Existing task-management routes still work
- My Work dashboard counts still correct (joining through assignment)
```

---

### Wave 2 — Step 4: Audit Log Split + Activity Log

**Depends on:** Wave 2 Step 1 (party/user_account exists)
**Rollback:** Existing audit_events table remains authoritative
**Guardrails:** [2] Do not move reporting data into core.

```
PROMPT:

You are splitting audit events into activity_log (human-readable) and audit_log (technical).

CONTEXT:
- Current: audit_events table, audit-logger.ts in server/
- Entity Migration Map: audit_events / activity feeds → Split to activity_log + audit_log
- Risk R8: No activity_log exists yet

TASK:

SCHEMA:

1. Create activity_log table:
   - id (serial PK), actor_party_id (FK→party), action (text, e.g. 'created_task', 'approved_handover'), entity_type (text), entity_id (integer), project_instance_id (FK→project_instance, nullable), summary (text — human-readable), metadata (jsonb), created_at
   - Index on (actor_party_id, created_at), (project_instance_id, created_at)

2. Create audit_log table:
   - id (serial PK), user_account_id (FK→user_account), action (text), table_name (text), row_id (integer), old_values (jsonb), new_values (jsonb), ip_address (text), user_agent (text), correlation_id (text), created_at
   - Index on (table_name, row_id), (user_account_id, created_at)

3. Backfill: Copy existing audit_events into audit_log with appropriate field mapping

4. Update audit-logger.ts to write to BOTH audit_log (technical) AND activity_log (human-readable) going forward

5. Update GET /api/home/summary to include recentActivity from activity_log
6. Create GET /api/admin/audit-log with filtering by table, user, date range

DO NOT:
- Drop audit_events table (retain temporarily)
- Change existing audit_events writes until all consumers are migrated

VERIFY:
- Both tables created and indexed
- Existing audit events migrated to audit_log
- New actions write to both logs
- Home dashboard shows recent activity
- Admin audit view works
```

---

### Wave 2 — Step 5: Frontend Wiring (PD, PM, Engineering, Parties)

**Depends on:** Wave 2 Steps 1–3 (party, project_instance, work engine all exist)
**Rollback:** Feature flag off reverts to legacy pages
**Guardrails:** [1] Department screens use only new API contracts. [5] Write paths tested.

```
PROMPT:

You are wiring the department frontend shells (from Wave 1) to the new Wave 2 API contracts.

CONTEXT:
- Wave 1 created department shells with read-only compatibility endpoints
- Wave 2 Steps 1-3 created: party API, project_instance API (v2), work engine API
- Department screens (Control Map 3):
  - Project Development: reads project_instance, party, governed_process (Wave 3), deliverable_instance (Wave 4)
  - Project Management: reads project_instance, work_package, work_item, governed_process (Wave 3)
  - Engineering: reads project_instance, work_package, work_item, deliverable_instance (Wave 4)
  - Parties: reads party, party_role, contact_method, project_party_link

TASK:

1. Update Parties Registry (client/src/pages/parties-registry.tsx):
   - Switch from compatibility UNION endpoint to GET /api/parties (now reads from party table)
   - Add "Create Party" button → modal calling POST /api/parties
   - Add inline edit → PATCH /api/parties/:id
   - Party detail page: show contact methods, roles, linked projects

2. Update Project Workspace Header:
   - Switch from compatibility endpoint to GET /api/v2/projects/:id
   - Show client as party name (from project_instance.client_party_id)
   - Show PM/PD as party names

3. Create PM Workboard (client/src/pages/pm-workboard.tsx):
   - Primary read: GET /api/projects/:id/work-items
   - Group by work package (is_package=true items)
   - Show assignments (multi-assignee badges)
   - Kanban view by status
   - Create/edit work items via POST/PATCH /api/work-items
   - Register under Project Management department

4. Update PD Dashboard (client/src/pages/pd-dashboard.tsx):
   - Add project party links display (GET /api/project-party-links?projectId=X)
   - Show client party info from party API
   - Keep existing opportunity/ticket reads (they bridge to legacy tables)

5. Engineering Dashboard:
   - Wire work items list to GET /api/projects/:id/work-items?workstream=Engineering
   - Show assignments from work_item_assignment

DO NOT:
- Remove existing page components (they stay as fallback when DEPARTMENT_SHELL_ENABLED is off)
- Wire to any endpoint not created in Wave 1 or Wave 2
- Build governed_process or deliverable screens (those are Wave 3 and Wave 4)

VERIFY:
- Parties registry: CRUD operations work end-to-end
- PM Workboard: work items display by package, assignments visible
- Project header: reads from project_instance
- PD dashboard: party links display
- Engineering: work items filtered by workstream
- All existing pages still work when feature flag is off
```

---

### Wave 2 — Step 6: Verification & QA Checklist

**Depends on:** Wave 2 Steps 1–5
**Rollback:** N/A (validation only)
**Guardrails:** All five rules checked.

```
PROMPT:

You are running the Wave 2 completion checklist.

WAVE 2 DONE-WHEN CRITERIA:
"Core objects can read/write without breaking current project operations"

CHECKLIST:

1. CORE ENTITIES
   [ ] party table exists with all clients, counterparties, users migrated
   [ ] party_role, contact_method, project_party_link populated
   [ ] user_account + microsoft_identity populated
   [ ] project_instance exists with all projects migrated
   [ ] project_info_parameter_value exists
   [ ] work_item_assignment populated for all work items with owners
   [ ] work_item_dependency table exists
   [ ] activity_log + audit_log exist and receiving writes
   [ ] legacy_id_map has entries for ALL migrated entities

2. API CONTRACTS
   [ ] GET/POST/PATCH /api/parties — full CRUD working
   [ ] GET/PATCH /api/v2/projects/:id — read/write working
   [ ] GET /api/projects/:id/work-packages — correct groupings
   [ ] GET/POST/PATCH /api/work-items — full CRUD with assignments
   [ ] All endpoints use checkPermission middleware

3. BRIDGE INTEGRITY
   [ ] Writing to party syncs back to clients/counterparties/users
   [ ] Writing to project_instance syncs back to projectInfo + projectExecutionState
   [ ] Writing to work_items via new API syncs ownerUserId for legacy compat
   [ ] All legacy GET routes return same data as before migration
   [ ] Auth login flow works (users table bridged)

4. FRONTEND
   [ ] Parties registry: CRUD working
   [ ] PM Workboard: displays, creates, edits work items
   [ ] Project workspace header reads from project_instance
   [ ] Feature flag off: zero regression

5. NON-NEGOTIABLE RULES
   [ ] Rule 1: No new page calls legacy routes ✓/✗
   [ ] Rule 2: Analytical tables untouched ✓/✗
   [ ] Rule 3: Work engine not used for formal workflows ✓/✗
   [ ] Rule 4: Bridge objects have exit triggers ✓/✗
   [ ] Rule 5: Write authority clear on every new endpoint ✓/✗

6. DATA INTEGRITY
   [ ] Row counts: party = clients + counterparties + users (no duplication, no loss)
   [ ] Row counts: project_instance = projectInfo (1:1)
   [ ] Row counts: work_item_assignment >= work_items with ownerUserId
   [ ] legacy_id_map: no 'conflict' status rows (or all documented)

Report results. Flag failures as blockers for Wave 3.
```

---

*Next section: Wave 3 Implementation Prompts*

---

## Section 5: Wave 3 — Governed Processes

**Cutover map summary:**
- Frontend + backend: financial_review, PD→PM handover, phase gate review, change request, payment batch
- Compatibility: Compatibility process wrappers
- Rollback: Fallback to legacy handover/review flows
- Done when: Formal workflows use one process engine

---

### Wave 3 — Step 1: Governed Process Schema + Engine

**Depends on:** Wave 2 complete (party, project_instance, work engine exist)
**Rollback:** Fallback to legacy handover/review flows — all existing route files remain
**Guardrails:** [3] governed_process is ONLY for formal controlled workflows — not normal work execution. [1] Locked contract.

```
PROMPT:

You are creating the governed_process entity — a single engine for all formal controlled workflows.

CONTEXT:
- Current separate implementations:
  - Financial review: server/financial-review-routes.ts
  - PD→PM handover: server/handover-routes.ts + shared/schema/handover.ts (handoverPacks table)
  - Phase gate review: server/stage-lifecycle-routes.ts + shared/schema/stage-lifecycle.ts
  - Change request: server/change-control-routes.ts
  - Payment batch: server/payment-batch-routes.ts
- Entity Migration Map: Merge into governed_process + governed_process_checklist_item
- Control Map 3 says governed_process is used by PD, PM, and Finance departments

TASK:

SCHEMA:

1. Create governed_process table:
   - id (serial PK)
   - process_type ('financial_review'|'pd_pm_handover'|'phase_gate_review'|'change_request'|'payment_batch'|'procurement_approval'|'deliverable_signoff')
   - project_instance_id (FK→project_instance)
   - initiated_by_party_id (FK→party)
   - assigned_to_party_id (FK→party, nullable — primary responsible party)
   - status ('draft'|'in_progress'|'awaiting_review'|'approved'|'rejected'|'completed'|'cancelled')
   - title (text)
   - description (text)
   - context_json (jsonb — type-specific data: e.g., for financial_review: { budgetBaselineId, reviewType })
   - started_at (timestamp)
   - completed_at (timestamp)
   - due_date (timestamp)
   - outcome (text — decision summary)
   - created_at, updated_at, deleted_at
   - Index on (process_type, status), (project_instance_id, process_type)

2. Create governed_process_checklist_item table:
   - id (serial PK)
   - governed_process_id (FK→governed_process)
   - item_key (text — machine-readable key for the checklist item)
   - title (text)
   - description (text)
   - responsible_party_id (FK→party)
   - status ('pending'|'in_progress'|'complete'|'not_applicable'|'blocked')
   - evidence_link (text)
   - completed_at (timestamp)
   - completed_by_party_id (FK→party)
   - sort_order (integer)
   - metadata (jsonb)
   - created_at, updated_at

3. Create governed_process_event table (audit trail for process state changes):
   - id (serial PK)
   - governed_process_id (FK→governed_process)
   - event_type ('created'|'status_changed'|'checklist_updated'|'comment_added'|'escalated'|'reassigned')
   - actor_party_id (FK→party)
   - old_status (text), new_status (text)
   - comment (text)
   - created_at

4. Create governed_process_template table (defines default checklists per process type):
   - id (serial PK)
   - process_type (text, unique)
   - template_items (jsonb — array of { item_key, title, description, sort_order })
   - is_active (boolean)
   - created_at, updated_at

SEED DATA:

5. Seed governed_process_template for each process type:
   - financial_review: checklist items based on current financial-review-routes logic
   - pd_pm_handover: items from handoverPacks + handoverChecklistItems pattern
   - phase_gate_review: items from stage_checklist_templates
   - change_request: items from change-control-routes
   - payment_batch: items from payment-batch-routes

API CONTRACTS:

6. Create POST /api/governed-processes:
   - Body: { processType, projectInstanceId, title, description?, contextJson?, assignedToPartyId? }
   - Auto-creates checklist items from template
   - Uses checkPermission based on process_type mapping

7. Create GET /api/governed-processes/:id:
   - Returns process + checklist items + events
   - Includes party names via joins

8. Create GET /api/governed-processes/:id/checklist:
   - Returns checklist items with status, responsible party

9. Create PATCH /api/governed-processes/:id:
   - Update status, outcome, assigned_to
   - Creates governed_process_event for state change
   - Status transitions enforced: draft→in_progress→awaiting_review→approved/rejected

10. Create PATCH /api/governed-processes/:id/checklist/:itemId:
    - Update checklist item status, evidence, completion
    - Creates event

11. Create GET /api/governed-processes?projectId=X&type=Y&status=Z:
    - List with filtering

BRIDGE:
12. Keep all existing handover, financial review, payment batch, change control routes
13. Do NOT migrate existing in-flight processes — only new processes use governed_process

DO NOT:
- Use governed_process for normal work execution (tasks, sub-tasks)
- Drop any existing workflow tables (handoverPacks, stage tables, etc.)
- Migrate existing in-flight handovers or reviews mid-process

VERIFY:
- governed_process table and related tables created
- Templates seeded for all 5 process types
- POST creates process with auto-generated checklist
- Status transitions enforced (cannot skip from draft to approved)
- GET returns complete process with checklist and events
- Existing handover/review routes still work
```

---

### Wave 3 — Step 2: Strategic Priority Migration

**Depends on:** Wave 3 Step 1 (governed_process exists for linking)
**Rollback:** Existing priorities routes still work
**Guardrails:** [2] Keep strategic above operational.

```
PROMPT:

You are normalizing the strategic priority model.

CONTEXT:
- Entity Migration Map: priority tables → Merge/normalize to strategic_priority + strategic_priority_link
- Current: likely a priorities table (server/routes/priority-strategic-routes.ts references this)
- Target: strategic_priority (the priority itself) + strategic_priority_link (links to projects, work items, etc.)

TASK:

1. Review current priority schema and routes (find in shared/schema/ and server/)

2. Create or adopt strategic_priority table:
   - id, title, description, priority_level, owner_party_id (FK→party), status, target_date, created_at, updated_at

3. Create strategic_priority_link table:
   - id, strategic_priority_id (FK), linked_entity_type ('project_instance'|'work_item'|'governed_process'), linked_entity_id (integer), linked_at, linked_by (FK→party)

4. Migrate existing priority data

5. Create/update API endpoints:
   - GET/POST/PATCH /api/strategic-priorities
   - POST /api/strategic-priorities/:id/links

6. Wire into Home dashboard (priority cards)

VERIFY:
- Priorities display on Home dashboard
- Can link priorities to projects and work items
- Existing priority pages still work
```

---

### Wave 3 — Step 3: Specialist Operational Records Linking

**Depends on:** Wave 2 (project_instance exists)
**Rollback:** Specialist tables unchanged
**Guardrails:** [2] Do not move specialist tables into core. They stay outside but get linked.

```
PROMPT:

You are linking specialist operational tables to the core spine without moving them into core.

CONTEXT:
- Control Map 1 lists these as "outside core": SSEG, commissioning, inspection, snags, handover packs, drawing register, client updates
- Current tables: handoverPacks, handoverChecklistItems, ssegItems (shared/schema/handover.ts), commissioning tables (shared/schema/construction.ts), quality tables (shared/schema/quality.ts)
- These tables currently FK to projectInfo.id

TASK:

1. Add project_instance_id FK columns to these specialist tables (nullable, alongside existing projectId):
   - handover_packs
   - sseg_items
   - commissioning tables (if they exist)
   - qc_project_instances (if they exist)

2. Backfill project_instance_id using legacy_id_map lookups

3. Document each specialist table's relationship to the spine:
   - Create docs/specialist-table-registry.md listing each table, its purpose, its core FK, and its exit condition (when it might merge into core or be retired)

DO NOT:
- Move any specialist table schema into core schema files
- Add specialist tables to the governed_process engine
- Change specialist table primary functionality

VERIFY:
- All specialist tables have project_instance_id populated
- Existing specialist routes still work
- Registry document created
```

---

### Wave 3 — Step 4: Governed Process Frontend

**Depends on:** Wave 3 Step 1 (governed_process API exists)
**Rollback:** Legacy handover/review pages still accessible
**Guardrails:** [1] New screens use governed_process API only. [3] Only formal workflows here. [5] Write authority clear.

```
PROMPT:

You are building the governed process UI — a unified interface for formal workflows.

CONTEXT:
- Target (Control Map 4): GET /api/governed-processes/:id, GET /api/governed-processes/:id/checklist, PATCH endpoints
- Department screens that use governed processes:
  - PD: handover preparation, client coordination
  - PM: financial review, phase gate, change request
  - Finance: payment batch, financial review approval

TASK:

1. Create client/src/components/governed-process/GovernedProcessDetail.tsx:
   - Shows process header: type badge, status, title, assigned party, dates
   - Checklist section: items with status toggles, evidence upload links
   - Event timeline: chronological log of all state changes
   - Action buttons: Submit for Review, Approve, Reject, Cancel (based on user's role and process status)
   - Calls PATCH /api/governed-processes/:id for status transitions
   - Calls PATCH /api/governed-processes/:id/checklist/:itemId for item updates

2. Create client/src/components/governed-process/GovernedProcessList.tsx:
   - Filterable list of governed processes
   - Filters: process type, status, project, assigned to me
   - Used within department dashboards

3. Wire into PD Dashboard:
   - Add "Active Handovers" section showing governed_process where type='pd_pm_handover'
   - "Start Handover" button → POST /api/governed-processes with type=pd_pm_handover

4. Wire into PM Dashboard:
   - "Active Reviews" section: financial_review, phase_gate_review, change_request processes
   - "Start Financial Review" / "Start Change Request" buttons

5. Wire into Finance department:
   - "Payment Batches" section: governed_process where type='payment_batch'
   - "Financial Reviews Awaiting Approval" section

DO NOT:
- Replace existing handover/review pages yet (they remain as fallback)
- Use governed_process UI for task management
- Skip the template-driven checklist (every process must auto-populate from template)

VERIFY:
- Can create a PD→PM handover process, complete checklist items, submit, approve
- Can create a financial review, fill checklist, get approval
- Process events logged correctly
- Status transitions enforced in UI (can't approve without completing required items)
- Department dashboards show relevant process types
```

---

### Wave 3 — Step 5: Verification & QA Checklist

**Depends on:** Wave 3 Steps 1–4
**Rollback:** N/A (validation only)
**Guardrails:** All five rules checked.

```
PROMPT:

WAVE 3 DONE-WHEN CRITERIA:
"Formal workflows use one process engine"

CHECKLIST:

1. GOVERNED PROCESS ENGINE
   [ ] governed_process table exists with correct schema
   [ ] governed_process_checklist_item populated from templates
   [ ] governed_process_event logs all state changes
   [ ] Templates seeded for: financial_review, pd_pm_handover, phase_gate_review, change_request, payment_batch
   [ ] Status transitions enforced (cannot skip states)

2. API CONTRACTS
   [ ] POST /api/governed-processes creates with auto-checklist
   [ ] GET /api/governed-processes/:id returns complete data
   [ ] PATCH status transitions work correctly
   [ ] Checklist item updates work
   [ ] List endpoint filters by type, status, project

3. FRONTEND
   [ ] GovernedProcessDetail renders correctly for each process type
   [ ] PD dashboard shows handover processes
   [ ] PM dashboard shows review/gate/change processes
   [ ] Finance shows payment batch and financial review processes
   [ ] Can complete full workflow: create → fill checklist → submit → approve

4. SPECIALIST TABLES
   [ ] All specialist tables have project_instance_id FK
   [ ] Specialist table registry document created
   [ ] No specialist table moved into core

5. STRATEGIC PRIORITIES
   [ ] strategic_priority + strategic_priority_link tables exist
   [ ] Can link priorities to projects and work items
   [ ] Home dashboard shows priorities

6. COMPATIBILITY
   [ ] All legacy handover/review routes still work
   [ ] In-flight legacy processes unaffected
   [ ] Bridge routes for existing dashboards intact

7. NON-NEGOTIABLE RULES
   [ ] Rule 1: New screens use locked contracts ✓/✗
   [ ] Rule 2: Analytical tables untouched ✓/✗
   [ ] Rule 3: governed_process used ONLY for formal workflows ✓/✗
   [ ] Rule 4: Bridge objects have exit triggers ✓/✗
   [ ] Rule 5: Write authority clear ✓/✗

Report results. Flag failures as blockers for Wave 4.
```

---

*Next section: Wave 4 Implementation Prompts*

---

## Section 6: Wave 4 — Deliverables + Approvals

**Cutover map summary:**
- Frontend + backend: deliverable_instance, approval_instance, evidence/resource linking
- Compatibility: Bridge old approval/deliverable reads
- Rollback: Fallback to legacy approval and deliverable routes
- Done when: All major sign-off actions run through shared engines

---

### Wave 4 — Step 1: Deliverable Definition + Instance Split

**Depends on:** Wave 2 (project_instance), Wave 3 (governed_process for signoff linking)
**Rollback:** Fallback to legacy deliverables table and engineering routes
**Guardrails:** [1] Locked contracts. [5] Write authority clear — definitions are templates, instances are project-specific.

```
PROMPT:

You are splitting the deliverables model into definition (template) and instance (project-specific).

CONTEXT:
- Current: deliverables table (shared/schema/engineering.ts:18) — flat table where each row is a project deliverable with type, title, description, status, owner, reviewer, QC reviewer, SharePoint links
- deliverableVersions, deliverableFiles, deliverableEvents also exist
- Entity Migration Map: deliverables + deliverable files → Split to deliverable_definition + deliverable_instance + deliverable_evidence_link
- Clarification C7: external_resource + resource_link tables needed for evidence/file linking

TASK:

SCHEMA:

1. Create deliverable_definition table:
   - id (serial PK)
   - deliverable_type (text — e.g., 'single_line_diagram', 'as_built_drawings', 'commissioning_report')
   - title_template (text — default title for this type)
   - description_template (text)
   - department (text — 'engineering', 'quality', 'pm', 'pd')
   - requires_evidence (boolean)
   - requires_approval (boolean)
   - default_reviewer_role (text — e.g., 'ENGINEERING_MANAGER', 'QUALITY_MANAGER')
   - is_active (boolean), created_at, updated_at

2. Create deliverable_instance table:
   - id (serial PK)
   - deliverable_definition_id (FK→deliverable_definition)
   - project_instance_id (FK→project_instance)
   - title (text — can override definition template)
   - description (text)
   - status ('not_started'|'in_progress'|'submitted'|'under_review'|'revision_required'|'approved'|'rejected')
   - current_version (integer, default 1)
   - owner_party_id (FK→party)
   - reviewer_party_id (FK→party)
   - qc_reviewer_party_id (FK→party)
   - phase (text)
   - due_date (date)
   - submitted_at (timestamp)
   - approved_at (timestamp)
   - created_at, updated_at, deleted_at

3. Create external_resource table:
   - id (serial PK)
   - resource_type ('sharepoint_file'|'sharepoint_folder'|'url'|'email'|'teams_message'|'attachment')
   - name (text)
   - url (text)
   - site_id (text — SharePoint site), drive_id (text), item_id (text)
   - mime_type (text), size_bytes (integer)
   - uploaded_by_party_id (FK→party)
   - created_at

4. Create resource_link table (polymorphic link from any entity to any resource):
   - id (serial PK)
   - entity_type ('deliverable_instance'|'governed_process'|'work_item'|'approval_instance')
   - entity_id (integer)
   - external_resource_id (FK→external_resource)
   - link_purpose ('evidence'|'attachment'|'reference'|'output')
   - linked_at, linked_by_party_id (FK→party)

5. Create deliverable_evidence_link (convenience view or table for deliverable-specific evidence):
   - This can be a view over resource_link WHERE entity_type='deliverable_instance'
   - OR a table: id, deliverable_instance_id (FK), external_resource_id (FK), evidence_type ('file'|'photo'|'certificate'|'test_result'), verified (boolean), verified_by (FK→party), verified_at

SEED DATA:

6. Seed deliverable_definition from distinct deliverable_type values in existing deliverables table:
   - For each unique deliverableType, create a definition row

DATA MIGRATION:

7. Migrate deliverables → deliverable_instance:
   - Look up or create deliverable_definition for each deliverableType
   - Map owner, reviewer, QC reviewer to party via legacy_id_map
   - Map projectId to project_instance_id via legacy_id_map
   - INSERT INTO legacy_id_map for each

8. Migrate deliverableFiles → external_resource + resource_link:
   - Create external_resource for each file (with SharePoint IDs)
   - Create resource_link with entity_type='deliverable_instance'

API CONTRACTS:

9. Create GET /api/projects/:id/deliverables:
   - Returns deliverable_instances for project, joined with definition and resource counts

10. Create GET /api/deliverables/:id:
    - Returns instance + definition + resources + evidence links

11. Create GET /api/deliverables/:id/resources:
    - Returns linked external_resources

12. Create POST /api/deliverables:
    - Body: { definitionId, projectInstanceId, title?, ownerPartyId, reviewerPartyId? }
    - Uses checkPermission('deliverables', 'create')

13. Create PATCH /api/deliverables/:id:
    - Update status, version, reviewers
    - Status transitions: not_started→in_progress→submitted→under_review→approved/revision_required

14. Create POST /api/deliverables/:id/resources:
    - Link an external resource to a deliverable

BRIDGE:
15. Keep existing deliverables, deliverableFiles, deliverableVersions tables
16. Bridge writer: new deliverable_instance writes sync back to legacy deliverables table
17. Existing engineering routes continue reading from legacy tables

DO NOT:
- Drop deliverables, deliverableVersions, or deliverableFiles tables
- Change existing engineering route responses
- Mix deliverable sign-off logic with governed_process (deliverables have their own review workflow; governed_process handles formal process-level approval)

VERIFY:
- deliverable_definition seeded from existing types
- deliverable_instance populated for all existing deliverables
- external_resource populated from deliverableFiles
- resource_link connects instances to resources
- API CRUD works end-to-end
- Legacy engineering routes still work
- legacy_id_map entries for all deliverables
```

---

### Wave 4 — Step 2: Approval Requirement + Instance Split

**Depends on:** Wave 4 Step 1 (deliverable_instance exists for linking)
**Rollback:** Fallback to legacy approvals table and routes
**Guardrails:** [1] Locked contracts. [5] Do not split sign-off logic across multiple half-models.

```
PROMPT:

You are splitting the approval model into requirement (template) and instance (actual event).

CONTEXT:
- Current: approvals table (shared/schema/collaboration.ts:111) — flat table with type, title, status, requestedBy, decidedBy, assignedApprover, relatedEntityType/Id, approvalType, approvalCategory
- Entity Migration Map: approvals → Split to approval_requirement + approval_instance
- Blocker B5: approval_requirement doesn't exist yet

TASK:

SCHEMA:

1. Create approval_requirement table:
   - id (serial PK)
   - approval_type (text — 'handover', 'budget', 'vo', 'procurement', 'gate', 'deliverable', 'general', etc.)
   - entity_type (text — 'governed_process', 'deliverable_instance', 'finance_record', 'work_item')
   - title_template (text)
   - description_template (text)
   - required_approver_role (text — e.g., 'CFO', 'PROGRAM_MANAGER')
   - auto_expire_days (integer, nullable)
   - requires_evidence (boolean)
   - is_active (boolean)
   - created_at, updated_at

2. Create approval_instance table:
   - id (serial PK)
   - approval_requirement_id (FK→approval_requirement, nullable — can be ad-hoc)
   - entity_type (text), entity_id (integer) — what is being approved
   - project_instance_id (FK→project_instance, nullable)
   - title (text)
   - description (text)
   - status ('pending'|'approved'|'rejected'|'expired'|'cancelled')
   - requested_by_party_id (FK→party)
   - assigned_approver_party_id (FK→party)
   - decided_by_party_id (FK→party)
   - requested_at (timestamp)
   - decided_at (timestamp)
   - decision_note (text)
   - due_date (timestamp)
   - evidence_resource_id (FK→external_resource, nullable)
   - token (text — for email-based approval links)
   - created_at, updated_at, deleted_at

SEED DATA:

3. Seed approval_requirement from distinct approvalType values in existing approvals table

DATA MIGRATION:

4. Migrate approvals → approval_instance:
   - Map requestedBy, decidedBy, assignedApprover to party via legacy_id_map
   - Map relatedEntityType + relatedEntityId to entity_type + entity_id
   - Map projectId to project_instance_id
   - Map approvalType to approval_requirement_id where available
   - INSERT INTO legacy_id_map

API CONTRACTS:

5. Create GET /api/approvals — list approval_instances with filtering:
   - ?assignee=me, ?status=pending, ?projectId=X, ?entityType=Y

6. Create GET /api/approvals/:id — full detail with requirement info

7. Create POST /api/approvals:
   - Body: { requirementId?, entityType, entityId, title, assignedApproverPartyId, dueDate? }
   - Uses checkPermission based on entity type

8. Create PATCH /api/approvals/:id:
   - Actions: approve, reject, cancel, reassign
   - Enforces: only assigned approver can approve/reject
   - Creates activity_log entry

9. Create GET /api/my-approvals — shortcut for current user's pending approvals

BRIDGE:
10. Keep existing approvals table and approvals-routes.ts
11. Bridge: new approval_instance writes sync back to legacy approvals table
12. Existing approval pages continue reading from legacy

DO NOT:
- Drop the approvals table
- Change existing approval route responses
- Create duplicate approval logic — use approval_instance for all new approval actions

VERIFY:
- approval_requirement seeded from existing types
- approval_instance populated from all existing approvals
- GET /api/approvals returns correct data
- Can create, approve, reject approvals
- Home dashboard "my approvals" reads from approval_instance
- Legacy approval routes still work
```

---

### Wave 4 — Step 3: Frontend — Engineering Deliverables + Approvals Board

**Depends on:** Wave 4 Steps 1–2
**Rollback:** Legacy engineering and approval pages accessible
**Guardrails:** [1] New screens use only Wave 4 API contracts. [5] Sign-off actions fully wired.

```
PROMPT:

You are building the engineering deliverables view and the unified approvals board.

CONTEXT:
- Control Map 3: Engineering department sees deliverable_instance, approval_instance
- Control Map 4: GET /api/projects/:id/deliverables, GET /api/deliverables/:id/resources, GET /api/approvals
- Existing pages: engineering-dashboard.tsx, admin-approvals.tsx

TASK:

1. Create client/src/pages/engineering-deliverables-v2.tsx:
   - Primary read: GET /api/projects/:id/deliverables
   - Table view: title, type, status, owner, reviewer, version, resource count, due date
   - Click-through to deliverable detail:
     - Shows definition info, instance fields, evidence/resources list
     - Version history
     - Submit for review / Approve / Request revision buttons
     - Upload evidence → POST /api/deliverables/:id/resources
   - Register under Engineering department

2. Create client/src/pages/approvals-board-v2.tsx:
   - Primary read: GET /api/approvals
   - Filters: status, type, project, assigned to me
   - Each card shows: title, type badge, requester, due date, entity link
   - Approve/Reject actions inline
   - Register under both PM and Finance departments (as relevant)

3. Update Home Dashboard:
   - "Pending Approvals" card reads from GET /api/my-approvals (approval_instance)
   - Count badge shows pending count

4. Wire into Quality department:
   - Quality dashboard shows deliverable_instances where department='quality'
   - Approval instances for quality deliverables

DO NOT:
- Replace existing engineering-dashboard or admin-approvals pages
- Wire to legacy routes from new components
- Build finance-specific approval workflows yet (that's Wave 5)

VERIFY:
- Engineering deliverables page shows all project deliverables
- Can submit deliverable for review, approve, reject
- Evidence upload and linking works
- Approvals board shows filtered approval instances
- Approve/reject actions work from approvals board
- Home dashboard approval count accurate
```

---

### Wave 4 — Step 4: Verification & QA Checklist

**Depends on:** Wave 4 Steps 1–3
**Rollback:** N/A
**Guardrails:** All five rules.

```
PROMPT:

WAVE 4 DONE-WHEN CRITERIA:
"All major sign-off actions run through shared engines"

CHECKLIST:

1. DELIVERABLE ENGINE
   [ ] deliverable_definition table seeded with all types
   [ ] deliverable_instance populated from legacy deliverables
   [ ] external_resource + resource_link populated from deliverableFiles
   [ ] API CRUD works: create, update, submit, review, approve
   [ ] Version tracking works
   [ ] Evidence linking works

2. APPROVAL ENGINE
   [ ] approval_requirement seeded from existing types
   [ ] approval_instance populated from legacy approvals
   [ ] API works: create, approve, reject, reassign
   [ ] Only assigned approver can approve/reject (enforced)
   [ ] Expiration logic works (if auto_expire_days set)

3. FRONTEND
   [ ] Engineering deliverables page: full workflow tested
   [ ] Approvals board: filter, approve, reject all working
   [ ] Home dashboard: approval counts from approval_instance
   [ ] Quality dashboard: shows quality deliverables

4. SIGN-OFF INTEGRITY
   [ ] Deliverable sign-off: owner submits → reviewer reviews → QC approves (3-step)
   [ ] Governed process approval: checklist complete → submit → approver decides (from Wave 3)
   [ ] Ad-hoc approval: create → assign → decide
   [ ] No sign-off path is split across two models

5. COMPATIBILITY
   [ ] Legacy deliverables routes work
   [ ] Legacy approvals routes work
   [ ] Bridge sync: new writes reflected in legacy tables
   [ ] legacy_id_map entries complete

6. NON-NEGOTIABLE RULES
   [ ] Rule 1: New pages use locked contracts ✓/✗
   [ ] Rule 2: Analytical tables untouched ✓/✗
   [ ] Rule 3: governed_process not misused for deliverable review ✓/✗
   [ ] Rule 4: Bridge objects have exit triggers ✓/✗
   [ ] Rule 5: Sign-off actions fully tested ✓/✗

Report results. Flag failures as blockers for Wave 5.
```

---

*Next section: Wave 5 Implementation Prompts*

---

## Section 7: Wave 5 — Transactional Finance

**Cutover map summary:**
- Frontend + backend: finance_record contracts, finance workspace, transaction linkage to projects/processes
- Compatibility: Read bridge to legacy finance tables and reporting
- Rollback: Reporting still reads old analytical tables until proven
- Done when: Money events are controlled without breaking reports

---

### Wave 5 — Step 1: Finance Record Schema + Migration

**Depends on:** Wave 3 (governed_process for linking), Wave 4 (approval_instance for sign-offs)
**Rollback:** Reporting still reads old analytical tables (programExpense, programInflows). Legacy finance routes untouched.
**Guardrails:** [1] Locked contracts. [2] Do NOT move analytical tables into core — they stay as read models. [5] Write authority: finance_record is transactional, not analytical.

```
PROMPT:

You are creating the unified finance_record entity for transactional finance.

CONTEXT:
- Current tables (all in shared/schema/finance.ts):
  - programExpense — cost line items (imported from Excel, write target for smart import)
  - programInflows — revenue milestones (imported from Excel)
  - purchaseOrders — PO records
  - paymentRequests — payment request records
  - paymentBatches — batch payment processing
  - invoiceCaptures — captured invoices
  - counterparties — supplier/vendor records (already migrated to party in Wave 2)
  - budgetBaselines — budget header records
- Entity Migration Map: PO / payment request / payment batch / invoice capture → Merge by transaction type into finance_record + governed_process
- programExpense, programInflows → RETAIN OUTSIDE CORE as analytical/reporting layer
- Clarification C4: programExpense and programInflows become read-only AFTER finance_record provides the canonical write layer

TASK:

SCHEMA:

1. Create finance_record table:
   - id (serial PK)
   - record_type ('purchase_order'|'payment_request'|'invoice'|'client_invoice'|'variation_order'|'cash_event'|'credit_note')
   - project_instance_id (FK→project_instance)
   - counterparty_party_id (FK→party — supplier or client)
   - governed_process_id (FK→governed_process, nullable — linked approval/review process)
   - reference_number (text — PO number, invoice number, etc.)
   - description (text)
   - amount (decimal 15,2)
   - currency (text, default 'ZAR')
   - tax_amount (decimal 15,2)
   - total_amount (decimal 15,2)
   - status ('draft'|'submitted'|'approved'|'rejected'|'paid'|'cancelled'|'partially_paid')
   - issued_date (date)
   - due_date (date)
   - paid_date (date)
   - payment_reference (text)
   - category (text — expense category for budget variance)
   - budget_baseline_id (FK→budget_baselines, nullable)
   - linked_finance_record_id (FK→finance_record, nullable — e.g., invoice linked to PO)
   - created_by_party_id (FK→party)
   - approved_by_party_id (FK→party)
   - metadata (jsonb — type-specific fields)
   - created_at, updated_at, deleted_at
   - Indexes: (project_instance_id, record_type), (counterparty_party_id), (status, due_date)

2. Create budget_baseline_line table (Decision 2 enrichment):
   - id (serial PK)
   - budget_baseline_id (FK→budget_baselines)
   - category (text — matches finance_record.category)
   - description (text)
   - quantity (decimal), unit_rate (decimal), total_amount (decimal 15,2)
   - sort_order (integer)
   - created_at

3. Adopt budget_baselines into core:
   - Add project_instance_id FK (alongside existing projectId)
   - Backfill via legacy_id_map

DATA MIGRATION:

4. Migrate purchaseOrders → finance_record (record_type='purchase_order'):
   - Map supplier to counterparty_party_id via legacy_id_map
   - Map projectId to project_instance_id
   - Map amounts, dates, status
   - INSERT INTO legacy_id_map

5. Migrate paymentRequests → finance_record (record_type='payment_request'):
   - Link to PO finance_record via linked_finance_record_id where applicable
   - Map approval status

6. Migrate invoiceCaptures → finance_record (record_type='invoice'):
   - Map amounts, dates, verification status → finance_record.status

7. Do NOT migrate programExpense or programInflows — they remain as-is:
   - They continue to serve as the analytical/reporting layer
   - Smart import continues to write to them
   - Future: finance_record becomes the source of truth; analytical tables become materialized views

API CONTRACTS:

8. Create GET /api/projects/:id/finance-summary:
   - Returns aggregated view: { totalPOs, totalInvoiced, totalPaid, totalOutstanding, budgetVariance, margin }
   - Reads from finance_record + budget_baselines

9. Create GET /api/finance-records:
   - List with filters: ?projectId=, ?recordType=, ?status=, ?counterpartyId=, ?dueDateBefore=
   - Paginated

10. Create GET /api/finance-records/:id — full detail with linked records

11. Create POST /api/finance-records:
    - Body: { recordType, projectInstanceId, counterpartyPartyId, amount, ... }
    - Auto-creates governed_process for types requiring approval (PO, payment_request)
    - Uses checkPermission('financials', 'create')

12. Create PATCH /api/finance-records/:id:
    - Update status, amounts, dates
    - Status transitions enforced
    - Uses checkPermission('financials', 'edit')

BRIDGE:
13. Keep all existing finance route files (po-routes.ts, payment-request-routes.ts, etc.)
14. Bridge: new finance_record writes sync back to legacy tables where applicable
15. Smart import pipeline continues writing to programExpense/programInflows (untouched)
16. Existing cashflow, revenue, COS pages continue reading from analytical tables

DO NOT:
- Drop or modify programExpense, programInflows, purchaseOrders, paymentRequests, invoiceCaptures
- Make programExpense write to finance_record (it stays as import target)
- Change smart import pipeline
- Move analytical/reporting tables into core (Guardrail 2)

VERIFY:
- finance_record populated from POs, payment requests, invoices
- budget_baseline_line table exists
- Budget baselines have project_instance_id
- GET /api/projects/:id/finance-summary returns correct aggregations
- POST /api/finance-records creates record + governed_process where required
- Legacy finance routes still work
- Smart import pipeline unaffected
- Cashflow/revenue/COS pages still render correctly
```

---

### Wave 5 — Step 2: Finance Workspace Frontend

**Depends on:** Wave 5 Step 1
**Rollback:** Legacy finance pages (cashflow, revenue, COS, GP tracker) remain accessible
**Guardrails:** [1] Locked contracts only. [2] Analytical pages keep reading from analytical tables. [5] Write authority on finance_record.

```
PROMPT:

You are building the Finance department workspace.

CONTEXT:
- Control Map 3: Finance lens shows finance_record, governed_process, party, project_instance
- Control Map 4: GET /api/projects/:id/finance-summary, GET /api/finance-records
- Current pages: cashflow.tsx, revenue-tracker.tsx, cos.tsx, gp-tracker.tsx, payment-batch-manager.tsx, payment-request-board.tsx, po-approval-board.tsx, financial-linking.tsx, financial-review-queue.tsx
- IMPORTANT: Existing analytical pages (cashflow, revenue, COS) continue to read from programExpense/programInflows. They are NOT migrated to finance_record in this wave.

TASK:

1. Create client/src/pages/finance-workspace.tsx:
   - Project-scoped finance summary (GET /api/projects/:id/finance-summary)
   - Cards: Total Budget, Total Committed (POs), Total Invoiced, Total Paid, Budget Variance, Margin
   - Chart: spend vs budget over time (if data available)
   - Register under Finance department as the landing page

2. Create client/src/pages/finance-records.tsx:
   - List view of all finance_records with filters: type, status, project, counterparty
   - Create button → form to POST /api/finance-records
   - Click-through to detail view
   - Detail view shows: record info, linked records (PO→invoice→payment chain), governed_process status, approval status
   - Action buttons: Submit, Approve, Reject (based on status + permissions)
   - Register under Finance department

3. Wire payment batch into governed_process:
   - "Create Payment Batch" → POST /api/governed-processes with type='payment_batch'
   - Link selected finance_records (payment requests) to the batch process
   - Payment batch detail shows checklist + linked records

4. Keep existing analytical pages under Finance department:
   - cashflow, revenue-tracker, cos, gp-tracker remain as sub-navigation items
   - They continue reading from their existing routes
   - Label them clearly as "Reporting" sub-section

DO NOT:
- Replace cashflow, revenue, COS, or GP tracker pages with finance_record views
- Make analytical pages write to finance_record
- Remove any existing finance route or page

VERIFY:
- Finance workspace landing shows correct summary for test project
- Can create PO, payment request, invoice through finance-records page
- Governed process auto-created for PO approval
- Payment batch workflow: create batch → add records → approve
- Existing analytical pages still work and show same data
```

---

### Wave 5 — Step 3: Collaboration Surfaces

**Depends on:** Wave 2 (party, external_resource/resource_link from Wave 4)
**Rollback:** Existing collaboration pages unchanged
**Guardrails:** [1] Locked contracts. Collaboration data stays in support layer.

```
PROMPT:

You are wiring collaboration surfaces (email, Teams, SharePoint) to the core spine.

CONTEXT:
- Control Map 1: Collaboration surfaces = inbox, email, Teams, meetings, SharePoint links → support layer linked to core via external_resource / resource_link + sync/config outside core
- Current: teams-chats.tsx, collab-email.tsx, collaboration.tsx, ms-sync-routes.ts, microsoft/ directory
- external_resource and resource_link tables exist from Wave 4

TASK:

1. Create sync endpoints that link Microsoft objects to core entities:
   - POST /api/ms-sync/link-email — links an email (external_resource) to a project_instance or work_item
   - POST /api/ms-sync/link-meeting — links a Teams meeting to a project
   - These create external_resource + resource_link rows

2. Update GET /api/projects/:id/workspace-summary to include:
   - recentCommunications: count of linked emails/meetings in last 7 days

3. Create a "Project Communications" tab within the project workspace:
   - Lists external_resources linked to the project via resource_link
   - Filterable by type (email, meeting, file)
   - This is a read-only aggregation view

4. Keep existing MS integration routes (ms-sync-routes.ts, microsoft/) unchanged — they continue to handle the actual Microsoft Graph API calls

DO NOT:
- Move Microsoft integration config into core schema
- Replace existing collaboration pages
- Build new Microsoft Graph integrations (only link existing data to spine)

VERIFY:
- Can link an email to a project
- Project workspace shows recent communications count
- Communications tab shows linked resources
- Existing MS integration routes unaffected
```

---

### Wave 5 — Step 4: Verification & QA Checklist

**Depends on:** Wave 5 Steps 1–3
**Rollback:** N/A
**Guardrails:** All five rules.

```
PROMPT:

WAVE 5 DONE-WHEN CRITERIA:
"Money events are controlled without breaking reports"

CHECKLIST:

1. FINANCE RECORD
   [ ] finance_record table exists with correct schema
   [ ] Populated from: POs, payment requests, invoice captures
   [ ] budget_baseline_line table exists
   [ ] Budget baselines have project_instance_id
   [ ] finance_record CRUD works via API
   [ ] Auto-creates governed_process for PO and payment request approval
   [ ] Status transitions enforced

2. ANALYTICAL LAYER INTEGRITY (CRITICAL)
   [ ] programExpense table UNCHANGED — still writable by smart import
   [ ] programInflows table UNCHANGED — still writable by smart import
   [ ] Cashflow page: same data as before migration
   [ ] Revenue tracker: same data as before migration
   [ ] COS tracker: same data as before migration
   [ ] GP tracker: same data as before migration
   [ ] Smart import pipeline: zero changes, runs successfully

3. FRONTEND
   [ ] Finance workspace shows correct summary
   [ ] Finance records page: CRUD works
   [ ] Payment batch via governed_process works
   [ ] Analytical pages accessible under Finance department
   [ ] Project communications tab works

4. BUDGET VARIANCE
   [ ] GET /api/projects/:id/finance-summary returns variance against baseline
   [ ] Finance workspace displays budget vs actual

5. COMPATIBILITY
   [ ] All legacy finance routes work
   [ ] Bridge sync: finance_record writes reflected in legacy tables
   [ ] legacy_id_map entries for all migrated records

6. NON-NEGOTIABLE RULES
   [ ] Rule 1: New pages use locked contracts ✓/✗
   [ ] Rule 2: Analytical tables NOT moved to core ✓/✗ (CRITICAL CHECK)
   [ ] Rule 3: governed_process only for formal finance approval ✓/✗
   [ ] Rule 4: Bridge objects have exit triggers ✓/✗
   [ ] Rule 5: Write authority clear (finance_record=transactional, programExpense=analytical) ✓/✗

Report results. Flag failures as blockers for Wave 6.
```

---

*Next section: Wave 6 Implementation Prompts*

---

## Section 8: Wave 6 — Compatibility Cleanup

**Cutover map summary:**
- Frontend + backend: Reduce projectExecutionState authority, retire temp bridge objects, close dead routes
- Compatibility: Only after parity checks
- Rollback: Keep bridge until parity proven
- Done when: Compatibility layer is smaller, not bigger

---

### Wave 6 — Step 1: Parity Audit

**Depends on:** Waves 1–5 all complete and verified
**Rollback:** N/A (read-only audit)
**Guardrails:** [4] Every bridge must have an exit trigger. [5] No cleanup until parity proven.

```
PROMPT:

You are running a full parity audit before any compatibility cleanup begins.

CONTEXT:
- Waves 1–5 created new core entities with bridge writers that sync back to legacy tables
- Legacy routes continue to work alongside new API contracts
- This step DOES NOT modify anything — it only measures and reports

TASK:

1. Create a parity report script at scripts/migration-parity-audit.ts that:

   For each migrated entity pair, checks:

   a. ROW COUNT PARITY:
      - party vs (clients + counterparties + users): counts match?
      - project_instance vs projectInfo: counts match?
      - work_item_assignment vs work_items with ownerUserId: coverage?
      - deliverable_instance vs deliverables: counts match?
      - approval_instance vs approvals: counts match?
      - finance_record vs (purchaseOrders + paymentRequests + invoiceCaptures): counts match?

   b. DATA PARITY (sample-based):
      - For 10 random rows per entity, compare field values between new and legacy tables
      - Report mismatches as { entity, id, field, newValue, legacyValue }

   c. BRIDGE SYNC PARITY:
      - Create a test record via new API, verify it appears in legacy table
      - Update via new API, verify legacy table reflects change
      - Report sync failures

   d. ROUTE PARITY:
      - For each legacy GET endpoint still in use, compare response with equivalent new endpoint
      - Report response differences

   e. FRONTEND PARITY:
      - List all pages that still read from legacy routes
      - List all pages that read from new API contracts
      - Identify any page reading from BOTH (dual-read risk)

2. Output report as JSON + human-readable markdown at docs/parity-audit-report.md

3. Flag each legacy table/route as one of:
   - READY_TO_RETIRE: new entity has full parity, no consumers left
   - BRIDGE_ACTIVE: sync working, but legacy consumers still exist
   - PARITY_GAP: data mismatch or missing coverage
   - BLOCKED: cannot retire until specific condition met

VERIFY:
- Script runs without errors
- Report generated with all entity pairs checked
- No PARITY_GAP items (or all gaps documented with remediation plan)
```

---

### Wave 6 — Step 2: Gate UI Migration

**Depends on:** Wave 6 Step 1 (parity confirmed), Wave 3 (governed_process exists)
**Rollback:** Legacy gate pages remain accessible
**Guardrails:** [1] Locked contracts. [5] Write authority clear.

```
PROMPT:

You are migrating gate UI specifics to use the governed_process and stage lifecycle engines.

CONTEXT:
- Control Map 1: Gate UI specifics = "Current gate requirements, evidence, decisions screens" → compatibility layer
- Current: project-stage-gate.tsx, gates/ directory, stage-lifecycle-routes.ts
- Current schema: project_stage_instances, project_stage_requirements, project_stage_evidence, project_stage_decisions (shared/schema/stage-lifecycle.ts)
- Clarification C6: These tables are MORE granular than the control pack's phase_definition/project_phase_history model
- Strategy: KEEP the stage lifecycle tables (they're good) but wire the gate UI to read from them via new API contracts that align with the target spine

TASK:

1. Create compatibility views/endpoints that present stage data in spine-aligned format:
   - GET /api/projects/:id/phase-history → reads from project_stage_instances, returns { phases: [{ code, name, status, enteredAt, completedAt, decisions }] }
   - GET /api/projects/:id/current-gate → reads from project_stage_instances + project_stage_requirements, returns { gate: { stageCode, requirements: [...], evidence: [...], decisions: [...] } }

2. Wire project-stage-gate.tsx to use these new endpoints instead of direct stage-lifecycle reads

3. Link gate decisions to governed_process:
   - "Request Gate Review" button creates governed_process with type='phase_gate_review'
   - Gate approval creates approval_instance
   - Gate evidence links to external_resource/resource_link

4. Keep stage lifecycle tables as-is (they're the authoritative source)

DO NOT:
- Drop or replace stage lifecycle tables
- Flatten the stage model (it's more useful than the control pack's minimal model)
- Create duplicate gate data in governed_process

VERIFY:
- Gate UI renders same data as before
- Phase history endpoint returns correct timeline
- Gate review creates governed_process
- Stage lifecycle tables unchanged
```

---

### Wave 6 — Step 3: projectExecutionState Authority Reduction

**Depends on:** Wave 6 Step 1 (parity confirmed for project_instance)
**Rollback:** Keep projectExecutionState as authoritative if parity gap found
**Guardrails:** [4] Bridge exit trigger: projectExecutionState becomes read-only when project_instance phase + dates are proven.

```
PROMPT:

You are reducing projectExecutionState from authoritative to compatibility-only.

CONTEXT:
- project_instance now holds: phase, phase_updated_at, status (migrated in Wave 2)
- projectExecutionState still holds: phase, key dates (planned + actual), financial quick-ref fields, workstream states
- Risk R5: Different split axes. project_instance absorbed phase. Dates remain in projectExecutionState.
- Target: projectExecutionState becomes a COMPUTED/CACHED view, not the write target

TASK:

1. Migrate remaining authoritative fields from projectExecutionState to project_instance:
   - Key planned dates: pdHandoverDate, constructionStartDate, commissioningDate, omHandoverDate, clientHandoverDate
   - Key actual dates: constructionStartActual, pdHandoverActual, commissioningActual, clientHandoverActual
   - Add these columns to project_instance via migration
   - Backfill from projectExecutionState

2. Update PATCH /api/v2/projects/:id to accept date updates on project_instance

3. Convert projectExecutionState bridge writer direction:
   - Previously: project_instance writes → sync to projectExecutionState
   - Now: project_instance is AUTHORITATIVE for phase + dates
   - projectExecutionState becomes a COMPUTED view (or cached copy updated by trigger)

4. Update all new API endpoints to read dates from project_instance, not projectExecutionState

5. Mark projectExecutionState as "compatibility only" in schema comments:
   ```
   // COMPATIBILITY LAYER — authority transferred to project_instance in Wave 6
   // Exit condition: all legacy consumers migrated to project_instance reads
   // Do not add new fields here
   ```

6. Audit which legacy routes still read from projectExecutionState directly:
   - List them in the parity report
   - These are the remaining consumers to migrate

DO NOT:
- Drop projectExecutionState table
- Remove bridge sync (legacy routes still need it)
- Migrate workstream-specific state fields (those can stay in compatibility layer longer)

VERIFY:
- project_instance has all key dates populated
- New API returns dates from project_instance
- projectExecutionState sync still works for legacy routes
- No data loss in date migration
```

---

### Wave 6 — Step 4: Dead Route Cleanup

**Depends on:** Wave 6 Steps 1–3, parity audit confirms READY_TO_RETIRE items
**Rollback:** Routes can be re-added from git history
**Guardrails:** [4] Only retire what the parity audit confirms. [1] No orphaned frontend references.

```
PROMPT:

You are closing dead routes and reducing the compatibility layer.

CONTEXT:
- Parity audit (Step 1) flagged routes as READY_TO_RETIRE
- Only routes with ZERO remaining consumers should be retired
- "Retire" means: mark as deprecated, add redirect, schedule removal

TASK:

1. For each READY_TO_RETIRE route from the parity audit:
   a. Add deprecation header: `res.setHeader('X-Deprecated', 'Use /api/v2/... instead')`
   b. Add redirect comment in route file: `// DEPRECATED: Replaced by [new endpoint]. Remove after [date].`
   c. Log usage of deprecated routes to audit_log
   d. Do NOT delete the route yet — just mark and monitor

2. For each BRIDGE_ACTIVE item:
   a. Document remaining consumers in docs/bridge-exit-plan.md
   b. Set target date for migration of remaining consumers
   c. Keep bridge sync active

3. Update admin migration control page:
   - Show deprecated routes with usage counts
   - Show bridge exit plan status
   - Show overall compatibility layer size (number of bridge objects, deprecated routes)

4. Remove any route files that are truly dead (zero usage in parity audit + zero frontend references):
   - Only after confirming no imports, no fetch calls, no test references

DO NOT:
- Delete routes with any remaining consumers
- Remove bridge sync for active bridges
- Force-migrate legacy frontend pages that haven't been rebuilt yet

VERIFY:
- Deprecated routes return X-Deprecated header
- Usage logging works
- Admin page shows compatibility layer metrics
- No frontend page broke from deprecation markers
```

---

### Wave 6 — Step 5: Final Verification & Migration Completion Checklist

**Depends on:** Wave 6 Steps 1–4
**Rollback:** N/A
**Guardrails:** All five rules, final check.

```
PROMPT:

WAVE 6 DONE-WHEN CRITERIA:
"Compatibility layer is smaller, not bigger"

FINAL MIGRATION CHECKLIST:

1. CORE SPINE COMPLETE
   [ ] party + party_role + contact_method: authoritative, all consumers migrated
   [ ] project_instance + project_info_parameter_value: authoritative for identity + dates
   [ ] work_item + work_item_assignment + work_item_dependency: authoritative work engine
   [ ] governed_process + checklist: authoritative for all formal workflows
   [ ] deliverable_definition + deliverable_instance: authoritative for deliverables
   [ ] approval_requirement + approval_instance: authoritative for approvals
   [ ] finance_record: authoritative for transactional finance
   [ ] external_resource + resource_link: authoritative for resource linking
   [ ] activity_log + audit_log: dual logging active
   [ ] budget_baselines + budget_baseline_line: adopted into core

2. COMPATIBILITY LAYER SIZE
   [ ] Number of bridge objects: _____ (target: fewer than at Wave 5)
   [ ] Number of deprecated routes: _____
   [ ] Number of legacy tables still receiving writes: _____
   [ ] Each has documented exit condition: ✓/✗
   [ ] projectExecutionState authority reduced: ✓/✗

3. FRONTEND
   [ ] Department shell stable with 8 departments
   [ ] All department dashboards functional
   [ ] Project workspace header reads from project_instance
   [ ] Gate UI uses compatibility views over stage lifecycle
   [ ] Feature flag can still disable new shell (rollback works)

4. DATA INTEGRITY
   [ ] Parity audit: zero PARITY_GAP items
   [ ] legacy_id_map complete for all migrated entities
   [ ] No data loss in any migration step
   [ ] Smart import pipeline still working

5. NON-NEGOTIABLE RULES — FINAL SIGN-OFF
   [ ] Rule 1: No new frontend page calls random legacy routes ✓/✗
   [ ] Rule 2: Analytical tables remain outside core ✓/✗
   [ ] Rule 3: governed_process used only for formal workflows ✓/✗
   [ ] Rule 4: Every bridge has a documented exit trigger ✓/✗
   [ ] Rule 5: Write authority clear on every endpoint ✓/✗

6. DOCUMENTATION
   [ ] docs/specialist-table-registry.md — complete
   [ ] docs/parity-audit-report.md — current
   [ ] docs/bridge-exit-plan.md — complete with target dates
   [ ] All new API contracts documented (OpenAPI or equivalent)

SIGN-OFF:
- Johannes reviews and approves final state
- ChatGPT runs architecture QA check against original control pack
- All 6 waves marked complete in admin migration control page

Report comprehensive results.
```

---

## Appendix: Unmapped Entities

The following entities from the codebase are NOT explicitly covered in the control pack's entity migration map. They should be tagged explicitly before Wave 3+:

| Entity | Current location | Suggested tag | Notes |
|--------|-----------------|---------------|-------|
| pdTickets | shared/schema/projects.ts | Retain temporarily → merge into governed_process or opportunity | PD pipeline tracking, overlaps with opportunities |
| projectPdPmHandover | shared/schema/projects.ts | Merge into governed_process (type='pd_pm_handover') | Dedicated handover record |
| qc_template hierarchy | shared/schema/quality.ts | Retain as specialist operational | Template system, not core |
| hse tables | shared/schema/hse.ts | Retain as specialist operational | HSE module |
| construction tables | shared/schema/construction.ts | Retain as specialist operational | Construction module |
| ssegItems | shared/schema/handover.ts | Retain as specialist operational | SSEG regulatory tracking |
| notifications + throttle | shared/schema/collaboration.ts | Retain in support layer | Notification delivery |
| meetings tables | shared/schema/collaboration.ts | Link to core via resource_link | MS Teams integration |
| standups | shared/schema/collaboration.ts | Retain in support layer | Team ceremony tracking |
| gamification (leaderboard, etc.) | shared/schema/collaboration.ts | Decision needed: retain or retire | Not business-critical |
| smart import tables | shared/schema/imports.ts | Retain outside core | Import infrastructure |
| error_logs | shared/schema/users.ts | Retain in support layer | Error tracking |
| organizations | shared/schema/users.ts | Decision needed for multi-tenancy | May become party with role='organization' |

---

## Appendix: Cross-Reference Matrix

Maps each control pack entity to the implementation prompt where it's created:

| Target Entity | Wave | Step | Prompt Title |
|--------------|------|------|-------------|
| party | 2 | 1 | Party Entity + Migration |
| party_role | 2 | 1 | Party Entity + Migration |
| contact_method | 2 | 1 | Party Entity + Migration |
| project_party_link | 2 | 1 | Party Entity + Migration |
| user_account | 2 | 1 | Party Entity + Migration |
| microsoft_identity | 2 | 1 | Party Entity + Migration |
| project_instance | 2 | 2 | Project Instance + Project Info Split |
| project_type | 2 | 2 | Project Instance + Project Info Split |
| project_info_parameter_value | 2 | 2 | Project Instance + Project Info Split |
| portfolio | 2 | 2 | Project Instance + Project Info Split |
| work_item (is_package flag) | 2 | 3 | Work Engine Migration |
| work_item_dependency | 2 | 3 | Work Engine Migration |
| work_item_assignment | 2 | 3 | Work Engine Migration |
| activity_log | 2 | 4 | Audit Log Split |
| audit_log | 2 | 4 | Audit Log Split |
| governed_process | 3 | 1 | Governed Process Schema + Engine |
| governed_process_checklist_item | 3 | 1 | Governed Process Schema + Engine |
| governed_process_event | 3 | 1 | Governed Process Schema + Engine |
| governed_process_template | 3 | 1 | Governed Process Schema + Engine |
| strategic_priority | 3 | 2 | Strategic Priority Migration |
| strategic_priority_link | 3 | 2 | Strategic Priority Migration |
| deliverable_definition | 4 | 1 | Deliverable Definition + Instance Split |
| deliverable_instance | 4 | 1 | Deliverable Definition + Instance Split |
| external_resource | 4 | 1 | Deliverable Definition + Instance Split |
| resource_link | 4 | 1 | Deliverable Definition + Instance Split |
| deliverable_evidence_link | 4 | 1 | Deliverable Definition + Instance Split |
| approval_requirement | 4 | 2 | Approval Requirement + Instance Split |
| approval_instance | 4 | 2 | Approval Requirement + Instance Split |
| finance_record | 5 | 1 | Finance Record Schema + Migration |
| budget_baseline_line | 5 | 1 | Finance Record Schema + Migration |
| legacy_id_map | 1 | 5 | Admin Migration Control View |
| phase_definition (compatibility view) | 6 | 2 | Gate UI Migration |
| project_phase_history (compatibility view) | 6 | 2 | Gate UI Migration |

---

*End of Migration Control Pack Implementation Plan*
