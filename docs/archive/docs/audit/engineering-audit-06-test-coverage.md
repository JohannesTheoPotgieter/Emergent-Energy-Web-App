# Audit 6: Test Coverage Gap Analysis

**Date:** 2026-03-19
**Scope:** Existing tests and critical gaps in the engineering module
**Status:** Read-only audit — no changes made

---

## What IS Tested

### API CRUD (`qa/tests/api/engineering-canonical.test.ts`)
- Engineering task create/update/delete with canonical identifiers (workItemId)
- Task assignment and traceability (reassign flow)
- Project-level task listing without duplicates
- Task generation with duplicate-click protection

### Workflow Guard (`qa/tests/unit/task-workflow-guard.test.ts`)
- Status transition validation (approval-required and deliverable-required tasks)
- Send for Approval action (conditional on deliverable sent)
- Send Deliverable action (recipient + override reason capture)
- Bulk update enforces workflow constraints
- Hold status requires reason + blocked type

### Standup Grouping (`qa/tests/unit/engineering-standup-grouping.test.ts`)
- Task classification by due date (overdue, dueSoon, onHold)
- Unassigned task grouping
- Multiple status handling

### Task Filtering (`qa/tests/unit/engineering-task-filters.test.ts`)
- Workload state filtering (blocked, approval, deliverable, review)
- Due date filtering (overdue)
- Linked source filtering (microsoft_linked, project_unlinked)
- Assignee and project name filtering
- Metric derivation (openTasks, overdueTasks, holdTasks, etc.)

### Workflow Critical Pack (`qa/tests/api/workflow-critical-pack.test.ts`)
- Basic approval send flow with file upload
- Invalid form rejection (missing required fields)

---

## Critical Test Gaps (Prioritized)

### P0: Runtime Bug Coverage

| Gap | Type | Notes |
|-----|------|-------|
| TaskDetailDrawer status change | Component | `tasks` variable bug will crash at runtime — untested |
| Hold reason dialog (page + drawer) | Component | Both paths need validation testing |
| `filterStatuses` prop missing in MyTasksView | Component | Will crash — untested |
| `evaluateAuthorityForRequest` import | Integration | PATCH /api/deliverables/:id will crash — untested |

### P0: Data Integrity

| Gap | Type | Notes |
|-----|------|-------|
| work_items ↔ operational_tasks sync | Integration | No tests verify consistency between tables |
| Adapter creates in work_items, routes read from operational_tasks | Integration | Data divergence scenario untested |
| Orphaned records after task deletion | Integration | Comments/activity pointing to deleted tasks |

### P1: Workflow Guard Edge Cases

| Gap | Type | Notes |
|-----|------|-------|
| Approval + deliverable sequencing | Workflow | Task requiring BOTH: what ordering is enforced? |
| Approval withdrawal after send | Workflow | State recovery untested |
| Deliverable rejection after approval sent | Workflow | Edge case untested |
| All possible status transitions matrix | Unit | Not exhaustively tested |
| HOLD vs ON HOLD normalization | Unit | Status name variants |

### P1: Deliverable Flows

| Gap | Type | Notes |
|-----|------|-------|
| File upload → approval record creation | API | Valid upload flow untested |
| Invalid file type rejection | API | No file validation tests |
| File size limit (50MB) enforcement | API | No boundary tests |
| Audit trail for send flow | API | Override reason capture untested |
| Send deliverable → acknowledge flow | API | End-to-end flow untested |
| Only recipient can acknowledge | API | Permission check untested |

### P1: Bulk Operations

| Gap | Type | Notes |
|-----|------|-------|
| Partial failure handling | API | 100 tasks, fails at #50 — no rollback test |
| Idempotency | API | Duplicate submissions untested |
| HOLD without reason in bulk | API | Validation enforcement untested |

### P1: Engineering Stages

| Gap | Type | Notes |
|-----|------|-------|
| Stage generation creates correct tasks | API | `generateEngStagesForProject()` untested |
| Stage completion gate validation | API | All 4 gate rules untested |
| COO override bypasses gates | API | Override flow untested |
| Missing items check on completion | API | Error response untested |
| Deliverable upload requirement per stage | API | Gate enforcement untested |
| Approval gate (QA + Technical Signoff) | API | Handover Pack special gates untested |

### P2: Frontend Rendering

**Zero component-level tests exist** — no `*.test.tsx` files found in `client/`.

| Gap | Type | Notes |
|-----|------|-------|
| Kanban drag-drop persists status | E2E | Does dropping between columns save? |
| Quick status select updates correctly | Component | Dropdown on task card |
| View mode switching preserves filters | Component | Kanban → List → Timeline |
| Timeline view with/without dates | Component | Rendering edge cases |
| Hold dialog validation + submission | Component | Form field requirements |

### P2: Concurrent Operations

| Gap | Type | Notes |
|-----|------|-------|
| Two users update same task simultaneously | Load | Last-write-wins or conflict? |
| Bulk update with 1000+ tasks | Load | Timeout risk |
| Rapid status changes | Load | Race condition risk |

---

## Recommended Test Additions

| Priority | Feature | Type | Effort |
|----------|---------|------|--------|
| P0 | TaskDetailDrawer status change persistence | Component/Integration | Medium |
| P0 | Hold reason dialog validation + submission | Component | Medium |
| P0 | work_items ↔ operational_tasks sync verification | Integration | High |
| P1 | Bulk update partial failure handling | API | Medium |
| P1 | Send deliverable → acknowledge full flow | API | Medium |
| P1 | Approval + deliverable sequencing | Workflow | Medium |
| P1 | Stage generation + completion gates | API | High |
| P2 | Kanban drag-drop persistence | E2E | Medium |
| P2 | Task deletion cascades (cleanup verification) | Integration | Low |
| P2 | Concurrent update conflict detection | Load | High |
| P3 | Timeline view rendering edge cases | Component | Medium |

---

## Existing Test Files

| File | Coverage |
|------|----------|
| `qa/tests/api/engineering-canonical.test.ts` | CRUD + canonical identifiers |
| `qa/tests/api/workflow-critical-pack.test.ts` | Basic workflow + approval send |
| `qa/tests/unit/task-workflow-guard.test.ts` | Guard logic |
| `qa/tests/unit/engineering-standup-grouping.test.ts` | Grouping logic |
| `qa/tests/unit/engineering-task-filters.test.ts` | Filter logic |
| `qa/tests/e2e/smoke.spec.ts` | Route accessibility only |

---

## Summary

**Well-tested:** API CRUD, canonical identifiers, workflow guard logic, filtering/grouping
**Critical gaps:** Component interactions, deliverable flows, stage management, data sync, bulk operations
**Zero frontend component tests exist**
**Risk level:** MEDIUM-HIGH — known workflows exist but untested at integration/component level
