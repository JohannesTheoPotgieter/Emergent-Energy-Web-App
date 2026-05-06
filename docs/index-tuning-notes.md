# Index Tuning Notes

## Migration: 20260331_add_missing_fk_indexes.sql

**Date:** 2026-03-31
**Status:** Pending staging verification

### Indexes Added (9 new)

| Index | Table | Columns | Rationale |
|-------|-------|---------|-----------|
| `idx_ncl_import_run_id` | normalized_cost_lines | import_run_id | Every import commit/rollback queries by import_run_id |
| `idx_nrl_import_run_id` | normalized_revenue_lines | import_run_id | Same — import rollback soft-closes rows by run_id |
| `idx_hci_handover_pack_id` | handover_checklist_items | handover_pack_id | Handover pack detail fetches all items by pack FK |
| `idx_sites_client_id` | sites | client_id | Project-site-client joins filter by client |
| `idx_users_role` | users | role | Permission evaluation, dashboard routing |
| `idx_cs_entity` | change_sets | (entity_type, entity_id) | Audit/diff lookups always filter by entity pair |
| `idx_ncl_project_snapshot` | normalized_cost_lines | (project_id, snapshot_run_id) | Temporal snapshot queries for financial review |
| `idx_nrl_project_snapshot` | normalized_revenue_lines | (project_id, snapshot_run_id) | Same — revenue snapshot isolation |
| `idx_psi_project_stage` | project_stage_instances | (project_id, stage_code) | Lifecycle gate eligibility checks |

### Skipped (already exist)

| Index | Created In |
|-------|-----------|
| `idx_work_items_client_id` | 20260340_schema_consistency_fixes.sql |
| `idx_normalized_cost_lines_counterparty_id` | 20260340_schema_consistency_fixes.sql |

### Expected Query Improvements

#### 1. Import Rollback Query
```sql
-- Used in: server/smart-import-routes.ts POST /:runId/rollback
-- Soft-closes rows from a specific import run
UPDATE normalized_cost_lines SET effective_to = NOW()
  WHERE import_run_id = $1 AND effective_to IS NULL;
```
- **Before:** Sequential scan on normalized_cost_lines (no index on import_run_id)
- **After:** Index scan via `idx_ncl_import_run_id` → O(log n) lookup
- **Impact:** Significant for tables with >10K rows per project

#### 2. Change Set Audit Lookup
```sql
-- Used in: server/lib/audit/diff-engine.ts
SELECT * FROM change_sets
  WHERE entity_type = $1 AND entity_id = $2
  ORDER BY created_at DESC;
```
- **Before:** Sequential scan + filter on entity_type and entity_id
- **After:** Composite index scan via `idx_cs_entity`
- **Impact:** Faster audit trail rendering on project detail pages

#### 3. Lifecycle Gate Query
```sql
-- Used in: server/lifecycle-routes.ts
SELECT * FROM project_stage_instances
  WHERE project_id = $1 AND stage_code = $2;
```
- **Before:** Index scan on project_id only (psi_project_id_idx), then filter stage_code
- **After:** Composite index covers both columns → single index seek
- **Impact:** Faster execution gate eligibility checks

### Performance Verification

**Note:** EXPLAIN ANALYZE cannot be run without a live PostgreSQL database with
representative data. These notes document expected improvements based on query
patterns and index theory. Actual before/after measurements should be captured
during staging deployment:

```sql
-- Run BEFORE applying migration:
EXPLAIN ANALYZE SELECT * FROM normalized_cost_lines WHERE import_run_id = 42;
EXPLAIN ANALYZE SELECT * FROM change_sets WHERE entity_type = 'smart_import' AND entity_id = '42';
EXPLAIN ANALYZE SELECT * FROM project_stage_instances WHERE project_id = 1 AND stage_code = 'CONSTRUCTION';

-- Apply migration, then run the same queries AFTER and compare plans.
```

### Rollback

Run `20260331_add_missing_fk_indexes_rollback.sql` — drops all 9 indexes safely.
No data impact; only query performance reverts.
