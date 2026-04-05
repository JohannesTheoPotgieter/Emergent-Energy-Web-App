# Index Tuning Notes

Documentation for the FK index migration (`20260331_add_missing_fk_indexes.sql`).

## New Indexes (9 total)

### idx_ncl_import_run_id
- **Table:** `normalized_cost_lines`
- **Column:** `import_run_id`
- **Rationale:** Speeds up joins and filters by import run for cost line reconciliation and snapshot queries.

### idx_nrl_import_run_id
- **Table:** `normalized_revenue_lines`
- **Column:** `import_run_id`
- **Rationale:** Speeds up joins and filters by import run for revenue line reconciliation and snapshot queries.

### idx_hci_handover_pack_id
- **Table:** `handover_checklist_items`
- **Column:** `handover_pack_id`
- **Rationale:** Handover pack detail lookups filter by pack ID frequently.

### idx_sites_client_id
- **Table:** `sites`
- **Column:** `client_id`
- **Rationale:** Client-scoped site listings used in project development views.

### idx_users_role
- **Table:** `users`
- **Column:** `role`
- **Rationale:** Role-based user lookups used in permission evaluation and dashboard filtering.

### idx_cs_entity
- **Table:** `change_sets`
- **Column:** `(entity_type, entity_id)`
- **Rationale:** Composite index for audit/change tracking queries that filter by entity type and ID.

### idx_ncl_project_snapshot
- **Table:** `normalized_cost_lines`
- **Column:** `(project_id, snapshot_run_id)`
- **Rationale:** Composite index for project-scoped snapshot queries used in finance reconciliation.

### idx_nrl_project_snapshot
- **Table:** `normalized_revenue_lines`
- **Column:** `(project_id, snapshot_run_id)`
- **Rationale:** Composite index for project-scoped snapshot queries used in revenue reconciliation.

### idx_psi_project_stage
- **Table:** `project_stage_instances`
- **Column:** `(project_id, stage_code)`
- **Rationale:** Composite index for stage gate lookups by project and stage code.

## Skipped Indexes (already exist)

- `idx_work_items_client_id` — already exist on work_items table
- `idx_normalized_cost_lines_counterparty_id` — already exist on normalized_cost_lines table

These were identified during analysis but skipped because they already exist in the current schema.

## Validation

To verify index effectiveness, run:

```sql
EXPLAIN ANALYZE SELECT * FROM normalized_cost_lines WHERE import_run_id = 123;
EXPLAIN ANALYZE SELECT * FROM normalized_revenue_lines WHERE project_id = 1 AND snapshot_run_id = 5;
```

Compare query plans before and after index creation to confirm sequential scans are replaced with index scans.
