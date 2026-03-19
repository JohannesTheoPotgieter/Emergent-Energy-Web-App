# Audit 1: Data Model Reconciliation

**Date:** 2026-03-19
**Scope:** Dual data model (`work_items` vs `operational_tasks`) inconsistencies
**Status:** Read-only audit — no changes made

---

## Executive Summary

The engineering module has **TWO parallel task data layers** with **ZERO synchronization** between them. Only **3 of 28 endpoints** (10.7%) use the `work_items` adapter; the remaining **25 endpoints** query `operational_tasks` directly.

---

## Table Structure Comparison

### `operational_tasks` (Legacy)
- `id`, `projectId`, `projectName`, `taskNumber`, `parentTaskId`, `title`, `description`, `status`, `priority`, `phase`, `primaryWorkstream`
- `ownerUserId`, `requesterUserId`, `approverUserId`, `holdReason`, `blockedType`, `approvalRequired`
- `startDate`, `dueDate`, `durationDays`, `actualStartDate`, `actualEndDate`, `actualDurationDays`, `percentComplete`, `completedAt`
- **Denormalized arrays**: `assignees[]`, `assigneeUserIds[]`, `watchers[]`, `tags[]`
- `linkedPlanItemId`, `linkedDeliverableId`, `linkedQualityItemInstanceId`, `externalTaskId`
- `createdAt`, `updatedAt`, `deletedAt`

### `work_items` (Canonical)
- `id`, `clientId`, `projectId`, `workstream`, `type`, `source`, `title`, `description`, `status`, `priority`
- `startDate`, `endDate`, `duration`, `percentComplete`, `expectedPctComplete`, `wbsCode`, `outlineNumber`, `indentLevel`, `parentId`
- `isMilestone`, `phase`, `ownerUserId`, `ownerName`, `isShared`, `externalRef`
- `legacyTable`, `legacyId`, `sourceRow`, `sourceSheet`, `importRunId`, `createdBy`
- **Separate FK table**: `workItemAssignments` (OWNER, ASSIGNEE, APPROVER, REVIEWER, VIEWER roles)
- Recurrence fields, baseline fields, scheduling fields
- `createdAt`, `updatedAt`, `deletedAt`

**Key Structural Difference**: `work_items` uses a separate `workItemAssignments` table with role-based tracking, while `operational_tasks` stores assignments as denormalized arrays.

---

## FK Dependencies on `operational_tasks`

All the following tables have **hard FK references TO `operationalTasks`** and would break if switched:

| Table | FK Column | Cascade |
|-------|-----------|---------|
| `task_comments` | `task_id` | cascade delete |
| `task_checklists` | `task_id` | cascade delete |
| `task_attachments` | `task_id` | cascade delete |
| `task_deliverables` | `task_id` | cascade delete |
| `task_activity_log` | `task_id` | cascade delete |
| `task_watchers` | `task_id` | cascade delete |
| `ms_objects` | `linked_operational_task_id` | cascade delete |

---

## Endpoint-to-Table Mapping

### Endpoints Using Adapter (3 of 28)

| Endpoint | Adapter Function |
|----------|-----------------|
| `GET /api/eng/tasks` | `listEngineeringWorkItems()` |
| `POST /api/eng/tasks` | `createEngineeringWorkItem()` |
| `PATCH /api/eng/tasks/:id` | `updateEngineeringWorkItem()` |

### Endpoints Bypassing Adapter — Direct `operational_tasks` (25 of 28)

| # | Endpoint | READS | WRITES | Risk |
|---|----------|-------|--------|------|
| 1 | `POST /api/eng/tasks/:id/send-for-approval` | operational_tasks | operational_tasks + activity_log + comments | **CRITICAL** |
| 2 | `POST /api/eng/tasks/:id/send-deliverable` | operational_tasks | operational_tasks + deliverables + comments | **CRITICAL** |
| 3 | `GET /api/eng/dashboard/standup` | operational_tasks | — | **CRITICAL** |
| 4 | `POST /api/eng/tasks/bulk-update` | operational_tasks | operational_tasks + activity_log | **CRITICAL** |
| 5 | `POST /api/eng/tasks/:id/subtasks` | operational_tasks | operational_tasks + activity_log | **CRITICAL** |
| 6 | `POST /api/eng/warnings/scan` | operational_tasks | qc_warning + events | **CRITICAL** |
| 7 | `GET /api/eng/tasks/:id` | operational_tasks | — | **CRITICAL** |
| 8 | `GET /api/eng/tasks/:id/subtasks` | operational_tasks | — | **CRITICAL** |
| 9 | `POST /api/eng/backfill-assignees` | operational_tasks | operational_tasks | **CRITICAL** |
| 10 | `DELETE /api/eng/tasks/:id` | work_items | work_items | PARTIAL |
| 11 | `POST /api/eng/tasks/:id/link` | operational_tasks | operational_tasks + activity_log | HIGH |
| 12 | `GET /api/eng/dashboard/projects` | operational_tasks | — | MEDIUM |
| 13 | `GET /api/eng/dashboard/workload` | operational_tasks | — | MEDIUM |
| 14 | `GET /api/eng/dashboard/milestones-at-risk` | operational_tasks | — | MEDIUM |
| 15 | `POST /api/eng/tasks/:id/watchers` | task_watchers | task_watchers | MEDIUM |
| 16-25 | Comments, activity, deliverables, warnings | Mixed | Mixed | LOW-MEDIUM |

---

## Critical Data Divergence Scenarios

### Scenario 1: Mixed Read Sources
- `GET /api/eng/tasks` (list) reads from **work_items** via adapter
- `GET /api/eng/tasks/:id` (detail) reads from **operational_tasks** directly
- A task created via POST (work_items) may return via list but 404 on detail

### Scenario 2: Status Divergence
- Task created via adapter → `work_items.status = "To Do"`
- Same task approved via send-for-approval → `operational_tasks.status = "NEEDS APPROVAL"`
- **work_items never updated** — status permanently diverged

### Scenario 3: Dashboard Count Mismatch
- Standup dashboard counts tasks from `operational_tasks`
- Task board lists tasks from `work_items`
- Different totals shown to users

---

## Adapter Analysis

The adapter (`work-items-adapter.ts`) provides 6 functions:
1. `listEngineeringWorkItems()` — Maps work_items → operational_tasks format
2. `createEngineeringWorkItem()` — Creates work_items + assignments
3. `updateEngineeringWorkItem()` — Updates work_items + assignments
4. `deleteEngineeringWorkItem()` — Soft deletes work_items
5. `getWorkItemsAsEngineeringTasks()` — Batch read with assignments
6. Specific wrapper for ENG workstream

**Critical Finding**: These adapter functions **NEVER sync back to operational_tasks**. The two tables are **completely independent** with no synchronization layer.

---

## Risk Assessment

| Risk | Severity | Evidence |
|------|----------|----------|
| Data Divergence | CRITICAL | 25/28 endpoints bypass adapter |
| Inconsistent GET | CRITICAL | List vs detail read from different tables |
| FK Constraint Violations | CRITICAL | 8 tables have hard FKs to operational_tasks only |
| Orphaned Records | HIGH | Soft deletes don't sync between tables |
| Status Divergence | HIGH | Status changes in one table don't propagate |
| Assignment Inconsistency | MEDIUM | Array fields vs FK table structure mismatch |
