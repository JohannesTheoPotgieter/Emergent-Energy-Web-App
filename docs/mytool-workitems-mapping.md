# MyTool Tasks → WorkItems Migration Mapping

## Status: COMPLETE

The migration from `mytool_tasks` to `work_items` (with `workstream = 'PERSONAL'`) is
already implemented. This document records the verified field mapping.

## Data Migration

**Migration file**: `migrations/20260371_migrate_mytool_to_work_items.sql`
- Idempotent: uses `NOT EXISTS (SELECT 1 FROM work_items wi WHERE wi.legacy_table = 'mytool_tasks' AND wi.legacy_id = mt.id)`
- Original `mytool_tasks` rows are preserved (not deleted)
- Creates OWNER assignments for migrated tasks

## Field Mapping

| Source (mytool_tasks) | Target (work_items) | Transform Rule | Null/Default Handling |
|---|---|---|---|
| `id` | `legacy_id` | Stored as reference back to original | N/A |
| (literal) | `legacy_table` | Set to `'mytool_tasks'` | N/A |
| (literal) | `workstream` | Set to `'PERSONAL'` | N/A |
| (literal) | `source` | Set to `'SYSTEM'` | N/A |
| `owner_user_id` | `owner_user_id` | Direct copy | NOT NULL |
| `owner_user_id` | `created_by` | Same as owner | NOT NULL |
| `title` | `title` | Direct copy | NOT NULL |
| `notes` | `description` | Direct copy | NULL allowed |
| `status` | `status` | Enum mapping (see below) | Default: `'TO DO'` |
| `priority` | `priority` | Enum mapping (see below) | Default: `'Med'` |
| `start_date` | `start_date` | Cast to DATE | NULL allowed |
| `due_at` | `end_date` | Cast timestamp to DATE | NULL allowed |
| `planned_for_date` | `scheduled_date` | Direct copy (text→date) | NULL allowed |
| `scheduled_start_time` | `scheduled_start_time` | Direct copy | NULL allowed |
| `scheduled_end_time` | `scheduled_end_time` | Direct copy | NULL allowed |
| `project_id` | `project_id` | Direct copy | NULL allowed |
| `sort_order` | `sort_order` | Direct copy | Default: 0 |
| `is_recurring` | `is_recurring` | Direct copy | Default: false |
| `recurrence_frequency` | `recurrence_frequency` | Cast enum to text | NULL allowed |
| `recurrence_interval` | `recurrence_interval` | Direct copy | Default: 1 |
| `recurrence_days_of_week` | `recurrence_days_of_week` | Direct copy | NULL allowed |
| `recurrence_end_date` | `recurrence_end_date` | Cast to DATE | NULL allowed |
| `recurrence_parent_id` | `recurrence_parent_id` | Direct copy | NULL allowed |
| `task_type` | `type` | `'milestone'` → `'milestone'`, else NULL | NULL if task |
| `blocked_reason` | `hold_reason` | Direct copy | NULL allowed |
| `tag` | `task_type_tag` | Direct copy | NULL allowed |
| `bucket` | `bucket` | Cast enum to text | NULL allowed |
| `pinned_today` | `pinned_today` | Direct copy | Default: false |
| `pinned_week` | `pinned_week` | Direct copy | Default: false |
| `source_email_id` | `source_email_id` | Direct copy | NULL allowed |
| `source_email_subject` | `source_email_subject` | Direct copy | NULL allowed |
| `next_step` | `next_step` | Direct copy | NULL allowed |
| `definition_of_done` | `definition_of_done` | Direct copy | NULL allowed |
| `completion_note` | `completion_note` | Direct copy | NULL allowed |
| `completed_at` | `completed_at` | Direct copy | NULL allowed |
| `deleted_at` | `deleted_at` | Direct copy (soft delete) | NULL allowed |
| `created_at` | `created_at` | Direct copy | NOT NULL |
| `updated_at` | `updated_at` | Direct copy | NOT NULL |

### Fields NOT migrated (mytool-only, not needed in workItems)
| Source Field | Reason |
|---|---|
| `project_name` | Resolved via `project_id` FK instead |
| `department` | Not used in personal task workflow |

## Status Mapping

| mytool_tasks.status | work_items.status |
|---|---|
| `inbox` | `TO DO` |
| `planned` | `TO DO` |
| `in_progress` | `IN PROGRESS` |
| `blocked` | `HOLD` |
| `waiting` | `HOLD` |
| `done` | `COMPLETE` |
| `cancelled` | `COMPLETE` |

## Priority Mapping

| mytool_tasks.priority | work_items.priority |
|---|---|
| `low` | `Low` |
| `normal` | `Med` |
| `high` | `High` |
| `critical` | `Urgent` |

## Extension Table

**NOT NEEDED.** All personal-task-specific fields (bucket, pinnedToday, pinnedWeek,
sourceEmailId, sourceEmailSubject, nextStep, definitionOfDone, completionNote) are
already columns on the `work_items` table (added in migration `20260370_unify_task_system.sql`).

## Compatibility

- **Feature flag**: `canonical_work_items_v1` controls read path (work-items-adapter.ts)
- **Bridge function**: `getWorkItemsAsMytoolTasks()` returns workItems data in legacy mytool shape
- **Storage layer**: `work-management-repository.ts` reads from `work_items WHERE workstream='PERSONAL'`
- **Legacy removal**: Planned for separate cleanup PR after one release window of verified parity
