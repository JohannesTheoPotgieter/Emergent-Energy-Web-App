# Sub-table Repoint Report

> Generated: 2026-03-20 | Prompt 7 of 15

## Problem

Six task sub-tables use a polymorphic `task_id` column with **no FK constraint**:

| Table | Rows Reference | FK? |
|-------|---------------|-----|
| task_comments | operational_tasks or engineering_tasks | No |
| task_checklists | operational_tasks or engineering_tasks | No |
| task_attachments | operational_tasks or engineering_tasks | No |
| task_activity_log | operational_tasks or engineering_tasks | No |
| task_watchers | operational_tasks or engineering_tasks | No |
| task_deliverables | operational_tasks or engineering_tasks | No |

Two tables already reference `work_items` correctly:

| Table | Column | FK? |
|-------|--------|-----|
| work_item_assignments | work_item_id | Yes (CASCADE) |
| work_item_dependencies | predecessor_id, successor_id | Yes (CASCADE) |

## Solution

### Phase 1: Add work_item_id (this prompt)
- Add `work_item_id INTEGER REFERENCES work_items(id) ON DELETE CASCADE` to each sub-table
- Create index on work_item_id for each
- Backfill via task_migration_map + direct match fallback
- Old `task_id` column **retained** (dual-column period)

### Phase 2: Swap reads to work_item_id (future prompt)
- Update queries to use work_item_id instead of task_id
- Dual-write both columns

### Phase 3: Drop task_id (future prompt)
- Remove old task_id column after all code migrated

## Backfill Strategy

The `task_id` values in sub-tables are ambiguous — they could reference any source table. Resolution order:

1. **task_migration_map lookup**: Try each source table in priority order:
   - operational_tasks (most common)
   - engineering_tasks
   - tasks (legacy)
   - normalized_plan_tasks
   - mytool_tasks, intake_tasks, project_eng_tasks, qc_item_instance, project_plan

2. **Direct work_items match**: If task_id happens to be a valid work_items.id (post-migration writes)

3. **Orphan**: Rows that can't be resolved — logged with sample IDs for investigation

## Schema Changes

### Drizzle (shared/schema/tasks.ts)

Added `workItemId` to 6 tables:
```typescript
workItemId: integer("work_item_id").references(() => workItems.id, { onDelete: "cascade" }),
```

### SQL Migration (20260332_repoint_subtables.sql)

```sql
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS work_item_id INTEGER REFERENCES work_items(id) ON DELETE CASCADE;
-- (repeated for all 6 tables, plus indexes)
```

## Files

| File | Purpose |
|------|---------|
| `shared/schema/tasks.ts` | Added workItemId to 6 sub-table definitions |
| `migrations/20260332_repoint_subtables.sql` | DDL: add work_item_id + indexes |
| `migrations/20260332_repoint_subtables_rollback.sql` | Rollback: drop work_item_id columns |
| `scripts/backfill-subtable-work-item-ids.ts` | Backfill: resolve task_id → work_item_id |
| `docs/spine-v2/05-subtable-repoint-report.md` | This report |

## Rollback

Simply drop the work_item_id columns — old task_id is untouched:
```sql
ALTER TABLE task_comments DROP COLUMN IF EXISTS work_item_id;
-- (repeated for all 6 tables)
```
