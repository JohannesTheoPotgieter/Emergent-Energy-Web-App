# MyTool to Work Items Column Mapping

This document maps all 24 `mytool_tasks` columns to their `work_items` equivalents.

## Extension Table: NOT NEEDED

An extension table is NOT NEEDED because all personal task fields are already columns on the `work_items` table. The work_items schema was designed to accommodate both project tasks and personal tasks in a single unified table.

## Column Mapping

| mytool_tasks Column | work_items Column | Notes |
|---|---|---|
| `owner_user_id` | `assignee_user_id` | Direct mapping |
| `title` | `title` | Direct mapping |
| `notes` | `description` | Renamed for consistency |
| `status` | `status` | Direct mapping (normalized to uppercase) |
| `priority` | `priority` | Direct mapping |
| `planned_for_date` | `start_date` | Mapped to start_date for unified scheduling |
| `due_at` | `end_date` | Mapped to end_date for unified deadlines |
| `start_date` | `start_date` | Direct mapping |
| `bucket` | `bucket` | Direct mapping (personal task grouping) |
| `pinned_today` | `pinned_today` | Direct mapping (personal task feature) |
| `pinned_week` | `pinned_week` | Direct mapping (personal task feature) |
| `sort_order` | `sort_order` | Direct mapping (personal task ordering) |
| `is_recurring` | `is_recurring` | Direct mapping (recurrence support) |
| `recurrence_frequency` | `recurrence_frequency` | Direct mapping (daily/weekly/monthly) |
| `recurrence_interval` | `recurrence_interval` | Direct mapping (interval multiplier) |
| `blocked_reason` | `blocked_reason` | Direct mapping |
| `tag` | `tag` | Direct mapping (personal task labeling) |
| `definition_of_done` | `definition_of_done` | Direct mapping |
| `completion_note` | `completion_note` | Direct mapping |
| `next_step` | `next_step` | Direct mapping |
| `source_email_id` | `source_email_id` | Direct mapping (email-to-task tracking) |
| `source_email_subject` | `source_email_subject` | Direct mapping (email context) |
| `completed_at` | `completed_at` | Direct mapping |
| `deleted_at` | `deleted_at` | Direct mapping (soft delete) |

## Removal Plan

The `mytool_tasks` table will be dropped in a separate cleanup PR after one release window has passed with the migration running in production. This ensures rollback capability during the transition period.

Steps:
1. Migration runs in production for one release window
2. Verify no queries reference `mytool_tasks` directly
3. Submit separate cleanup PR to drop the table
4. Remove legacy adapter code
