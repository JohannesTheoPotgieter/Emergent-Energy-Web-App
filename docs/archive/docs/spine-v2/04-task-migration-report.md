# Task Migration — Consolidation Report

> Generated: 2026-03-20 | Prompt 6 of 15

## Existing Backfill State

The existing `server/work-items-backfill.ts` already migrates core fields from 9 source tables into `work_items`:

| Source Table | Prefix | Workstream | Notes |
|---|---|---|---|
| normalized_plan_tasks | NPT:: | PM | Smart import plan tasks |
| operational_tasks | OT:: | ENG | Operational/engineering tasks |
| engineering_tasks | ET:: | ENG | Engineering-specific tasks |
| mytool_tasks | MT:: | PERSONAL | Personal task manager |
| tasks (legacy) | TASK:: | PM | Legacy task table |
| intake_tasks | IT:: | PD | Intake/PD tasks |
| project_eng_tasks | PET:: | ENG | Project engineering tasks |
| qc_item_instance | QCI:: | QUALITY | Quality checklist items |
| project_plan | PP:: | PM | Project plan rows (fallback) |

Each migrated work_item has:
- `legacy_table` = source table name
- `legacy_id` = source row ID
- `external_ref` = `PREFIX::ID` (unique)

## What Prompt 6 Adds

### 1. task_migration_map

Formal tracking table populated from `work_items.legacy_table + legacy_id`:

```sql
CREATE TABLE task_migration_map (
  id SERIAL PRIMARY KEY,
  old_table TEXT NOT NULL,
  old_id INTEGER NOT NULL,
  new_work_item_id INTEGER REFERENCES work_items(id) ON DELETE CASCADE,
  migrated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(old_table, old_id)
);
```

### 2. Extension Table Population

Data flows from `work_items` columns → extension tables:

| Extension | Source Columns | Population Rule |
|---|---|---|
| work_item_pm | duration, percent_complete, phase, is_milestone, hold_reason, blocked_type, approval_required, tracking_rag, etc. | Any work_item with PM-domain data |
| work_item_engineering | wbs_code, outline_number, legacy_table, legacy_id, source_row, source_sheet, import_run_id | Any work_item with import/WBS data |
| work_item_scheduling | scheduled_date/time, baseline_*, actual_*, is_recurring, recurrence_*, task_mode | Any work_item with scheduling data; also enriched from operational_tasks + engineering_tasks scheduling columns |

### 3. Column Mapping: operational_tasks → work_items + extensions

| operational_tasks column | Target | Notes |
|---|---|---|
| title, description, status, priority | work_items (core) | Already migrated |
| projectId, ownerUserId, startDate, dueDate | work_items (core) | Already migrated |
| holdReason, blockedType, blockerReason | work_items → work_item_pm | Copied to extension |
| approvalRequired, trackingRag, taskTypeTag | work_items → work_item_pm | Copied to extension |
| completedAt, duration, percentComplete | work_items → work_item_pm | Copied to extension |
| scheduledDate, scheduledStartTime/EndTime | work_item_scheduling | From source table |
| actualStartDate, actualEndDate, actualDurationDays | work_item_scheduling | From source table |
| requesterUserId, approverUserId | — | Not in extension schema yet |
| assignees, assigneeUserIds | work_item_assignments | Already migrated |
| plannedHours, actualHours | — | Not in extension schema yet |
| escalationLevel, domain, pdTicketId | — | Not in extension schema yet |
| externalSource/TaskId/SubtaskIds/Urls | — | Not in extension schema yet |

### 4. Column Mapping: engineering_tasks → work_items + extensions

| engineering_tasks column | Target | Notes |
|---|---|---|
| title, description, status | work_items (core) | Already migrated |
| projectId, assigneeUserId | work_items (core) | Already migrated |
| scheduledDate, scheduledStartTime/EndTime | work_item_scheduling | From source table |
| lifecyclePhaseTag | — | Not in extension schema yet |
| requiresQcApproval, requiresOpsApproval | — | Not in extension schema yet |
| qcApprovedAt, qcApprovedByRole | — | Not in extension schema yet |
| opsApprovedAt, opsApprovedByRole | — | Not in extension schema yet |

### 5. Unmigrated Columns (Future Work)

These source columns have no target in the current extension schema:

| Column | Source | Suggested Future Table |
|---|---|---|
| requesterUserId | operational_tasks | work_item_pm or work_item_assignments |
| approverUserId | operational_tasks | work_item_pm or work_item_assignments |
| plannedHours, actualHours | operational_tasks | work_item_scheduling |
| escalationLevel | operational_tasks | work_item_pm |
| domain | operational_tasks | work_item_pm |
| pdTicketId | operational_tasks | work_item_pm |
| externalSource/TaskId | operational_tasks | work_item_engineering |
| lifecyclePhaseTag | engineering_tasks | work_item_engineering |
| requiresQcApproval/Ops | engineering_tasks | work_item_engineering |
| qcApprovedAt/ByRole | engineering_tasks | work_item_engineering |
| opsApprovedAt/ByRole | engineering_tasks | work_item_engineering |

These can be added to extension tables in a future prompt without data loss.

## Rollback Strategy

1. TRUNCATE all 3 extension tables (data is a copy from work_items, no loss)
2. DROP task_migration_map
3. work_items core data remains intact
4. Source tables (operational_tasks, engineering_tasks, etc.) are untouched

## Files

| File | Purpose |
|---|---|
| `shared/schema/tasks.ts` | Added taskMigrationMap Drizzle table |
| `migrations/20260331_task_migration_map.sql` | DDL: create task_migration_map |
| `migrations/20260331_task_migration_map_rollback.sql` | Rollback: truncate extensions, drop map |
| `scripts/backfill-task-extensions.ts` | Backfill: populate map + 3 extensions |
| `docs/spine-v2/04-task-migration-report.md` | This report |
