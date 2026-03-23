# Project Development (PD) Module — Full Audit Report

**Date**: 2026-03-23
**Scope**: All PD backend routes, handover workflow, workspace aggregation service, database schema, and frontend pages.

---

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Backend Routes & API Surface](#2-backend-routes--api-surface)
3. [Handover Workflow](#3-handover-workflow)
4. [Workspace Aggregation Service](#4-workspace-aggregation-service)
5. [Database Schema](#5-database-schema)
6. [Frontend Pages & UX](#6-frontend-pages--ux)
7. [RBAC & Permissions](#7-rbac--permissions)
8. [Integration Points](#8-integration-points)
9. [Bugs & Critical Issues](#9-bugs--critical-issues)
10. [Gaps & Missing Features](#10-gaps--missing-features)
11. [Technical Debt](#11-technical-debt)
12. [Prioritised Backlog](#12-prioritised-backlog)

---

## 1. Module Overview

The PD module manages the **Project Development** lifecycle — from client creation and ticket-based work requests through to handover into the **PM Active** phase. It is composed of:

| Layer | Files | Lines |
|-------|-------|-------|
| Backend routes | `server/pd-routes.ts` | ~507 |
| Handover routes | `server/handover-routes.ts` | ~896 |
| Workspace service | `server/services/project-development-workspace-service.ts` | ~842 |
| Route registration | `server/routes/register-project-routes.ts` | 19 |
| Frontend pages | `client/src/pages/pd/` (5 pages) | ~2,500 |
| Schema (relevant) | `shared/schema/projects.ts` | ~1,074 |

**Core entity relationships**:
```
clients ──1:N──> projectInfo ──1:N──> pdTickets
                     │                     │
                     │                     └──> workItems (task templates)
                     │
                     └──> project_pd_pm_handover (1:1)
                              │
                              └──> project_handover_history (1:N)
```

---

## 2. Backend Routes & API Surface

### 2.1 Client Management

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/pd/clients` | requireAuth | Search + list (limit 50/100) |
| POST | `/api/pd/clients` | requirePermission('pd_clients','create') | Generates `EE-C{N}` ID; dual-writes to `core.clients` when feature flag enabled |
| PATCH | `/api/pd/clients/:id` | requirePermission('pd_clients','edit') | Name update, duplicate check |
| GET | `/api/pd/clients/project-counts` | requireAuth | Aggregated counts |

**Dual-write**: When `promoted_core_clients_dual_write` feature flag is enabled, POST also writes to `core.clients`. Response includes `X-Promoted-Clients-Dual-Write` header.

### 2.2 PD Tickets

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/pd/tickets` | requireAuth | Role-scoped: admins see all, PD sees own, ENGINEER returns empty |
| GET | `/api/pd/tickets/:id` | requireAuth | Detail view with joins; **tasks array always empty** (broken linkage) |
| POST | `/api/pd/tickets` | requirePermission('pd_quality','edit') | Creates ticket + spawns work items from templates |
| PATCH | `/api/pd/tickets/:id` | requirePermission('pd_quality','edit') | Creator/assignee can edit |
| POST | `/api/pd/tickets/:id/spawn-tasks` | requirePermission('pd_quality','edit') | Idempotent task spawning (409 if already spawned) |

**Request type templates** (from `PD_REQUEST_TYPE_TASK_TEMPLATES`):
- Cost Proposal, IFC Planning, Site Assessment, Feasibility Study
- Grid Application, Design Review, Battery Assessment, Full EPC
- Each template spawns 3–6 prioritised work items

### 2.3 Dashboard & Utility

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/pd/dashboard` | Metric counts: total, active, overdue, due this week, on hold, completed |
| GET | `/api/pd/users` | All users with name and role |
| GET | `/api/pd/projects/search` | Project search with phase + PD owner |

---

## 3. Handover Workflow

### 3.1 PD → PM Handover Lifecycle

```
  DRAFT ──submit──> SUBMITTED_FOR_PM_REVIEW ──accept──> ACCEPTED
                           │                              │
                           └──reject──> REJECTED          │
                                                          ▼
                                               Phase → "PM Active"
                                               executionEnabled = true
                                               executionGateStatus = "ENABLED"
```

### 3.2 Handover Endpoints

| Method | Path | Role | Key Action |
|--------|------|------|------------|
| GET | `/api/pd-pm-handover/:projectId` | handover:view | Full state, blockers, evidence, history |
| PUT | `/api/pd-pm-handover/:projectId/draft` | handover:edit | Save/update draft fields |
| POST | `/api/pd-pm-handover/:projectId/submit` | handover:edit | Validates 15+ blockers, evidence eval |
| POST | `/api/pd-pm-handover/:projectId/accept` | handover:approve | **Phase transition to "PM Active"**, enables execution gate |
| POST | `/api/pd-pm-handover/:projectId/reject` | handover:approve | Disables execution gate, requires reason |

### 3.3 Submit Blockers (15+ checks)

All of the following must pass before submission:

1. **Deliverables**: Handover Charter (reference), Site Visit Report (reference), Signed Cost Proposal (reference)
2. **Assignments**: PM assigned, PD owner set
3. **Scope**: Scope summary present, master project/client linked
4. **Engineering**: Engineering status provided
5. **Risk & Assumptions**: Risk summary, assumptions documented
6. **Feasibility**: Status != `NOT_ASSESSED`, feasibility notes provided
7. **Dependencies**: Dependency summary provided
8. **Readiness**: Handover readiness status = `READY_FOR_HANDOVER` (exact match), readiness notes provided
9. **Updates**: Canonical latest update present
10. **Conditional**: Quality status (if engineering requires it)
11. **Intake**: No sync conflicts, no internal blockers, all tasks completed

### 3.4 Accept Side-Effects

On acceptance, the system:
1. Sets `project_pd_pm_handover.status` → `ACCEPTED`
2. Sets `projectInfo.phase` → `"PM Active"`
3. Enables execution gate (`executionEnabled = true`, `executionGateStatus = "ENABLED"`)
4. Syncs split tables (`syncProjectSplitTables`)
5. Creates phase history record
6. Inserts handover history with action `PD_PM_HANDOVER_ACCEPTED`
7. Logs audit events

### 3.5 Gate Management

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/projects/:id/handover-gates` | 4 gates: PD_TO_ENG, ENG_TO_PM, PM_TO_QM, EXEC_TO_CLOSEOUT |
| POST | `/api/projects/:id/handover-gates/:gateId/complete` | Validates all checklist items |
| POST | `/api/projects/:id/handover-gates/:gateId/reopen` | Admin-only, requires reason |

### 3.6 Control & Queue Views

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/pd-pm-handover/control` | All projects with handover status, enriched metrics |
| GET | `/api/pd-pm-handover/submitted` | PM review queue (SUBMITTED + REJECTED) |
| GET | `/api/pd-pm-handover/status-map` | projectId → status map |

---

## 4. Workspace Aggregation Service

**File**: `server/services/project-development-workspace-service.ts`

### 4.1 Workspace Payload Structure

`getProjectDevelopmentWorkspace()` returns:

| Section | Description |
|---------|-------------|
| `spine` | Project metadata: IDs, phase, execution state, phase history |
| `latestUpdate` | Canonical latest update text, timestamp, updater |
| `intake` | Intake request counts, task aggregation, sync conflict/blocker flags |
| `pdTickets` | Ticket counts (total/open/completed), per-ticket task counts |
| `dependencies` | Work item dependencies: total, open, blocked counts |
| `risks` | RAID items: total, open, critical, grouped by type |
| `microsoft` | Teams/Outlook integration: linked items, action-required count |
| `readiness` | Feasibility + handover assessment, computed `minimumInputsReady` flag |
| `downstream` | Impact on engineering, PM, finance, quality phases |

### 4.2 Feasibility Status Values

`NOT_ASSESSED` | `UNDER_REVIEW` | `FEASIBLE` | `CONDITIONAL` | `NOT_FEASIBLE`

### 4.3 Readiness Status Values

`NOT_READY` | `READY_WITH_ACTIONS` | `READY_FOR_HANDOVER`

### 4.4 `minimumInputsReady` Computation

Returns `true` when ALL of:
- Latest update present
- Feasibility status != `NOT_ASSESSED`
- Readiness status = `READY_FOR_HANDOVER`
- Readiness notes present
- No intake sync conflicts
- No intake internal blockers
- All intake tasks completed

---

## 5. Database Schema

### 5.1 Key Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `clients` | PD client registry | id, clientId (`EE-C####`), name, createdBy |
| `pdTickets` | PD work requests | clientId, projectId, requestType, priority, status, dueDate, 25+ technical fields |
| `project_pd_pm_handover` | Handover state (1:1 per project) | status, pdOwner, pmOwner, summary, risks, assumptions, deliverables (JSONB) |
| `project_handover_history` | Handover audit trail | action, performedBy, details (JSONB) |
| `projectHandoverGates` | Gate checklist state | projectId+gateId (unique), status, checkedItems (JSONB) |
| `projectExecutionState` | Phase & execution flags | phase, executionEnabled, executionGateStatus |
| `workItems` | Spawned tasks from templates | Linked to tickets via spawn; **no pdTicketId FK** |
| `taskActivityLog` | Task lifecycle events | References workItems |

### 5.2 Tables Written by PD Module

- `pdTickets`, `clients`, `workItems`, `taskActivityLog`
- `project_pd_pm_handover`, `project_handover_history`
- `projectInfo`, `projectExecutionState`, `projectPhaseHistory`
- `evidence_override_records`, `project_editable_fields`
- Optionally: `core.clients` (dual-write)

### 5.3 Schema Mismatch (CRITICAL)

The following fields are used in raw SQL in `handover-routes.ts` but are **NOT defined in the Drizzle schema**:

| Field | Used In | Impact |
|-------|---------|--------|
| `feasibility_status` | Draft save, submit blockers | No TypeScript type safety |
| `feasibility_notes` | Draft save, submit blockers | No TypeScript type safety |
| `dependency_summary` | Draft save, submit blockers | No TypeScript type safety |
| `handover_readiness_status` | Draft save, submit blockers | No TypeScript type safety |
| `handover_readiness_notes` | Draft save, submit blockers | No TypeScript type safety |

These columns likely exist in the database (added via migration) but the Drizzle ORM definition doesn't include them, meaning:
- No type checking on reads/writes
- Drizzle `push` or `generate` could attempt to drop them
- Frontend types don't reflect these fields

---

## 6. Frontend Pages & UX

### 6.1 Page Inventory

| Page | Path | Description |
|------|------|-------------|
| PD Dashboard | `/pd` | Metric cards + ticket table |
| Ticket List | `/pd/tickets` | Flat table with filters |
| Create Ticket | `/pd/tickets/new` | Multi-step form (4 steps) |
| Ticket Detail | `/pd/tickets/:id` | Read/edit view; tasks section broken |
| PD-PM Handover | `/pd/handover/:projectId` | Draft → Submit → Accept/Reject workflow |
| Client Management | `/pd/clients` | Client CRUD with project counts |

### 6.2 Navigation

PD nav items registered under the sidebar with entries for Dashboard, Tickets, Clients, and Handover Control.

### 6.3 UX Observations

- **Dashboard**: Shows metric cards (total, active, overdue, due this week, on hold, completed) and a ticket table. Functional but basic.
- **Ticket Creation**: Well-structured 4-step wizard covering project selection, scope/technical details, contacts, and review.
- **Handover Page**: Comprehensive form with blocker display, evidence status, and action buttons. History timeline present.
- **No pipeline/Kanban view**: All listings are flat tables only.
- **No bulk operations**: No multi-select or batch actions on tickets.
- **No inline editing**: Must navigate to detail page to edit.

---

## 7. RBAC & Permissions

### 7.1 Role Definitions (PD Context)

| Role Constant | Used For |
|---------------|----------|
| `PROJECT_DEVELOPER` | Create/view own PD tickets |
| `KEY_ACCOUNTS_MANAGER` | Edit clients |
| `COO_ADMIN` | Full PD access + PM review |
| `CEO_ADMIN` | Full PD access + PM review |
| `CCO` | Edit clients |
| `admin` | Full access everywhere |
| `PROJECT_MANAGER_SITE` | PM review (accept/reject handover) |
| `PROGRAM_MANAGER` | PM review + gate reopen |
| `ENGINEER` | Returns empty ticket list (deprecated linkage) |

### 7.2 Permission Checks

| Permission | Actions |
|------------|---------|
| `pd_clients:create` | Create new clients |
| `pd_clients:edit` | Edit client records |
| `pd_quality:edit` | Create/edit PD tickets, spawn tasks |
| `handover:view` | View handover state |
| `handover:edit` | Draft/submit handover |
| `handover:approve` | Accept/reject handover |

### 7.3 Issues

- Role lists are hardcoded in multiple files (`isPdRole` in pd-routes, `PM_REVIEW_ROLES` in handover-routes, `ADMIN_ROLES` in handover-routes)
- No centralised role registry for PD-specific roles
- ENGINEER role returns empty data with no clear migration path

---

## 8. Integration Points

| System | Integration | Status |
|--------|-------------|--------|
| Feature flags | `promoted_core_clients_dual_write` | Active |
| Evidence evaluation | `evaluateEvidence()` for handover submit | Active |
| Evidence override | Role-gated override with audit record | Active |
| Storage service | `upsertProjectEditableFields()` for latestUpdate | Active |
| Split tables sync | `syncProjectSplitTables()` on phase transitions | Active |
| Audit logging | `logAuditFromReq()` on all handover actions | Active |
| Notifications | **Removed** — "PD rejection notification is now a no-op" | Removed |
| Microsoft integration | Teams/Outlook objects aggregated in workspace | Read-only |
| Intake module | Requests + tasks checked as handover blockers | Read-only |

---

## 9. Bugs & Critical Issues

### BUG-01: PD Ticket → Task Linkage Broken (HIGH)

**Location**: `server/pd-routes.ts` — GET `/api/pd/tickets/:id`
**Symptom**: Tasks array always returns empty.
**Cause**: The `pdTicketId` field was on `operational_tasks` which has been dropped. `workItems` table does not carry `pdTicketId`. Comment in code: _"pd_tickets_linkage was on operational_tasks which is being dropped. Work items don't carry pdTicketId"_.
**Impact**: Users cannot see spawned tasks on ticket detail page. Task status tracking per ticket is invisible.
**Fix**: Add `pdTicketId` column to `workItems` table and populate on spawn, or create a junction table.

### BUG-02: Drizzle Schema Missing Handover Fields (HIGH)

**Location**: `shared/schema/projects.ts` — `project_pd_pm_handover` table definition
**Symptom**: 5 fields used in raw SQL not in Drizzle schema (see Section 5.3).
**Impact**: Type-unsafe operations; Drizzle migrations could drop these columns; frontend has no typed access.
**Fix**: Add missing column definitions to the Drizzle schema.

### BUG-03: ENGINEER Role Returns Empty Data (MEDIUM)

**Location**: `server/pd-routes.ts` — GET `/api/pd/tickets`
**Symptom**: Engineers see an empty ticket list with no explanation in the UI.
**Impact**: Engineers assigned to PD tasks have no visibility into their work.
**Fix**: Either restore engineer-scoped ticket visibility or show an explanatory message.

---

## 10. Gaps & Missing Features

### GAP-01: No Pipeline/Kanban View (HIGH)

All PD listings are flat tables. No drag-and-drop pipeline view for tracking ticket progression or handover status across projects.

### GAP-02: No PD Reporting or KPIs (HIGH)

No conversion metrics (tickets → handovers → accepted), cycle time analytics, SLA compliance tracking, or pipeline value estimates.

### GAP-03: No Notification System (MEDIUM)

Notifications were explicitly removed. No email, in-app, or webhook notifications for:
- Ticket assignment/reassignment
- Handover submission
- Handover acceptance/rejection
- Overdue tickets

### GAP-04: No Financial Estimates on PD Records (MEDIUM)

PD tickets and handover records don't include financial estimates (project value, estimated revenue, cost estimates). No feed into forecasting pipeline.

### GAP-05: No Document Upload (MEDIUM)

Deliverables (handover charter, site visit report, signed cost proposal) accept only URL references, not file uploads. No document storage integration.

### GAP-06: No PD Seed Data (LOW)

Seed files exist for engineering, intake, and quality modules, but not PD. Makes local development/testing of PD workflows difficult.

### GAP-07: No Bulk Operations (LOW)

No multi-select actions on ticket list (bulk assign, bulk status change, bulk close).

### GAP-08: `counterparties` Table Not Linked (LOW)

`clients` table in PD is separate from `counterparties`. No reconciliation path.

---

## 11. Technical Debt

### DEBT-01: Raw SQL String Interpolation (MEDIUM)

**Location**: `server/handover-routes.ts`
**Detail**: Uses string interpolation with `escapeSqlText`/`escapeSqlJson` helpers (`.replace(/'/g, "''")`) instead of Drizzle parameterised queries.
**Risk**: Lower SQL injection risk than bare interpolation, but not zero. Drizzle's query builder would be safer.

### DEBT-02: Role List Proliferation (LOW)

Role arrays hardcoded in 3+ locations:
- `isPdRole()` in pd-routes
- `PM_REVIEW_ROLES` in handover-routes
- `ADMIN_ROLES` in handover-routes
Should be centralised in a shared roles module.

### DEBT-03: No Input Validation on Deliverables JSONB (LOW)

Handover accepts `deliverables` object with no schema validation. Frontend must enforce `{ reference, date }` structure.

### DEBT-04: Workspace Service Over-Fetching (LOW)

`getProjectDevelopmentWorkspace()` runs 10+ parallel queries for every handover GET. No caching, no partial fetch. Could be slow on large projects.

---

## 12. Prioritised Backlog

### P0 — Must Fix (Bugs blocking correctness)

| # | Item | Type | Effort |
|---|------|------|--------|
| 1 | Add missing handover columns to Drizzle schema (`feasibility_status`, etc.) | BUG-02 | S |
| 2 | Restore PD ticket → task linkage (add `pdTicketId` to `workItems`) | BUG-01 | M |

### P1 — Should Fix (High-value gaps)

| # | Item | Type | Effort |
|---|------|------|--------|
| 3 | Add PD pipeline/Kanban view for ticket progression | GAP-01 | L |
| 4 | Add PD reporting dashboard (conversion rates, cycle time, SLA) | GAP-02 | L |
| 5 | Migrate raw SQL to Drizzle parameterised queries in handover-routes | DEBT-01 | M |
| 6 | Add notification system for PD events (handover submit/accept/reject) | GAP-03 | M |

### P2 — Nice to Have (Improvements)

| # | Item | Type | Effort |
|---|------|------|--------|
| 7 | Add financial estimate fields to PD tickets and handover | GAP-04 | M |
| 8 | Add document upload for deliverables (replace URL-only) | GAP-05 | M |
| 9 | Centralise role definitions into shared module | DEBT-02 | S |
| 10 | Add JSONB schema validation for deliverables | DEBT-03 | S |
| 11 | Fix ENGINEER role visibility or add explanatory UI | BUG-03 | S |

### P3 — Low Priority

| # | Item | Type | Effort |
|---|------|------|--------|
| 12 | Add PD seed data for local development | GAP-06 | S |
| 13 | Add bulk operations to ticket list | GAP-07 | M |
| 14 | Reconcile `clients` table with `counterparties` | GAP-08 | M |
| 15 | Add workspace response caching / partial fetch | DEBT-04 | M |

**Effort key**: S = small (< 1 day), M = medium (1–3 days), L = large (3+ days)

---

## Files Analysed

| File | Lines |
|------|-------|
| `server/pd-routes.ts` | 507 |
| `server/handover-routes.ts` | 896 |
| `server/services/project-development-workspace-service.ts` | 842 |
| `server/routes/register-project-routes.ts` | 19 |
| `shared/schema/projects.ts` | 1,074 |
| `client/src/pages/pd/` (5 pages) | ~2,500 |
