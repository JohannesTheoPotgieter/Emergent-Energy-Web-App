# Emergent Energy Platform — Comprehensive QA & Review Prompt

> **Give this entire prompt to an AI extension that has access to the production database, API layer, and front-end codebase. It will guide a full-stack audit ensuring every status, lens, permission, and data flow works correctly end-to-end.**

---

## 1. YOUR ROLE & SAFETY RULES

You are a **senior QA engineer** performing a full-stack review of the Emergent Energy platform. You have read access to the **production PostgreSQL database** (via Drizzle ORM / Supabase), the Express API server, and the React front-end.

### Ground Rules
- **READ-ONLY on production.** Never INSERT, UPDATE, DELETE, or DROP anything in production. All write-testing must use a staging/dev copy.
- **No destructive actions.** Do not truncate tables, disable constraints, or modify RLS policies.
- **Report, don't fix.** Your output is a structured findings report. Do not push code changes.
- **PII caution.** When showing sample data, redact names, emails, and phone numbers.
- **Scope.** You are reviewing data integrity, status consistency, API correctness, and front-end rendering — not performance or infrastructure.

---

## 2. ARCHITECTURE OVERVIEW

### Tech Stack
| Layer | Technology |
|-------|-----------|
| **Database** | PostgreSQL (hosted via Supabase) |
| **ORM** | Drizzle ORM with Zod validation |
| **Server** | Node.js + Express, TypeScript |
| **Client** | React 19 + TypeScript + Vite |
| **Routing** | Wouter (client), Express Router (server) |
| **UI** | Radix UI + TailwindCSS (shadcn/ui components) |
| **State** | @tanstack/react-query (server state), React Context (client state) |
| **Auth** | JWT-based sessions, role/lens context |
| **Validation** | Zod schemas (shared between client & server) |

### Data Flow
```
PostgreSQL DB
    |
    v
Drizzle ORM (shared/schema/*.ts)
    |
    v
Express API routes (server/*-routes.ts)
    |  - Auth middleware (JWT verification)
    |  - Permission checks (access-policy.ts, permission-catalog.ts)
    |  - Business logic (server/services/*.ts)
    |
    v
React Client (client/src/)
    |  - @tanstack/react-query hooks fetch from /api/*
    |  - LensContext determines UI personalization
    |  - AccessMatrix determines data visibility
    |  - Components render with status colors/badges
    v
User sees role-appropriate view
```

### Key Directories
| Path | Purpose |
|------|---------|
| `shared/schema/` | Drizzle table definitions, enums, Zod validators (source of truth) |
| `shared/constants/` | Status labels, workstream constants |
| `server/` | Express routes, services, middleware, bootstrap |
| `server/services/` | Business logic (source-of-truth-policy, audit, sync) |
| `server/bootstrap/` | Startup orchestration, backfills, seeds, guards |
| `server/departments/` | Domain-grouped routes (finance, construction, HSE, etc.) |
| `client/src/pages/` | Page components (50+ pages) |
| `client/src/components/` | Reusable UI components |
| `client/src/hooks/` | Custom React hooks (data fetching, filters, permissions) |
| `client/src/lib/` | Utilities (status colors, task formatting, workflow guards) |
| `client/src/config/` | Page registry, route config |

---

## 3. DATABASE LAYER — COMPLETE TABLE & ENUM REFERENCE

The database has 100+ tables across 12 canonical modules. Below is every table that carries a status field, grouped by domain. **Your job is to verify that every row in production contains a valid value from the documented enum.**

### Schema Definition Files (source of truth)
| File | Domain |
|------|--------|
| `shared/schema/projects.ts` | Project master, execution state |
| `shared/schema/tasks.ts` | Work items, comments, checklists, scheduling |
| `shared/schema/finance.ts` | Revenue/cost lines, procurement, POs, payments |
| `shared/schema/engineering.ts` | Deliverables, stage templates, drawing register |
| `shared/schema/quality.ts` | QC checklists, commissioning, evidence scoring |
| `shared/schema/collaboration.ts` | Approvals, notifications, meetings, standups |
| `shared/schema/stage-lifecycle.ts` | Gate statuses, requirements, exceptions, dependencies |
| `shared/schema/role-based-upgrade.ts` | Lens profiles, contracts, SSEG applications |
| `shared/schema/construction.ts` | Site activities, snags, inspections, contractors |
| `shared/schema/hse.ts` | HSE incidents, corrective actions |
| `shared/schema/handover.ts` | Handover packs, SSEG items, lessons learnt |
| `shared/schema/users.ts` | Users, roles |
| `shared/constants/statuses.ts` | High-level status labels (ProjectStatus, TaskStatus, RagStatus) |

### 3A. Project Lifecycle & Execution

| Table | Status Column | Valid Values | QA Check |
|-------|--------------|-------------|----------|
| `project_execution_state` | `phase` | `design`, `construction`, `commissioning`, `om` | No rows with NULL or values outside this set |
| `project_stage_instances` | `stage_status` | `NOT_STARTED`, `IN_PROGRESS`, `READY_FOR_REVIEW`, `APPROVED`, `PROGRESSED`, `EXCEPTION_APPROVED`, `BLOCKED` | Every project must have exactly 10 stage instances (S01-S10). No orphan stages without a project. |
| `project_stage_requirements` | `status` | `NOT_STARTED`, `IN_PROGRESS`, `COMPLETE`, `NOT_APPLICABLE`, `WAIVED` | Requirements must belong to a valid stage instance |
| `project_stage_exceptions` | `status` | `REQUESTED`, `APPROVED`, `APPROVED_WITH_CONDITIONS`, `REJECTED`, `CLOSED`, `RE_OPENED` | Approved exceptions should have a corresponding `EXCEPTION_APPROVED` stage or a decision record |
| `project_stage_dependencies` | `status` | `WAITING`, `RESOLVED`, `ESCALATED`, `BYPASSED` | No orphan dependencies without a stage instance |
| `project_stage_decisions` | `decision_type` | `GATE_PASS`, `GATE_FAIL`, `EXCEPTION_GRANTED`, `EXCEPTION_DENIED`, `STAGE_OVERRIDE`, `STAGE_ROLLBACK` | Every APPROVED stage should have at least one GATE_PASS decision |

### 3B. Task & Work Item Management

| Table | Status Column | Valid Values | QA Check |
|-------|--------------|-------------|----------|
| `work_items` | `status` | `TO DO`, `IN PROGRESS`, `HOLD`, `PROJECTS ASSISTANCE`, `NEEDS APPROVAL`, `QC APPROVED`, `PROVIDE FEEDBACK`, `OPERATIONAL APPROVAL`, `COMPLETE` | No invalid statuses. Verify `deleted_at IS NULL` for active items. |
| `work_items` | `workstream` | `PD`, `ENG`, `QUALITY`, `PM`, `FINANCE`, `PERSONAL`, `GOVERNANCE`, `HANDOVER` | No NULL workstreams on active items |
| `work_items` | `priority` | `Low`, `Med`, `High`, `Urgent` | No invalid priorities |
| `work_items` | `bucket` | `project`, `company_ops`, `personal` | Must be one of these three |
| `work_item_status_history` | `new_status` | Same as `work_items.status` | History must never contain a status value not in the valid set |
| `mytool_tasks` | `status` | `inbox`, `planned`, `in_progress`, `blocked`, `waiting`, `done`, `cancelled` | Personal tasks must have valid status |

### 3C. Deliverables & Engineering

| Table | Status Column | Valid Values | QA Check |
|-------|--------------|-------------|----------|
| `deliverables` | `status` | `TO DO`, `IN PROGRESS`, `NEEDS APPROVAL`, `PROVIDE FEEDBACK`, `QC APPROVED`, `OPERATIONAL APPROVAL`, `COMPLETE` | Must be subset of work item statuses |
| `deliverable_versions` | `status` | `IN PROGRESS` (default) | Check for any non-default values |
| `project_eng_stages` | `status` | `not_started`, `in_progress`, `blocked`, `ready_for_review`, `complete` | Must match `engStageStatusEnum` |
| `project_eng_tasks` | `status` | `pending`, `in_progress`, `complete`, `skipped` | Must match `engTaskInstanceStatusEnum` |
| `project_eng_approvals` | `status` | `pending`, `approved`, `rejected` | Must match `engApprovalStatusEnum` |
| `project_eng_deliverables` | `approval_status` | `pending` (default) | Check for unexpected values |

### 3D. Finance & Procurement

| Table | Status Column | Valid Values | QA Check |
|-------|--------------|-------------|----------|
| `revenue_lines` | `status` | `PLANNED`, `INVOICED`, `PAID`, `IN_BANK`, `REALISED` | Revenue should only move forward in this pipeline |
| `cost_lines` | `status` | `PLANNED`, `INVOICED`, `APPROVED`, `PAID` | Cost should only move forward |
| `procurements` | `status` | `requested`, `quoted`, `approved`, `ordered`, `partially_received`, `received`, `invoiced`, `closed` | Full lifecycle; verify no skipped steps |
| `procurements` | `payment_status` | `not_applicable`, `pending_approval`, `approved`, `scheduled`, `paid`, `on_hold` | Must correlate with procurement status |
| `invoice_captures` | `status` | `captured`, `submitted`, `verified`, `approved`, `rejected` | Rejected invoices should not have downstream payments |
| `purchase_orders` | `status` | `draft`, `submitted`, `in_review`, `requires_info`, `blocked`, `approved`, `cancelled` | Cancelled POs should not have active payment requests |
| `payment_requests` | `status` | `new`, `in_review`, `loaded_for_payment`, `proof_attached`, `complete`, `requires_info`, `blocked` | Must link to valid PO or procurement |
| `payment_batches` | `status` | `preparing`, `submitted`, `approved`, `released`, `confirmed` | Batch should only move forward |

### 3E. Quality & Compliance

| Table | Status Column | Valid Values | QA Check |
|-------|--------------|-------------|----------|
| `qc_checklist` | `status` | `active` (default) | Check for any inactive/invalid values |
| `qc_item_instance` | `qm_status` | `not_started` (default) | Verify progression tracking |
| `commissioning_items` | `status` | `not_started`, `in_progress`, `ready_for_review`, `approved`, `closed` | Must match `commissioningStatusEnum` |
| `evidence_evaluations` | `pass` | `true`, `false` | Boolean only |
| `approvals` | `status` | `pending`, `approved`, `rejected` | Must match `approvalStatusEnum`. Rejected approvals should block downstream progression. |

### 3F. Construction & HSE

| Table | Status Column | Valid Values | QA Check |
|-------|--------------|-------------|----------|
| `site_activities` | `status` | `open`, `closed`, `flagged` | Flagged items should have associated snags or incidents |
| `snags` | `status` | `open`, `in_progress`, `resolved`, `verified`, `closed` | Verify resolution chain |
| `site_inspections` | `status` | `scheduled`, `in_progress`, `completed`, `cancelled` | Completed inspections must have a `result` |
| `site_inspections` | `result` | `pass`, `fail`, `conditional`, `pending` | Failed inspections should generate snags or corrective actions |
| `contractor_assignments` | `status` | `active`, `completed`, `terminated` | Terminated contractors should not have active site activities |
| `hse_incidents` | `status` | `open`, `investigating`, `corrective_action`, `closed` | Open incidents must not remain open > 30 days without escalation |
| `corrective_actions` | `status` | `open`, `in_progress`, `completed`, `verified`, `overdue` | Overdue items need attention flags |

### 3G. Handover & Commissioning

| Table | Status Column | Valid Values | QA Check |
|-------|--------------|-------------|----------|
| `handover_packs` | `status` | `draft`, `in_progress`, `submitted`, `accepted`, `rejected` | Rejected packs should allow re-submission |
| `handover_packs` | `checklist_status` | `not_started`, `in_progress`, `complete`, `submitted`, `accepted`, `rejected` | Must align with overall pack status |
| `handover_checklist_items` | `status` | `pending`, `complete`, `not_applicable`, `waived` | Complete % must match item counts |
| `sseg_items` | `status` | `pending`, `submitted`, `approved`, `rejected`, `complete` | Must track municipal submission |
| `sseg_applications` | `application_stage` | `preparation`, `submitted`, `query_received`, `response_sent`, `under_review`, `approved`, `rejected`, `expired` | Long lifecycle; verify no stuck applications |

### 3H. Collaboration & Workflow

| Table | Status Column | Valid Values | QA Check |
|-------|--------------|-------------|----------|
| `meeting_action_items` | `status` | `pending`, `converted`, `dismissed` | Converted items must link to a work item |
| `communication_follow_ups` | `status` | `pending`, `completed`, `dismissed` | No orphan follow-ups |
| `pm_action_items` | `status` | `pending`, `approved`, `rejected`, `completed` | Must tie to a project |

### 3I. Change & Risk Management

| Table | Status Column | Valid Values | QA Check |
|-------|--------------|-------------|----------|
| `change_requests` | `status` | `draft`, `submitted`, `under_review`, `approved`, `rejected`, `implemented`, `closed` | Approved changes should show implementation evidence |
| `raids` | `status` | `open`, `mitigating`, `resolved`, `closed`, `accepted` | Open RAIDs should have an owner |

### 3J. Client & Opportunity Management

| Table | Status Column | Valid Values | QA Check |
|-------|--------------|-------------|----------|
| `clients` | `status` | `active`, `inactive`, `prospect` | Inactive clients should not have active projects |
| `sites` | `status` | `active`, `inactive`, `decommissioned` | Decommissioned sites should not have active work items |
| `opportunities` | `status` | `active`, `won`, `lost`, `on_hold` | Won opportunities should have a linked project |
| `opportunities` | `stage` | `prospect`, `qualification`, `proposal`, `negotiation`, `won`, `lost` | Stage and status must be consistent (e.g., `stage=won` implies `status=won`) |
| `opportunities` | `handover_readiness` | `not_ready`, `in_preparation`, `awaiting_approval`, `ready`, `submitted`, `accepted`, `returned` | Only relevant for won opportunities |

### 3K. Contracts & Commercial

| Table | Status Column | Valid Values | QA Check |
|-------|--------------|-------------|----------|
| `contracts` | `signature_status` | `draft`, `sent`, `negotiating`, `signed`, `expired`, `terminated` | Signed contracts should have a date |
| `subcontractor_assignments` | `status` | `active`, `completed`, `suspended`, `terminated` | Terminated assignments should cascade status to related items |

### 3L. Import & Data Management

| Table | Status Column | Valid Values | QA Check |
|-------|--------------|-------------|----------|
| `smart_import_runs` | `status` | `PREVIEW`, `AWAITING_REVIEW`, `COMMITTED`, `ROLLED_BACK`, `FAILED`, `SUPERSEDED` | No stuck PREVIEW or AWAITING_REVIEW runs older than 7 days |
| `smart_import_runs` | `run_status` | `running`, `success`, `partial`, `fail` | Running status should not persist > 1 hour |
| `import_issues` | `severity` | `INFO`, `WARNING`, `BLOCKER` | BLOCKER issues should prevent COMMITTED status |

---

## 4. STATUS ECOSYSTEM — CROSS-DOMAIN CONSISTENCY RULES

This is the **most critical section**. The platform has multiple status taxonomies that must remain consistent across different domains. A status change in one table often implies constraints on related tables.

### 4A. Universal Status Normalization

The front-end normalizes all domain statuses to a universal set via `normalizeToUniversalStatus()` in shared schema. Verify the mapping is correct:

| Universal Status | Mapped From (examples) |
|-----------------|----------------------|
| `todo` | `TO DO`, `NOT_STARTED`, `pending`, `new`, `draft`, `inbox`, `planned`, `requested`, `preparation` |
| `in_progress` | `IN PROGRESS`, `in_progress`, `investigating`, `mitigating`, `in_review`, `submitted`, `quoted`, `ordered` |
| `review` | `READY_FOR_REVIEW`, `NEEDS APPROVAL`, `ready_for_review`, `PROVIDE FEEDBACK`, `AWAITING_REVIEW`, `under_review` |
| `blocked` | `HOLD`, `BLOCKED`, `blocked`, `requires_info`, `on_hold`, `ESCALATED` |
| `complete` | `COMPLETE`, `APPROVED`, `PROGRESSED`, `done`, `completed`, `closed`, `signed`, `confirmed`, `REALISED`, `PAID` |
| `cancelled` | `cancelled`, `terminated`, `ROLLED_BACK`, `expired`, `rejected` |

**QA CHECK:** Query every status column in the database and verify that `normalizeToUniversalStatus()` can map every value. Flag any unmapped values.

### 4B. Cross-Domain Status Constraints

These rules must hold true **simultaneously** — if any are violated, the UI will show contradictory information depending on which lens/page is viewing the data:

#### Project Lifecycle Constraints
1. If `project_stage_instances.stage_status = 'APPROVED'` for stage S04 (PD→PM Handover), then the project **must** have a `project_execution_state` record with `phase IN ('construction', 'commissioning', 'om')`
2. If ALL 10 stages have `stage_status = 'NOT_STARTED'`, the project should not have active work items with `workstream = 'CONSTRUCTION'`
3. A stage cannot be `APPROVED` if it has any `project_stage_requirements` with `status = 'NOT_STARTED'` (unless an exception with `status = 'APPROVED'` or `'APPROVED_WITH_CONDITIONS'` exists)
4. A stage with `stage_status = 'BLOCKED'` must have at least one dependency with `status = 'WAITING'` or `'ESCALATED'`

#### Task ↔ Deliverable Constraints
5. If a `work_item` has `status = 'COMPLETE'`, any linked `deliverables` should also be `COMPLETE` or `QC APPROVED` or `OPERATIONAL APPROVAL`
6. If a `deliverable` has `status = 'QC APPROVED'`, the associated work item should not be `TO DO`
7. `task_deliverables` with `acknowledged = true` should only link to deliverables with status `COMPLETE` or `QC APPROVED`

#### Finance Consistency
8. If a `procurement` has `status = 'closed'`, its `payment_status` should be `paid` or `not_applicable` — not `pending_approval`
9. If a `purchase_order` has `status = 'cancelled'`, there should be no `payment_requests` with `status IN ('new', 'in_review', 'loaded_for_payment')` linked to it
10. If a `revenue_line` has `status = 'REALISED'`, it should have a non-null `amount` and the parent project should have `status != 'cancelled'`
11. A `payment_batch` with `status = 'confirmed'` should have all child `payment_requests` at `status = 'complete'`

#### Quality & Handover Constraints
12. If `commissioning_items` for a project are ALL `approved` or `closed`, the project's S07 (Commissioning) stage should be `APPROVED` or `PROGRESSED`
13. If a `handover_pack` has `status = 'accepted'`, all its `handover_checklist_items` must be `complete` or `not_applicable` or `waived`
14. If a `handover_pack` has `checklist_status = 'accepted'` but `status = 'draft'`, that is a **data inconsistency**

#### Construction ↔ HSE Constraints
15. If a `site_inspection` has `result = 'fail'`, there should be at least one `snag` or `corrective_action` created for that project
16. If a `contractor_assignment` has `status = 'terminated'`, any linked `site_activities` should be `closed`
17. An `hse_incident` with `status = 'closed'` should have all its `corrective_actions` at `completed` or `verified`

#### Opportunity ↔ Project Constraints
18. If `opportunities.status = 'won'`, there should be a corresponding record in `project_info` (or a clear link)
19. If `opportunities.stage = 'lost'` but `opportunities.status = 'active'`, that is a **contradiction**
20. `opportunities.handover_readiness = 'accepted'` should only exist when `status = 'won'`

### 4C. Soft Delete Consistency

Many tables use `deleted_at` for soft deletes. Verify:
- No active relationships pointing to soft-deleted records (e.g., a `work_item` with `deleted_at IS NOT NULL` should not appear in any active `work_item_assignments` or active `deliverables`)
- Soft-deleted items must not appear in any API response unless explicitly requested (e.g., admin recovery endpoint)
- `deleted_by` should always be set when `deleted_at` is set

### 4D. Temporal Consistency

- `updated_at >= created_at` for all records
- `work_item_status_history.changed_at` should be chronologically ordered per work item
- `project_stage_decisions` timestamps should align with stage status changes
- No future-dated `created_at` values (beyond now + reasonable clock drift)

---

## 5. LENS SYSTEM — ROLE-BASED UX PERSONALIZATION

The platform uses a **Lens System** that personalizes the UI per role without changing data permissions. Every status, count, and data point must be **identical regardless of which lens views it** — lenses only change layout, navigation, and emphasis — never the underlying truth.

### 5A. The 13 Canonical Lens Roles

| # | Lens Role | Landing Page | Accessible Modules |
|---|-----------|-------------|-------------------|
| 1 | `CEO` | `/gates` | HOME, EXECUTIVE, PORTFOLIO, FINANCE, PIPELINE, REPORTS, PROJECTS |
| 2 | `COO_SUPER_ADMIN` | `/admin/control-center` | ALL 12 modules |
| 3 | `CFO` | `/cashflow` | HOME, FINANCE, EXECUTIVE, PORTFOLIO, REPORTS, PROJECTS |
| 4 | `HEAD_OF_PROJECT_DEVELOPMENT` | `/pd` | HOME, PIPELINE, PROJECTS, PORTFOLIO, FINANCE, REPORTS |
| 5 | `PROGRAM_MANAGER` | `/gates` | HOME, DELIVERY, PROJECTS, PORTFOLIO, ENGINEERING, COMPLIANCE, FINANCE, REPORTS |
| 6 | `CONSTRUCTION_MANAGER` | `/construction` | HOME, DELIVERY, PROJECTS, COMPLIANCE, ENGINEERING, FINANCE, REPORTS |
| 7 | `PROGRAM_FINANCE_MANAGER` | `/cashflow` | HOME, FINANCE, PROJECTS, DELIVERY, REPORTS |
| 8 | `HSE_MANAGER` | `/hse` | HOME, COMPLIANCE, PROJECTS, DELIVERY, REPORTS |
| 9 | `SSEG_MANAGER` | `/hse` | HOME, COMPLIANCE, PROJECTS, ENGINEERING, DELIVERY, REPORTS |
| 10 | `QUALITY_MANAGER` | `/quality` | HOME, COMPLIANCE, PROJECTS, DELIVERY, ENGINEERING, REPORTS |
| 11 | `ENGINEER` | `/engineering` | HOME, ENGINEERING, PROJECTS, DELIVERY, COMPLIANCE |
| 12 | `PROJECT_MANAGER` | `/gates` | HOME, DELIVERY, PROJECTS, FINANCE, ENGINEERING, COMPLIANCE, REPORTS |
| 13 | `PROJECT_DEVELOPER` | `/pd` | HOME, PIPELINE, PROJECTS, FINANCE, REPORTS |

### 5B. The 12 Canonical Modules

`HOME`, `EXECUTIVE`, `PORTFOLIO`, `PIPELINE`, `PROJECTS`, `DELIVERY`, `FINANCE`, `ENGINEERING`, `COMPLIANCE`, `DOCUMENTS`, `REPORTS`, `ADMIN`

### 5C. Lens Database Tables

| Table | Purpose | QA Check |
|-------|---------|----------|
| `role_lens_profiles` | Landing page, allowed modules, nav priority, quick actions, default filters, widget layout per lens | Every lens role must have exactly one profile row. Allowed modules must match Section 5A. |
| `role_homepage_widgets` | Widget cards per lens role | Widgets must only reference modules the lens has access to |
| `lens_simulation_sessions` | COO-only ability to simulate other lenses | Only `COO_SUPER_ADMIN` users should have simulation sessions |
| `role_homepage_snapshots` | Pre-computed homepage data | Snapshot data must be refreshable and not stale > 24h |

### 5D. COO Super Admin Simulation

The COO can simulate any other lens in two modes:
- **`read_only`**: COO sees the other role's view but retains their own permissions
- **`full_power`**: COO acts as that role with full permissions

**QA CHECK — THE GOLDEN RULE:**
> **When the COO simulates any lens, the data values (counts, statuses, totals) they see MUST be identical to what a real user with that lens role sees.** If the CEO lens shows 5 projects with status "APPROVED" on the gates page, the COO simulating CEO must also see exactly 5. Any discrepancy means the lens system is leaking data or filtering incorrectly.

### 5E. Lens Consistency Checks

Run these checks across ALL 13 lenses:

1. **Status counts must be identical across lenses for shared views.** If the `/gates` page shows 3 projects `BLOCKED`, that number must be the same whether viewed by CEO, PROGRAM_MANAGER, or PROJECT_MANAGER (all have access to that page).
2. **Module access enforcement.** A lens that does NOT include `FINANCE` in its modules must NOT be able to navigate to `/cashflow`, `/revenue-tracker`, `/cos`, `/gp-tracker`, or any finance route. Verify the page registry enforces this.
3. **Landing page validity.** Each lens's landing page must be a route the lens has access to. A lens with landing `/quality` must have `COMPLIANCE` in its modules.
4. **Widget data isolation.** Homepage widgets must only show data from modules the lens can access. An ENGINEER lens widget must not show finance summaries.
5. **Nav ordering.** Each lens has a `navPriority` config. Verify the sidebar renders modules in the correct priority order per lens.
6. **Default filters.** If a lens has default filters (e.g., QUALITY_MANAGER defaults to compliance-flagged items), verify those filters are applied on page load and can be cleared by the user.

---

## 6. ACCESS CONTROL — PERMISSIONS, PROJECT ACCESS, AND RLS

The platform does NOT use PostgreSQL RLS policies. Instead, access control is enforced at the **application layer** via the `projectAccess` table and permission middleware.

### 6A. Project Access Table (`project_access`)

| Column | Type | Purpose |
|--------|------|---------|
| `project_id` | FK → `project_info` | Which project |
| `user_id` | FK → `users` | Which user |
| `access_level` | text | `owner`, `contributor`, `viewer`, `none` |
| `role_on_project` | text | `pm`, `pd`, `construction_manager`, `quality_lead`, `compliance`, `kam`, `finance`, `engineering`, `hse`, `om` |
| `stages_visible` | text[] | Array of stage codes; empty = all stages visible |
| `can_edit` | boolean | Edit capability |
| `can_approve` | boolean | Approval capability |
| `granted_by_user_id` | FK → `users` | Who granted |
| `granted_at` | timestamp | When granted |
| `expires_at` | timestamp | Optional expiration |

### 6B. Access Level Hierarchy

```
owner > contributor > viewer > none
```

### 6C. QA Checks for Access Control

1. **No orphan access records.** Every `project_access` row must reference a valid `project_id` and `user_id` that both exist and are not soft-deleted.
2. **At least one owner.** Every active project must have at least one `project_access` row with `access_level = 'owner'`.
3. **Expired access enforcement.** Any `project_access` row where `expires_at < NOW()` should not grant access. Verify the API layer checks this.
4. **`none` access enforcement.** A user with `access_level = 'none'` must be fully blocked from seeing the project in any API response or UI list.
5. **Stage visibility.** If `stages_visible` is set (non-empty array), the user must only see those stages in the gate view. Empty array = all stages visible.
6. **Edit/Approve consistency.** `can_approve = true` should imply `can_edit = true` (you shouldn't be able to approve something you can't even edit). Flag any rows where `can_approve = true AND can_edit = false`.
7. **Role-on-project validity.** Every `role_on_project` value must be one of: `pm`, `pd`, `construction_manager`, `quality_lead`, `compliance`, `kam`, `finance`, `engineering`, `hse`, `om`.

### 6D. Permission Middleware Files

| File | Purpose | QA Check |
|------|---------|----------|
| `server/api/v2/policies/access-policy.ts` | Project-level access gate | Every API route that returns project data must pass through this |
| `server/api/v2/policies/permission-catalog.ts` | Entity-level permission definitions | Verify all entities have permissions defined |
| `server/api/v2/middleware/permission-helper.ts` | Permission check helpers | Must be called before any mutation endpoint |
| `server/services/source-of-truth-policy.ts` | Data integrity enforcement | Must prevent conflicting writes |
| `server/imports/import-conflict-policy.ts` | Import vs. existing data conflict resolution | Must respect access control during imports |

### 6E. Trustworthiness — Access Leakage Tests

Run these queries/checks to verify no data leaks:

1. **API response audit.** For a `viewer` user, call every API endpoint and verify no write endpoints (POST, PUT, PATCH, DELETE) succeed.
2. **Cross-project leakage.** For a user with access to Project A but NOT Project B, verify that no API endpoint returns Project B data, including:
   - Work items from Project B
   - Financial data from Project B
   - Deliverables from Project B
   - Stage instances from Project B
3. **`none` access test.** Create or find a user with `access_level = 'none'` on a project. Verify the project does not appear in ANY list, search result, or aggregate count.
4. **Expired access test.** Find any `project_access` rows with `expires_at` in the past. Verify those users cannot access the project via API.

---

## 7. API LAYER — ROUTES, SERVICES, AND MIDDLEWARE

### 7A. Route File Inventory

Every route file below exposes endpoints under `/api/`. Verify each one enforces auth and permission checks.

**Core Routes:**
| Route File | Domain | Key Endpoints |
|------------|--------|---------------|
| `server/routes.ts` | Master router | Registers all sub-routers |
| `server/role-auth-routes.ts` | Auth | Login, logout, JWT refresh, role resolution |
| `server/task-management-routes.ts` | Work Items | CRUD for tasks, status transitions, assignments |
| `server/engineering-routes.ts` | Engineering | Deliverables, eng stages, eng tasks, drawing register |
| `server/eng-stage-routes.ts` | Eng Stages | Stage instance CRUD, task status updates |
| `server/stage-lifecycle-routes.ts` | Gates | Stage instances, requirements, exceptions, decisions |
| `server/stage-data-routes.ts` | Stage Data | Bulk stage data retrieval |
| `server/stage-collaboration-routes.ts` | Stage Collab | Comments, reviews per stage |
| `server/approvals-routes.ts` | Approvals | Create/review approvals (gate, budget, handover) |
| `server/quality-routes.ts` | Quality | QC checklists, items, evidence |
| `server/quality-ncr-routes.ts` | NCRs | Non-conformance reports |
| `server/commissioning-routes.ts` | Commissioning | Commissioning items, status updates |
| `server/commissioning-dashboard-routes.ts` | Comm Dashboard | Dashboard aggregates |

**Finance Routes:**
| Route File | Domain | Key Endpoints |
|------------|--------|---------------|
| `server/departments/finance-routes.ts` | Finance Core | Revenue/cost lines, budgets |
| `server/departments/financial-integration-routes.ts` | Finance Integration | External system sync |
| `server/departments/fye-revenue-tracking-routes.ts` | FYE Revenue | Financial year-end tracking |
| `server/departments/budget-baseline-routes.ts` | Budget Baseline | Baseline management |
| `server/procurement-routes.ts` | Procurement | Procurement lifecycle |
| `server/po-routes.ts` | Purchase Orders | PO CRUD, approval workflow |
| `server/payment-request-routes.ts` | Payment Requests | Payment request lifecycle |
| `server/payment-batch-routes.ts` | Payment Batches | Batch processing |
| `server/invoice-capture-routes.ts` | Invoice Capture | Invoice workflow |
| `server/invoice-pattern-routes.ts` | Invoice Analysis | Pattern recognition |
| `server/proof-of-payment-routes.ts` | Proof of Payment | Attach/verify proof |
| `server/financial-review-routes.ts` | Financial Review | S05 stage financial review |

**Construction, HSE, Handover:**
| Route File | Domain | Key Endpoints |
|------------|--------|---------------|
| `server/departments/construction-routes.ts` | Construction | Site activities, snags, inspections |
| `server/departments/hse-routes.ts` | HSE | Incidents, corrective actions |
| `server/departments/handover-routes.ts` | Handover | Handover packs, checklists |
| `server/handover-routes.ts` | Handover (legacy) | May duplicate above — flag if both active |
| `server/subcontractor-routes.ts` | Subcontractors | Contractor assignments |

**Portfolio, Pipeline, PD:**
| Route File | Domain | Key Endpoints |
|------------|--------|---------------|
| `server/portfolio-routes.ts` | Portfolio | Portfolio-level views |
| `server/pd-routes.ts` | Project Development | PD dashboard, tickets |
| `server/lifecycle-routes.ts` | Lifecycle Board | Board view data |
| `server/departments/project-routes.ts` | Projects (v2) | Project CRUD (new controller) |
| `server/project-events-routes.ts` | Project Events | Event log |
| `server/ee-info-routes.ts` | EE Info | Company/project info lookup |

**Collaboration & PM:**
| Route File | Domain | Key Endpoints |
|------------|--------|---------------|
| `server/collaboration-workflow-routes.ts` | Collaboration | Comments, follow-ups, action items |
| `server/meeting-routes.ts` | Meetings | Meeting CRUD, action items |
| `server/standup-routes.ts` | Standups | Daily standup data |
| `server/pm-routes.ts` | PM Tools | PM-specific views |
| `server/pm-on-the-go-routes.ts` | PM Mobile | Mobile-optimized endpoints |
| `server/notification-routes.ts` | Notifications | Notification CRUD, mark-read |
| `server/departments/notification-trigger-routes.ts` | Notification Triggers | Auto-trigger config |

**Admin & System:**
| Route File | Domain | Key Endpoints |
|------------|--------|---------------|
| `server/admin-control-routes.ts` | Admin Control | System config, user management |
| `server/admin-recovery-routes.ts` | Recovery | Soft-delete recovery, data repair |
| `server/smart-import-routes.ts` | Smart Import | Excel import pipeline |
| `server/sync-routes.ts` | Sync | Microsoft 365 sync |
| `server/ms-sync-routes.ts` | MS Sync | Teams/Planner sync |
| `server/audit-routes.ts` | Audit | Audit log queries |
| `server/analytics-routes.ts` | Analytics | Usage analytics |
| `server/report-routes.ts` | Reports | Report generation |
| `server/platform-routes.ts` | Platform | Health, version, build info |
| `server/health-diagnostics.ts` | Diagnostics | System health checks |
| `server/template-routes.ts` | Templates | Stage/task templates |
| `server/change-control-routes.ts` | Change Control | Change requests |
| `server/raid-routes.ts` | RAID | Risk/issue tracking |
| `server/dependency-routes.ts` | Dependencies | Inter-department dependencies |
| `server/deliverable-capture-routes.ts` | Deliverable Capture | File capture workflow |
| `server/engineering-intake-routes.ts` | Eng Intake | Engineering request intake |
| `server/kpi-traceability-routes.ts` | KPI | KPI traceability |
| `server/tr-register-routes.ts` | TR Register | Technical review register |
| `server/weekly-review-routes.ts` | Weekly Review | Weekly review data |
| `server/gamification-routes.ts` | Gamification | Points, badges |
| `server/exception-dashboard-routes.ts` | Exceptions | Exception queue |
| `server/user-dashboard-preferences-routes.ts` | Preferences | User dashboard config |
| `server/departments/board-pack-routes.ts` | Board Packs | Board pack generation |
| `server/departments/exco-routes.ts` | ExCo | Executive committee views |
| `server/departments/priority-strategic-routes.ts` | Strategy | Strategic priority tracking |
| `server/departments/sites-routes.ts` | Sites | Site management |
| `server/departments/drawing-register-routes.ts` | Drawings | Drawing register |
| `server/departments/data-backfill-routes.ts` | Backfill | Data migration/backfill |

### 7B. Service Layer

| Service File | Purpose | QA Check |
|-------------|---------|----------|
| `server/services/source-of-truth-policy.ts` | Enforces single source of truth for data | Verify no conflicting writes bypass this |
| `server/api/v2/services/audit-service.ts` | Audit trail logging | Every mutation endpoint must call this |
| `server/api/v2/services/project-v2-service.ts` | Project business logic | Verify status transition validation |
| `server/ms-sync-service.ts` | Microsoft 365 sync | Verify sync doesn't overwrite manual status changes |
| `server/ms-account-service.ts` | Microsoft account management | Verify token refresh handling |
| `server/project-linking-service.ts` | Project linking logic | Verify cross-reference integrity |
| `server/importPipeline.ts` | Import processing | Verify import doesn't create invalid statuses |
| `server/cpmEngine.ts` | Critical path calculation | Verify CPM uses correct status data |

### 7C. API Layer QA Checks

1. **Auth on every route.** Every route file except `platform-routes.ts` (health check) must enforce JWT auth middleware. Scan for routes missing `requireAuth` or equivalent.
2. **Permission checks on mutations.** Every POST, PUT, PATCH, DELETE endpoint must verify the user has the correct `access_level` and `can_edit`/`can_approve` before proceeding.
3. **Status transition validation.** The API must enforce valid status transitions (e.g., a work item cannot go from `TO DO` directly to `COMPLETE` without passing through `IN PROGRESS`). Check if `canTransition()` or `task-workflow-guard.ts` is called.
4. **Response filtering.** API responses must filter out soft-deleted records (`deleted_at IS NOT NULL`) unless the endpoint is specifically for recovery/admin.
5. **Audit trail completeness.** Every mutation (create, update, delete) should generate an `audit_events` record with the correct `source` (UI, IMPORT, SETTINGS, etc.).
6. **Error responses.** API errors must return proper HTTP status codes (401, 403, 404, 422) — not generic 500s. Check error handling patterns.
7. **Duplicate route detection.** Both `server/handover-routes.ts` and `server/departments/handover-routes.ts` exist. Verify they don't serve conflicting endpoints or one has been deprecated.

---

## 8. FRONT-END LAYER — PAGES, COMPONENTS, AND FILTERING

### 8A. Complete Page Inventory

Verify every page loads without errors, displays correct data, and respects the active lens.

**Personal Workspace:**
| Route | Page | Key Data | QA Check |
|-------|------|----------|----------|
| `/` | Home | Role-based landing via `useLensContext` | Renders correct landing per lens role |
| `/my-work` | My Work Hub | Tasks, approvals, meetings, email | Aggregates from all sources correctly |
| `/my-work/tasks` | Task Board | Board/list view with status columns | All statuses render in correct columns |
| `/my-work/calendar` | Calendar | Calendar view | Events display at correct dates |
| `/my-work/meetings` | Meetings | Microsoft Teams integration | Shows correct meeting status |
| `/my-work/email` | Email | Email integration | Renders email state |
| `/inbox` | Inbox | Unified notifications | Mark-read works, counts update |

**Project Management:**
| Route | Page | Key Data | QA Check |
|-------|------|----------|----------|
| `/projects` | Project List | All accessible projects | Respects `projectAccess` — no unauthorized projects |
| `/project/:projectName` | Project Detail | Tabs: Overview, Planning, Eng, Finance, Quality, Approvals, Handover | All tabs render without errors for every project |
| `/project/:projectName/gate/:stageCode` | Gate Control | Stage requirements, exceptions, evidence | Shows correct stage status and completion % |
| `/lifecycle-board` | Lifecycle Board | All 10 stages across all projects | Status pills match DB exactly |
| `/execution-board` | Execution Board | Overview/Program/Finance views | Financial totals match finance module |
| `/commissioning-dashboard` | Commissioning | Commissioning control tower | Item counts match `commissioning_items` table |

**Engineering:**
| Route | Page | Key Data | QA Check |
|-------|------|----------|----------|
| `/engineering` | Eng Dashboard | Task overview | Aggregated counts match DB |
| `/engineering/tasks` | Task Board | 5-column Kanban (todo/in_progress/blocked/review/done) | Cards in correct columns; filters work |
| `/engineering/standup` | Standup View | Daily standup lanes | Blockers display correctly |
| `/engineering/audit` | Eng Audit | Audit log | All changes appear |

**Finance:**
| Route | Page | Key Data | QA Check |
|-------|------|----------|----------|
| `/cashflow` | Cashflow | Revenue + cost tracking | Totals match DB sums |
| `/revenue-tracker` | Revenue | Revenue line items | Status badges match `revenue_lines.status` |
| `/cos` | Cost of Sales | Cost line items | Status badges match `cost_lines.status` |
| `/gp-tracker` | Gross Profit | Calculated margins | GP = Revenue - COS (verify arithmetic) |
| `/counterparties` | Counterparties | Suppliers/partners | Active/inactive status correct |
| `/invoice-patterns` | Invoice Analysis | Pattern data | Matches invoice capture data |
| `/fye-revenue-tracking` | FYE Revenue | Year-end tracking | Aligns with fiscal year config |

**Quality & Gates:**
| Route | Page | Key Data | QA Check |
|-------|------|----------|----------|
| `/quality` | QM Dashboard | QC overview | Checklist counts match DB |
| `/gates/pipeline` | Gate Pipeline | All projects across stages | Stage status matches `project_stage_instances` |
| `/gates/ready` | Ready for Review | Items with `READY_FOR_REVIEW` | Count matches DB query |
| `/gates/blocked` | Blocked Items | Items with `BLOCKED` status | Count matches DB query |
| `/gates/exceptions` | Exceptions | Items with exception requests | Matches `project_stage_exceptions` |
| `/gates/client-updates` | Client Updates | Communication tracking | Links to correct projects |
| `/gates/handovers` | Handover Tracking | Handover pack status | Matches `handover_packs` table |
| `/gates/queries` | Open Queries | Unresolved questions | No stale queries hidden |
| `/gates/commitments` | Commitments | Tracked commitments | All commitments visible |
| `/exceptions` | Exception Queue | All pending exceptions | Matches pending exception count in DB |

**Admin:**
| Route | Page | Key Data | QA Check |
|-------|------|----------|----------|
| `/admin/roles` | Roles & Permissions | User role config | Role changes take effect immediately |
| `/admin/control-center` | Control Center | System config | Only COO_SUPER_ADMIN can access |
| `/admin/smart-import` | Smart Import | Excel import | Import status matches `smart_import_runs` |
| `/admin/stage-lifecycle` | Stage Config | Stage definitions | Changes reflect in gate views |
| `/admin/recovery` | Recovery Center | Soft-deleted records | Can restore deleted items |

**Other:**
| Route | Page | Key Data | QA Check |
|-------|------|----------|----------|
| `/company-overview` | Executive Health | KPIs, department health grid | RAG statuses match computed values |
| `/portfolio` | Portfolio | Portfolio management | Project counts match per portfolio |
| `/pd` | PD Dashboard | Pipeline data | Opportunity counts match DB |
| `/pd/tickets` | PD Tickets | Ticket management | Status tracking correct |

### 8B. Critical UI Components

| Component | File | Purpose | QA Check |
|-----------|------|---------|----------|
| `StatusBadge` | `components/StatusBadge.tsx` | Generic status badge | Colors match status-colors.ts definitions |
| `LensSwitcher` | `components/layout/LensSwitcher.tsx` | COO role simulation | Switching lenses changes view correctly |
| `TrackerTable` | `components/dashboard/TrackerTable.tsx` | Generic data table | Search + column filtering works |
| `AttentionPanel` | `components/dashboard/AttentionPanel.tsx` | Alert/exception display | Severity grouping correct |
| `EngineeringStagesTab` | `components/tabs/EngineeringStagesTab.tsx` | Eng stage display | Task status colors correct |
| `AppLayout` | `components/layout/AppLayout.tsx` | Main shell + nav | Module visibility per lens |
| `NavOrderCustomizer` | `components/layout/NavOrderCustomizer.tsx` | Custom nav order | Persists across sessions |
| `NotificationBell` | `components/NotificationBell.tsx` | Activity notifications | Count updates in real-time |

### 8C. Status Color Mapping

Verify these color mappings are consistently applied across ALL pages (from `client/src/lib/status-colors.ts`):

**Task Statuses:**
| Status | Background | Text |
|--------|-----------|------|
| `todo` / `TO DO` | slate-100 | slate-700 |
| `in_progress` / `IN PROGRESS` | amber-100 | amber-700 |
| `review` / `NEEDS APPROVAL` | amber-100 | amber-700 |
| `blocked` / `HOLD` | red-100 | red-700 |
| `complete` / `COMPLETE` | emerald-100 | emerald-700 |
| `cancelled` | slate-100 | slate-700 |

**RAG Status:**
| Status | Background | Text |
|--------|-----------|------|
| `green` | emerald-50 | emerald-700 |
| `amber` | amber-50 | amber-700 |
| `red` | red-50 | red-700 |

**Priority Levels:**
| Priority | Background | Text |
|----------|-----------|------|
| `Critical` / `Urgent` | red-100 | red-700 |
| `High` | orange-100 | orange-700 |
| `Medium` / `Med` | blue-100 | blue-700 |
| `Low` | green-100 | green-700 |

**QA CHECK:** Scan every page for inline status styling that bypasses `statusBadgeClasses()`. Any hardcoded color that doesn't match the table above is a bug.

### 8D. State Management Audit

| Provider/Hook | Purpose | QA Check |
|--------------|---------|----------|
| `AuthProvider` / `useAuth()` | User, login state, isAdmin, isQm | Token refresh works, stale tokens rejected |
| `LensProvider` / `useLensContext()` | Natural lens, active lens, simulation | Switching lens doesn't lose in-progress data |
| `ExecutionDashboardContext` | Dashboard filter state | Filters persist across tab switches |
| `@tanstack/react-query` | Server state caching | Cache invalidation triggers on mutations (check `task-cache.ts`) |
| `useAccessMatrix()` | Permission checks | Correctly hides/disables controls for unauthorized actions |
| `useEngineeringTaskFilters()` | Eng task filter state | Filters correctly compose with each other |
| `usePermission()` | Entity-level checks | Matches API-side permission checks |
| `useNavPreferences()` | Sidebar customization | Respects lens module access |

### 8E. Filter System Audit

The platform has multiple layers of filtering. Verify they compose correctly:

**Engineering Tasks Filters:**
| Filter | Options | QA Check |
|--------|---------|----------|
| Due Date | `all`, `overdue`, `today`, `this_week`, `no_due_date` | `overdue` shows only past-due items |
| Workload State | `all`, `unassigned`, `blocked`, `review`, `approval`, `deliverable`, `microsoft_action` | Each filter returns correct subset |
| Linked Source | `all`, `project_linked`, `unlinked`, `microsoft_linked`, `microsoft_action_required` | Linking status matches DB |
| Priority | `Critical`, `Urgent`, `High`, `Medium`, `Low` | Matches `work_items.priority` |

**My Work Task Sources:**
| Source | QA Check |
|--------|----------|
| `personal` | Only shows user's personal tasks |
| `operational` | Shows assigned operational work items |
| `plan` | Shows planned items |
| `engineering` | Shows engineering tasks assigned to user |
| `quality` | Shows quality items assigned to user |
| `approvals` | Shows pending approvals for user |
| `deliverables` | Shows deliverables assigned to user |
| `microsoft` | Shows Microsoft-synced items |

**Execution Board Filters:**
| Filter | QA Check |
|--------|----------|
| Fiscal Year | Data aggregates for selected FY only |
| Portfolio | Filters to selected portfolio projects |
| PM | Filters to projects managed by selected PM |
| PD | Filters to projects developed by selected PD |
| Execution Phase | Filters by phase (design/construction/commissioning/om) |
| Import Freshness | Shows data staleness per project |

---

## 9. CROSS-CUTTING QA — STATUS CONSISTENCY ACROSS ALL LENSES

This section defines the **"no matter what lens" rule** — the core invariant that every status, count, and data point must be consistent regardless of which lens, page, or filter is viewing it.

### 9A. The Golden Invariants

These must hold true at all times. If ANY of these fail, it is a **P0 bug**:

1. **Same data, different view.** A project's stage status (e.g., S06 = `IN_PROGRESS`) must display identically on:
   - The `/lifecycle-board` page (viewed by any lens with access)
   - The `/project/:name/gate/S06_CONSTRUCTION` page
   - The `/gates/pipeline` page
   - The `/execution-board` overview
   - The `/company-overview` executive health grid
   - The `/portfolio` page
   - The COO simulation of any lens

2. **Aggregate counts must match.** If the home page widget says "5 tasks blocked", then:
   - The `/my-work/tasks` board shows exactly 5 cards in the "blocked" column
   - The `/engineering/tasks` board (if filtered to same scope) shows the same 5
   - The DB query `SELECT COUNT(*) FROM work_items WHERE status = 'HOLD' AND deleted_at IS NULL AND assigned_to = :userId` returns 5

3. **Financial totals must be single-source.** The cashflow total shown on:
   - `/cashflow`
   - `/execution-board` Finance tab
   - `/company-overview` finance summary
   - `/gp-tracker`
   - Widget on CFO home page
   ...must ALL be derived from the same underlying `revenue_lines` and `cost_lines` query. No hardcoded or cached totals that diverge.

4. **Status badge color must be deterministic.** A status value of `IN PROGRESS` must ALWAYS render as amber-100/amber-700. Never different colors on different pages.

5. **Filter intersection must be correct.** If Engineering Tasks is filtered by `priority = High` AND `due = overdue`, the result set must be the intersection, not the union. Verify no OR logic where AND is expected.

### 9B. Cross-Page Data Consistency Matrix

For each data entity, list every page/component that displays it and verify they all show the same value:

| Data Entity | Pages That Display It | Must Match |
|------------|----------------------|------------|
| Project stage status | Lifecycle Board, Gate Control, Pipeline, Execution Board, Portfolio, Company Overview | `project_stage_instances.stage_status` |
| Work item status | My Work Tasks, Engineering Tasks, Project Detail, Standup View | `work_items.status` |
| Work item count by status | Home widgets, My Work summary, Engineering dashboard, Standup blockers | COUNT query with same filters |
| Deliverable status | Engineering page, Project Detail Eng tab, Deliverable Capture | `deliverables.status` |
| Revenue total | Cashflow, Revenue Tracker, Execution Board Finance, GP Tracker, FYE Revenue | SUM of `revenue_lines.amount` by status |
| Cost total | COS, Execution Board Finance, GP Tracker | SUM of `cost_lines.amount` by status |
| Procurement status | Procurement page, Project Detail Finance tab, Counterparties | `procurements.status` |
| QC checklist completion | Quality Dashboard, Project Detail Quality tab, Gate Control | COUNT of completed/total items |
| Commissioning progress | Commissioning Dashboard, Project Detail, S07 Gate | COUNT of approved/total `commissioning_items` |
| Handover status | Handover page, Gates/Handovers, Project Detail | `handover_packs.status` |
| Exception count | Exception Queue, Gates/Exceptions, Gate Control page | COUNT of pending exceptions |
| Approval status | Approvals list, Project Detail Approvals tab, Gate Control | `approvals.status` |
| RAID status | RAID page, Project Detail | `raids.status` |
| Snag/NCR count | Construction page, Quality NCR page, Project Detail | COUNT of open items |
| Notification count | NotificationBell, Inbox | COUNT of unread notifications |

### 9C. Lens-Specific Consistency Tests

For each of the 13 lenses, verify:

1. **CEO lens:** Gates pipeline shows all projects. Finance summary on home matches `/cashflow`. Portfolio summary matches `/portfolio`.
2. **COO_SUPER_ADMIN lens:** Can see everything. When simulating CEO, sees exactly what CEO sees (not more, not less).
3. **CFO lens:** Finance pages show correct totals. Cannot access engineering or construction pages.
4. **HEAD_OF_PROJECT_DEVELOPMENT lens:** Pipeline data matches `/pd`. Cannot access admin or compliance pages.
5. **PROGRAM_MANAGER lens:** Gates view shows all assigned projects. Delivery items match per-project views.
6. **CONSTRUCTION_MANAGER lens:** Construction data matches site activities. Cannot access PD pipeline.
7. **PROGRAM_FINANCE_MANAGER lens:** Finance data matches CFO view (same numbers). Cannot access admin.
8. **HSE_MANAGER lens:** HSE incidents match `/departments/hse` data. Cannot access finance details.
9. **SSEG_MANAGER lens:** SSEG applications match data on compliance pages.
10. **QUALITY_MANAGER lens:** Quality dashboard counts match per-project QC data.
11. **ENGINEER lens:** Engineering tasks match across dashboard and project-level views. Cannot access finance.
12. **PROJECT_MANAGER lens:** All project data accessible. Finance tab on project matches finance module.
13. **PROJECT_DEVELOPER lens:** Pipeline data correct. Cannot access construction or HSE pages.

### 9D. COO Simulation Parity Test

This is the most important consistency test. For EVERY lens role:

```
1. Log in as a real user with that lens role
2. Navigate to their landing page
3. Record all visible counts, statuses, totals
4. Log in as COO
5. Activate lens simulation for that role
6. Navigate to the same page
7. Compare all values — they MUST be identical
```

Any discrepancy means the simulation is filtering data differently than the real role, which undermines trust in the entire system.

---

## 10. TEST SCENARIOS — SPECIFIC CASES PER DOMAIN

Execute each scenario and record pass/fail.

### 10A. Project Lifecycle (Gate System)

| # | Scenario | Steps | Expected Result |
|---|----------|-------|----------------|
| PL-01 | New project has all 10 stages | Query `project_stage_instances` for a newly created project | Exactly 10 rows, one per stage code S01-S10, all `NOT_STARTED` |
| PL-02 | Stage progression | Advance S01 from `NOT_STARTED` → `IN_PROGRESS` → `READY_FOR_REVIEW` → `APPROVED` → `PROGRESSED` | Each transition is recorded in `project_stage_decisions`, `stage_status` updates correctly |
| PL-03 | Stage blocking | Set a dependency to `WAITING` on S03 | S03 should show `BLOCKED` or prevent progression past `IN_PROGRESS` |
| PL-04 | Exception flow | Request exception on S04, approve it | S04 should allow `EXCEPTION_APPROVED` status, exception record shows `APPROVED` |
| PL-05 | Requirement completion | Mark all S01 requirements as `COMPLETE` | S01 should be eligible for `READY_FOR_REVIEW` |
| PL-06 | Waived requirement | Waive one requirement on S02 | S02 can still progress if all other requirements are complete |
| PL-07 | Stage rollback | Issue a `STAGE_ROLLBACK` decision on S03 | S03 reverts to `IN_PROGRESS`, decision is logged |

### 10B. Work Items & Tasks

| # | Scenario | Steps | Expected Result |
|---|----------|-------|----------------|
| WI-01 | Create work item | POST a new work item via API | Created with `TO DO` status, appears in `/my-work/tasks` |
| WI-02 | Status transition | Move from `TO DO` → `IN PROGRESS` → `NEEDS APPROVAL` → `QC APPROVED` → `COMPLETE` | Each transition logged in `work_item_status_history` |
| WI-03 | Invalid transition | Attempt `TO DO` → `COMPLETE` directly | API should reject (if workflow guard enabled) or history records the jump |
| WI-04 | Workstream filtering | Filter tasks by `workstream = 'ENG'` | Only engineering tasks appear |
| WI-05 | Soft delete | Delete a work item | `deleted_at` set, item no longer appears in any list or count |
| WI-06 | Recovery | Restore a soft-deleted item via admin recovery | Item reappears with original status |
| WI-07 | Assignment | Assign task to a user | User sees it in their `/my-work/tasks` |
| WI-08 | Priority filter | Filter by `priority = 'Urgent'` | Only urgent items shown, count matches DB |

### 10C. Finance

| # | Scenario | Steps | Expected Result |
|---|----------|-------|----------------|
| FN-01 | Revenue pipeline | Create revenue line at `PLANNED`, advance to `INVOICED` → `PAID` → `IN_BANK` → `REALISED` | Status updates in DB, cashflow page updates |
| FN-02 | Cost pipeline | Create cost line at `PLANNED`, advance through statuses | Cost page updates, GP tracker recalculates |
| FN-03 | Procurement lifecycle | Create procurement at `requested`, advance to `closed` | All intermediate statuses valid, payment status tracks |
| FN-04 | PO cancellation | Cancel a purchase order | All linked payment requests should be blocked/cancelled |
| FN-05 | Invoice rejection | Reject an invoice capture | No downstream payment created |
| FN-06 | Payment batch | Create batch, add requests, advance to `confirmed` | All child requests complete |
| FN-07 | Cross-page totals | Compare cashflow total with GP tracker | Same underlying data, totals consistent |

### 10D. Engineering & Deliverables

| # | Scenario | Steps | Expected Result |
|---|----------|-------|----------------|
| EN-01 | Eng stage flow | Start eng stage, complete tasks, approve | Stage status follows `not_started` → `in_progress` → `complete` |
| EN-02 | Deliverable workflow | Create deliverable, upload version, get QC approval | Status moves through pipeline correctly |
| EN-03 | Eng task skip | Skip an eng task | Status = `skipped`, stage can still complete |
| EN-04 | Eng approval rejection | Reject an eng approval | Status = `rejected`, blocks stage completion |
| EN-05 | Drawing register | Add drawing, link to deliverable | Cross-reference intact |
| EN-06 | Kanban board accuracy | Compare board card count per column with DB | Exact match |

### 10E. Quality & Commissioning

| # | Scenario | Steps | Expected Result |
|---|----------|-------|----------------|
| QA-01 | QC checklist creation | Create checklist for a project | All items default to `not_started` |
| QA-02 | Commissioning flow | Move item from `not_started` → `approved` | Status updates correctly, dashboard reflects |
| QA-03 | Evidence evaluation | Submit evidence, evaluate pass/fail | Evaluation recorded, completion % updates |
| QA-04 | QC → Gate linkage | Complete all QC items for a stage | Stage should show higher completion % |

### 10F. Construction & HSE

| # | Scenario | Steps | Expected Result |
|---|----------|-------|----------------|
| CS-01 | Site inspection fail | Create inspection, set result = `fail` | Snag or corrective action should be created |
| CS-02 | Snag resolution | Move snag from `open` → `resolved` → `verified` → `closed` | Full lifecycle tracked |
| CS-03 | HSE incident flow | Create incident, investigate, close | All statuses valid, corrective actions tracked |
| CS-04 | Contractor termination | Terminate contractor | Linked site activities should close |

### 10G. Handover & SSEG

| # | Scenario | Steps | Expected Result |
|---|----------|-------|----------------|
| HO-01 | Handover pack flow | Create pack, complete checklist, submit, accept | Pack and checklist statuses align |
| HO-02 | SSEG application | Submit application, track through municipal process | Application stage advances correctly |
| HO-03 | Rejected handover | Reject a handover pack | Pack status = `rejected`, allows re-submission |
| HO-04 | Checklist ↔ pack consistency | Accept pack but leave items pending | Should not be allowed — system prevents or flags |

### 10H. Collaboration

| # | Scenario | Steps | Expected Result |
|---|----------|-------|----------------|
| CL-01 | Approval workflow | Create approval, approve it | Status = `approved`, downstream action enabled |
| CL-02 | Meeting action conversion | Convert meeting action to work item | Action status = `converted`, work item created |
| CL-03 | Follow-up completion | Complete a follow-up | Status = `completed`, notification sent |
| CL-04 | Notification mark-read | Mark notification read | Count decreases in bell icon |

### 10I. Import & Sync

| # | Scenario | Steps | Expected Result |
|---|----------|-------|----------------|
| IM-01 | Smart import preview | Upload Excel, preview changes | Run status = `PREVIEW`, changes shown |
| IM-02 | Import commit | Commit import run | Status = `COMMITTED`, data appears in tables |
| IM-03 | Import rollback | Roll back committed import | Status = `ROLLED_BACK`, data reverts |
| IM-04 | Microsoft sync | Trigger MS sync | Tasks from Teams/Planner appear with correct status |
| IM-05 | Stale import detection | Check for PREVIEW runs older than 7 days | Should be flagged or auto-superseded |

---

## 11. KNOWN RISK AREAS & ANTI-PATTERNS TO FLAG

These are areas where bugs are most likely to hide based on the architecture:

### 11A. High-Risk Patterns

1. **Status string mismatch.** Work items use UPPER CASE WITH SPACES (`TO DO`, `IN PROGRESS`), while engineering uses lower_snake_case (`not_started`, `in_progress`), and finance uses UPPER_SNAKE_CASE (`PLANNED`, `INVOICED`). Any code that compares statuses across domains without normalization will fail silently.

2. **Duplicate route files.** Multiple route files exist for the same domain (e.g., `handover-routes.ts` at root and in `departments/`). If both are mounted, one may shadow the other, causing stale data or missing permission checks on one path.

3. **Cache staleness.** `@tanstack/react-query` caches server state. If a mutation endpoint does not properly invalidate the cache (via `task-cache.ts` or `queryClient.invalidateQueries`), the UI will show stale data until the user manually refreshes.

4. **Soft-delete leakage.** Any query that forgets `WHERE deleted_at IS NULL` will include deleted records in counts and lists. This is especially dangerous in aggregate queries (COUNT, SUM) on finance pages.

5. **Lens simulation scope creep.** If the COO simulation does not properly scope queries to the simulated role's project access, the COO may see more data during simulation than the real user would.

6. **Filter state persistence.** If filter state is stored in React Context or localStorage but the page component doesn't clear it when navigating away, stale filters may hide data on the next visit.

7. **Workstream enum mismatch.** The `workItemWorkstreamEnum` uses short codes (`PD`, `ENG`, `QUALITY`) while `TASK_WORKSTREAMS` in tasks.ts uses full names (`Engineering`, `Quality`). Any join or comparison must handle this mapping.

8. **Microsoft sync overwrite.** The MS sync service may overwrite manually-set statuses on work items if the sync doesn't check for local modifications since last sync.

9. **Approval cascading.** When an approval is `rejected`, the system must cascade that rejection to dependent entities (e.g., a rejected gate approval should not allow the stage to progress). Verify cascading logic exists.

10. **Import conflict resolution.** The `import-conflict-policy.ts` determines what happens when an import tries to update a record that was manually edited since the last import. Verify the policy doesn't silently overwrite manual changes.

### 11B. Anti-Patterns to Search For in Code

| Anti-Pattern | How to Find | Why It's Bad |
|-------------|------------|-------------|
| Hardcoded status strings | `grep -r '"TO DO"' client/` (look for strings not imported from shared constants) | Will break if enum values change |
| Missing `deleted_at` check | `grep -rn 'FROM work_items' server/` and check for WHERE clause | Includes deleted records |
| Unchecked `access_level` | `grep -rn 'projectAccess' server/` — look for queries that don't filter by access_level | Data leakage |
| Inline status colors | `grep -rn 'bg-red\|bg-amber\|bg-emerald' client/src/pages/` | Inconsistent with centralized color map |
| Missing cache invalidation | Search for `useMutation` calls without `onSuccess: () => queryClient.invalidateQueries` | Stale UI after mutations |
| Unguarded status transition | Search for PATCH/PUT endpoints that accept any status value without validation | Allows invalid state |
| `SELECT *` without project filter | `grep -rn 'SELECT \*' server/` — check for missing `WHERE project_id` | Cross-project leakage |
| Missing auth middleware | Compare route registrations in `routes.ts` with auth middleware usage | Unauthenticated access |

---

## 12. TRUSTWORTHINESS — DATA RELIABILITY & AUDIT VERIFICATION

The platform must earn and maintain user trust. If users see conflicting numbers on different pages, or if data silently changes without explanation, trust is destroyed. This section defines what "trustworthy data" means and how to verify it.

### 12A. Single Source of Truth Principle

Every data point displayed in the UI must trace back to exactly ONE authoritative database query. No derived caches, no local calculations that diverge from the server, no stale snapshots shown as live data.

**Verification checklist:**
1. **Audit trail completeness.** Every mutation must be recorded in `audit_events` with:
   - `entity_type` — which table was changed
   - `entity_id` — which record
   - `event_type` — created, modified, deleted
   - `changes` — JSON diff of old vs. new values
   - `source` — UI, IMPORT, INTEGRATION, SYSTEM, SETTINGS
   - `user_id` — who made the change
   - `timestamp` — when

2. **Status history integrity.** The `work_item_status_history` table must have a complete, unbroken chain for every work item. Run:
   ```sql
   -- Find work items with gaps in history
   SELECT wi.id, wi.status, wsh.new_status AS last_recorded_status
   FROM work_items wi
   LEFT JOIN LATERAL (
     SELECT new_status FROM work_item_status_history
     WHERE work_item_id = wi.id
     ORDER BY changed_at DESC LIMIT 1
   ) wsh ON true
   WHERE wi.deleted_at IS NULL
     AND wi.status != wsh.new_status;
   ```
   Any rows returned are **trust violations** — the current status doesn't match the last recorded history entry.

3. **Financial arithmetic verification.** For every project, verify:
   ```
   Total Revenue = SUM(revenue_lines.amount WHERE status IN ('PAID', 'IN_BANK', 'REALISED'))
   Total Cost = SUM(cost_lines.amount WHERE status IN ('APPROVED', 'PAID'))
   Gross Profit = Total Revenue - Total Cost
   ```
   Compare with what the GP Tracker page displays. Any mismatch is a trust issue.

4. **Gate completion percentage.** For every stage instance, verify:
   ```
   Completion % = COUNT(requirements WHERE status IN ('COMPLETE', 'NOT_APPLICABLE', 'WAIVED'))
                 / COUNT(all requirements for that stage) * 100
   ```
   Compare with what the Gate Control page displays.

5. **Snapshot freshness.** `role_homepage_snapshots` contains pre-computed data. Verify:
   - Snapshots are refreshed at least every 24 hours
   - Snapshot values match live queries when compared side-by-side
   - If a snapshot is stale (> 24h), the UI falls back to a live query or shows a staleness indicator

### 12B. Data Provenance

Every record should be traceable to its origin:
- **Manual entry**: `source = 'UI'` in audit, `created_by` user field set
- **Import**: `source = 'IMPORT'` in audit, `smart_import_run_id` linkable
- **Microsoft sync**: `source = 'INTEGRATION'` in audit, `ms_plan_id` or `ms_task_id` set
- **System backfill**: `source = 'SYSTEM'` in audit, created during bootstrap

**QA CHECK:** Find any records with NO audit trail (no matching `audit_events` row). These are "ghost records" — data with unknown origin.

### 12C. Conflict Resolution Trust

When the same entity can be modified from multiple sources (UI, import, sync), verify:
- The latest write wins (last-writer-wins policy) and is clearly logged
- The user is notified if their manual change was overwritten by a sync/import
- `import-conflict-policy.ts` handles merge conflicts correctly, preferring manual changes over imported ones when `updated_at` is more recent

### 12D. Deletion Trust

- Soft-deleted records must NEVER appear in active views, counts, or financial totals
- The recovery center (`/admin/recovery`) must show ALL soft-deleted records with delete reason
- Hard deletes (if any) must be audit-logged before execution
- Cascade deletes must be documented — deleting a project should not silently delete work items without logging

---

## 13. FRONT-END COMPLETENESS — EVERY ACTION MUST BE POSSIBLE

The front-end must expose UI controls for every action the API supports. If the API allows a status transition but the front-end has no button for it, users are stuck. This section audits completeness.

### 13A. Status Transition Buttons

For every entity with a status field, verify the front-end provides a way to transition to every valid status:

**Work Items:**
| From Status | Available Transitions | UI Control Required |
|-------------|----------------------|-------------------|
| `TO DO` | → `IN PROGRESS`, → `HOLD` | "Start" button, "Hold" button |
| `IN PROGRESS` | → `HOLD`, → `PROJECTS ASSISTANCE`, → `NEEDS APPROVAL`, → `COMPLETE` | Status dropdown or buttons |
| `HOLD` | → `IN PROGRESS`, → `TO DO` | "Resume" button |
| `PROJECTS ASSISTANCE` | → `IN PROGRESS` | "Resume" button |
| `NEEDS APPROVAL` | → `QC APPROVED`, → `PROVIDE FEEDBACK`, → `IN PROGRESS` | Approval buttons, "Request Changes" |
| `QC APPROVED` | → `OPERATIONAL APPROVAL`, → `COMPLETE` | Approval flow buttons |
| `PROVIDE FEEDBACK` | → `IN PROGRESS`, → `NEEDS APPROVAL` | "Address Feedback" button |
| `OPERATIONAL APPROVAL` | → `COMPLETE`, → `PROVIDE FEEDBACK` | Final approval button |
| `COMPLETE` | (terminal — or reopen?) | If reopenable, "Reopen" button needed |

**Gate Stages:**
| From Status | Available Transitions | UI Control Required |
|-------------|----------------------|-------------------|
| `NOT_STARTED` | → `IN_PROGRESS` | "Start Stage" button |
| `IN_PROGRESS` | → `READY_FOR_REVIEW`, → `BLOCKED` | "Submit for Review", "Flag Blocked" |
| `READY_FOR_REVIEW` | → `APPROVED`, → `IN_PROGRESS` (sent back) | "Approve Gate", "Send Back" |
| `APPROVED` | → `PROGRESSED` | "Progress to Next" |
| `BLOCKED` | → `IN_PROGRESS` (unblock) | "Unblock" button |
| `EXCEPTION_APPROVED` | → `PROGRESSED` | "Progress with Exception" |

**Procurements:**
| From Status | Available Transitions | UI Control Required |
|-------------|----------------------|-------------------|
| `requested` | → `quoted` | "Add Quote" button |
| `quoted` | → `approved`, → `requested` (reject quote) | "Approve Quote", "Reject" |
| `approved` | → `ordered` | "Create PO" or "Mark Ordered" |
| `ordered` | → `partially_received`, → `received` | "Record Partial Receipt", "Mark Received" |
| `partially_received` | → `received` | "Mark Fully Received" |
| `received` | → `invoiced` | "Link Invoice" |
| `invoiced` | → `closed` | "Close Procurement" |

**Purchase Orders:**
| From Status | Available Transitions | UI Control Required |
|-------------|----------------------|-------------------|
| `draft` | → `submitted` | "Submit PO" button |
| `submitted` | → `in_review` | "Start Review" |
| `in_review` | → `approved`, → `requires_info`, → `blocked` | Action buttons per outcome |
| `requires_info` | → `submitted` (resubmit) | "Resubmit" button |
| `blocked` | → `in_review` (unblock) | "Unblock" button |
| `approved` | (terminal) | No further actions needed |
| `cancelled` | (terminal) | No further actions needed |

**Payment Requests:**
| From Status | Available Transitions | UI Control Required |
|-------------|----------------------|-------------------|
| `new` | → `in_review` | "Start Review" |
| `in_review` | → `loaded_for_payment`, → `requires_info`, → `blocked` | Action buttons |
| `loaded_for_payment` | → `proof_attached` | "Attach Proof" button |
| `proof_attached` | → `complete` | "Confirm Payment" |
| `requires_info` | → `new` (resubmit) | "Resubmit" |
| `blocked` | → `in_review` | "Unblock" |

### 13B. CRUD Completeness

For every entity, verify the front-end supports:

| Action | UI Element | QA Check |
|--------|-----------|----------|
| **Create** | "New" or "Add" button | Button exists and is visible for users with `can_edit` permission |
| **Read** | Detail view or row expansion | All fields displayed, including status with correct badge |
| **Update** | Edit form or inline editing | All editable fields accessible, status transitions available |
| **Delete** | Delete button with confirmation | Confirmation dialog shown, soft-delete executed, item removed from view |

Verify for these entities:
- Work items
- Deliverables
- Procurements
- Purchase orders
- Payment requests
- Invoices
- Revenue/cost lines
- QC checklist items
- Commissioning items
- Site inspections
- Snags
- HSE incidents
- Corrective actions
- Handover packs
- SSEG applications
- Change requests
- RAID items
- Meeting action items
- Approvals
- Opportunities

### 13C. Bulk Actions

Verify bulk operations work correctly:
| Bulk Action | Where Available | QA Check |
|------------|----------------|----------|
| Bulk status change | Engineering Tasks board | All selected items update, history logged for each |
| Bulk reassign | Engineering Tasks board | New assignee set, notifications sent |
| Bulk close | Engineering Tasks board | All items closed, soft-deleted or status set |
| Select all / deselect | Any table with checkboxes | Selection state tracks correctly |

### 13D. Form Validation

For every form in the app, verify:
1. **Required fields.** Submitting with empty required fields shows validation errors
2. **Status field options.** Dropdowns only show valid transition targets from the current status
3. **Date validation.** Due dates cannot be in the past (unless editing historical data)
4. **Amount validation.** Financial amounts must be positive numbers (unless credits are supported)
5. **Zod schema alignment.** Front-end Zod validation matches the shared schema — no form accepts values the API will reject

### 13E. Error Handling Completeness

Verify the front-end handles every error state gracefully:
| Error | Expected UI Behavior |
|-------|---------------------|
| 401 Unauthorized | Redirect to login page |
| 403 Forbidden | Show "Access Denied" message, not a blank page |
| 404 Not Found | Show "Not Found" page for invalid routes/IDs |
| 422 Validation Error | Show field-level error messages |
| 500 Server Error | Show generic error message with retry option |
| Network timeout | Show offline/retry indicator |
| Empty state | Show helpful empty state (not blank white space) for pages with no data |
| Loading state | Show skeleton/spinner during data fetch, not stale data |

### 13F. Navigation Completeness

Verify every page is reachable:
1. **From the sidebar.** Every module visible to the active lens has a nav link that works
2. **Via direct URL.** Typing any valid route directly into the browser works (no broken client-side routing)
3. **Via breadcrumbs/back.** Nested pages (e.g., project → gate → requirement) have working breadcrumbs
4. **Deep links.** Links shared between users work for any user with access to that resource
5. **404 for invalid routes.** Non-existent routes show a 404 page, not a blank screen
6. **Module gating.** Routes for modules the lens doesn't have access to redirect or show access denied

---

## 14. OUTPUT FORMAT — HOW TO REPORT FINDINGS

Structure your report as follows:

### Summary Dashboard
```
Total Checks Run: ___
Passed: ___
Failed: ___
Warnings: ___
Critical (P0): ___
```

### Findings Table

For each finding, report:

| # | Severity | Category | Description | Evidence | Affected Pages/Lenses | Suggested Fix |
|---|----------|----------|-------------|----------|----------------------|---------------|
| 1 | P0-Critical | Status Consistency | Work item #1234 has status "INVALID" not in enum | `SELECT * FROM work_items WHERE id = 1234` | My Work, Engineering Tasks | Update to valid status |
| 2 | P1-High | Lens Parity | CEO sees 5 blocked projects, COO simulating CEO sees 6 | Screenshots of both views | CEO, COO simulation | Fix simulation query scoping |
| 3 | P2-Medium | Front-End | No "Unblock" button on blocked procurement cards | Screenshot of procurement detail page | Procurement page | Add transition button |
| 4 | P3-Low | Cosmetic | Status badge for "HOLD" uses blue instead of red | Screenshot comparison | Engineering Tasks board | Update color map |

### Severity Definitions

| Severity | Definition | Examples |
|----------|-----------|---------|
| **P0-Critical** | Data integrity violation. Incorrect data visible to users. Financial totals wrong. Status values invalid. Security/access leakage. | Invalid enum value in DB, cross-project data visible, financial total mismatch |
| **P1-High** | Consistency violation across lenses/pages. Feature not working. Data visible but incorrect. | Different counts on different pages, broken status transition, missing permission check |
| **P2-Medium** | Missing UI capability. Workaround exists. Non-blocking. | Missing button for valid transition, filter not working, empty state not shown |
| **P3-Low** | Cosmetic issue. Incorrect color/label. Minor UX problem. | Wrong badge color, typo in label, misaligned element |

### Appendix: Raw Queries Run

Include every SQL query you ran against production (read-only) with result counts. This allows verification of your findings.

---

## END OF PROMPT

This prompt covers the full stack of the Emergent Energy platform:
- **100+ database tables** with every status enum documented
- **60+ API route files** with middleware and service layer
- **50+ front-end pages** with component and filter inventory
- **13 lens roles** with module access and simulation testing
- **20+ cross-domain consistency rules**
- **45+ specific test scenarios**
- **10 high-risk patterns** to proactively scan for
- **Complete CRUD and transition button audit**
- **Trustworthiness verification** with audit trail and provenance checks

The goal: **every status works correctly no matter what lens, page, or filter is viewing it.**
