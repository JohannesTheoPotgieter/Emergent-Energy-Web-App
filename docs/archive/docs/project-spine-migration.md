# Project Spine Migration

This migration introduces a first-class project spine for core operational records.

## Tables updated

- `work_items`
- `approvals`
- `deliverables`
- `qc_checklist`
- `qc_item_evidence` (new `project_id` column)
- `normalized_cost_lines`
- `normalized_revenue_lines`
- `normalized_execution_phases`
- `project_linkage_review_queue` (new)

## Backfill strategy

The migration is deterministic and repeatable:

1. Backfill by `project_name -> project_info.project_name` where available.
2. Backfill `approvals.project_id` from linked entities (`work_items`, `commissioning_items`, `change_requests`, `procurement_items`, `invoice_captures`, `deliverables`).
3. Backfill `qc_item_evidence.project_id` through `qc_item_instance -> qc_checklist`.
4. Any unresolved records are inserted/upserted into `project_linkage_review_queue` for manual review.

## Safety controls

- No unresolved row is guessed into a project.
- `project_linkage_review_queue` has a `(table_name, record_id)` unique constraint for idempotent reruns.
- `NOT NULL` is enforced only when a table has zero unresolved null `project_id` rows.
- New indexes were added for all core `project_id` fields and review queue access.
