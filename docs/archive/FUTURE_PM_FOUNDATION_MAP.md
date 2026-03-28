# Future PM Platform Foundation Map

## Version: 2.0 | Date: 2026-03-06

## Purpose
This document assesses whether the current architecture supports growth into a full PM platform without major rework. It identifies what foundation exists, what extends cleanly, and what would require architectural changes.

---

## Foundation Components — Ready to Extend

### 1. Canonical Task Engine (`server/lib/canonical-task-engine.ts`)
**What exists**: 6 statuses (todo, in_progress, blocked, review, complete, cancelled), 4 priorities, 5 task types, 5 converter functions (fromWorkItem, fromOperational, fromEngineering, fromPersonal, fromQuality)
**Why it scales**: Any new task source can be added by writing a `fromNewSource()` function. The canonical model serves as a universal adapter — My Work already aggregates 5 different task types into one unified view.
**Extension cost**: LOW — add a new converter function + query, no existing code changes needed.
**Current limitation**: The canonical model is read-only (used for display aggregation). Writes still go to source tables directly. A future "write through canonical" layer would require new work.

### 2. Work Items Table (`work_items`)
**What exists**: 3,292 records with WBS hierarchy, project linkage, baseline dates, actual dates (actual_start, actual_end, actual_duration), percent complete, owner_user_id, workstream, parent_task_id
**Why it scales**: Already serves as the canonical planning table. Has the columns needed for Gantt charts, critical path analysis, and earned value management.
**Extension points that work without rework**:
- Add `predecessor_ids` column (array) for task dependency chains
- Add `constraint_type` and `constraint_date` for scheduling constraints
- Add `estimated_hours` and `actual_hours` for effort tracking
- Add `baseline_start_2`, `baseline_end_2` for multiple baselines
**Current limitation**: No predecessor/successor relationship table exists. No calendar table for working days. These are additive changes (new columns or tables), not architectural rework.

### 3. Role & Permission System
**What exists**: 14 roles, 90+ entity permissions, configurable via admin UI at `/admin/roles`
**Why it scales**: Permissions are stored in JSONB (`entity_permissions` column on `role_permissions` table), so adding new entities requires zero schema changes — just add the entity key to the defaults and role UI.
**Extension points that work without rework**:
- Add CLIENT, EXTERNAL_AUDITOR, CONTRACTOR roles with view-only permissions
- Add new entity keys for any new feature (e.g., "resource_calendar", "milestone_payments")
**What requires rework for PM platform**: Project-level role overrides. Currently all permissions are global. A PM has PM access to ALL projects. Adding per-project permissions would require a new `project_role_assignments` table and middleware changes to check project-scoped permissions. This is a MEDIUM rework.

### 4. Audit Trail System
**What exists**: 233+ audit calls, `audit_events` table, activity log UI
**Why it scales**: `logAuditFromReq` is a simple, universal logging function. Any new feature can log by calling it with the appropriate entityType and action.
**Extension points that work without rework**:
- Add audit calls to any new route (one line per endpoint)
- Add new entityType values as features are added
- Add audit report export (query audit_events with filters, render PDF)
**What requires rework**: Advanced audit analytics (trends over time, compliance dashboards) would need new query infrastructure. Current activity log is a simple list.

### 5. Financial Engine
**What exists**: `normalized_cost_lines`, `normalized_revenue_lines` as canonical data sources. Revenue calculated from COS realization. GP tracking. Cashflow with weekly granularity. OPEX budgets.
**Why it scales**: Financial data is already normalized into canonical tables, separate from project-specific imports. Any new financial feature can query these tables.
**Extension points that work without rework**:
- Add budget vs actual variance columns to existing tables
- Add currency columns (currently ZAR-only assumed)
- Add invoice generation from cost/revenue data
**What requires rework for PM platform**: Multi-currency with exchange rate tracking would require a `currency_rates` table and conversion logic in all financial calculations. Earned value management (CPI, SPI, EAC) would need new computed fields on work_items cross-referencing financial data. These are MEDIUM additions.

### 6. Smart Import System
**What exists**: Excel file upload, row-by-row parsing, staging with commit/rollback, error tracking per row
**Why it scales**: The import framework already handles multi-sheet Excel files with column mapping. Adding new import types means adding new parsers.
**Extension points that work without rework**:
- Add new import templates for resource plans, budgets, schedules
- Add validation rules for new data types
**Current limitation**: Import is batch-only (upload file → parse → commit). No real-time sync with external PM tools. A live MS Project integration would require significant new architecture (webhook-based sync, conflict resolution).

---

## Foundation Components — Need Significant Work

### 1. Resource Management
**What exists**: Tasks have `owner_user_id` (assignee) but no concept of resource capacity, availability, or allocation.
**What's missing**:
- Resource capacity table (hours per week per user)
- Resource allocation tracking (user X assigned 40% to project Y)
- Resource leveling algorithm
- Skills/competency matrix
**Rework level**: HIGH — entirely new subsystem, new tables, new UI pages

### 2. Dependency / Critical Path
**What exists**: Work items have `parent_task_id` for hierarchy (WBS). No predecessor/successor relationships.
**What's missing**:
- Task dependency table (finish-to-start, start-to-start, etc.)
- Critical path calculation engine
- Dependency violation alerts
**Rework level**: MEDIUM — new table + algorithm + Gantt visualization update. The work_items table structure supports it, but no logic exists.

### 3. Time Tracking
**What exists**: Tasks have `estimated_hours` (future) and `percent_complete`. No actual time logging.
**What's missing**:
- Timesheet entry table (user, project, task, date, hours)
- Timesheet approval workflow
- Time vs estimate variance reporting
**Rework level**: MEDIUM — new tables, new pages, new approval workflow

### 4. Multi-Tenant / Client Portal
**What exists**: Single-tenant. One company's data. No client-facing views.
**What's missing**:
- Organization_id on all entities
- Tenant isolation middleware
- Client-facing dashboard with limited data
**Rework level**: HIGH — fundamental data model change affecting every table and query

---

## Architecture Assessment for PM Platform Growth

| Component | Current State | Extends Without Rework | Needs Rework |
|---|---|---|---|
| Task model | 5 types, canonical engine | New task types, custom fields | Write-through canonical layer |
| Planning | Work items with WBS | New columns for constraints, predecessors | Dependency engine, critical path |
| Financial | Normalized cost/revenue | Budget variance, invoice gen | Multi-currency, earned value |
| Permissions | 14 roles, 90+ entities | New roles, new entities | Project-level permissions |
| Audit | 233+ calls, activity log | New entity types, new actions | Advanced analytics, compliance reports |
| Import | Excel upload with staging | New parsers, new templates | Live sync with MS Project |
| Resource mgmt | Assignee only | — | Entire subsystem needed |
| Time tracking | Percent complete only | — | Entire subsystem needed |
| Multi-tenant | Single tenant | — | Fundamental rework needed |

## Verdict
The current architecture **can grow into a PM platform** for the following reasons:
1. The canonical task engine provides a universal task aggregation layer — adding new task sources is additive
2. The work_items table has the right shape (WBS, dates, assignments, percent complete) for planning features
3. The permission system uses JSONB for entity permissions — adding new entities requires no schema changes
4. Financial data is already normalized — adding budget/variance features extends existing tables

The areas that would require **significant architectural work** are: resource management, critical path, time tracking, and multi-tenancy. These are expected gaps for a V1 platform and are typical Phase 2 investments for PM tooling.
