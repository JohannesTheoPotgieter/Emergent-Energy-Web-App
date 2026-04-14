# Emergent Energy Platform — Database Migration & Cleanup Prompt

> **Give this prompt to an AI extension with WRITE access to the production PostgreSQL database (or a staging clone). It covers every schema-level fix that cannot be done in application code alone.**

---

## YOUR ROLE & SAFETY RULES

You are a **database migration engineer** performing schema-level fixes on the Emergent Energy platform's PostgreSQL database.

### Ground Rules
- **Take a full backup FIRST.** Before any migration, run `pg_dump` and verify the backup is restorable.
- **Run on staging first.** Every migration must succeed on a staging copy before touching production.
- **Use transactions.** Wrap each migration step in `BEGIN; ... COMMIT;` so failures can be rolled back.
- **Never DROP without verification.** Before dropping any column or table, verify ZERO reads/writes in the last 30 days.
- **Log everything.** Record what you changed, when, and the row counts affected in `migration_cleanup_log`.
- **One section at a time.** Do NOT run all migrations in a single transaction — break them into independent, atomic steps.

---

## MIGRATION 1: NORMALIZE STATUS CASING (CRITICAL)

### Problem
Status values have inconsistent casing across the database. The same logical status exists as `"Draft"`, `"DRAFT"`, `"draft"`, and `"Not Started"` / `"NOT_STARTED"` / `"not_started"` depending on which code path wrote the data. This causes cross-domain comparisons to fail silently.

### Target Convention
**All status values must use `lowercase_with_underscores`.** Example: `not_started`, `in_progress`, `ready_for_review`.

### Migration Steps

**Step 1A: Audit current values**
Run these queries FIRST to see what exists. Do NOT change anything yet.

```sql
-- Work items (the biggest table)
SELECT status, COUNT(*) FROM work_items WHERE deleted_at IS NULL GROUP BY status ORDER BY COUNT(*) DESC;

-- Stage instances
SELECT stage_status, COUNT(*) FROM project_stage_instances GROUP BY stage_status ORDER BY COUNT(*) DESC;

-- Stage requirements
SELECT status, COUNT(*) FROM project_stage_requirements GROUP BY status ORDER BY COUNT(*) DESC;

-- Stage exceptions
SELECT status, COUNT(*) FROM project_stage_exceptions GROUP BY status ORDER BY COUNT(*) DESC;

-- Stage dependencies
SELECT status, COUNT(*) FROM project_stage_dependencies GROUP BY status ORDER BY COUNT(*) DESC;

-- Deliverables
SELECT status, COUNT(*) FROM deliverables GROUP BY status ORDER BY COUNT(*) DESC;

-- Site activities
SELECT status, COUNT(*) FROM site_activities GROUP BY status ORDER BY COUNT(*) DESC;

-- Snags
SELECT status, COUNT(*) FROM snags GROUP BY status ORDER BY COUNT(*) DESC;

-- Site inspections
SELECT status, COUNT(*) FROM site_inspections GROUP BY status ORDER BY COUNT(*) DESC;
SELECT result, COUNT(*) FROM site_inspections GROUP BY result ORDER BY COUNT(*) DESC;

-- HSE incidents
SELECT status, COUNT(*) FROM hse_incidents GROUP BY status ORDER BY COUNT(*) DESC;

-- Corrective actions
SELECT status, COUNT(*) FROM corrective_actions GROUP BY status ORDER BY COUNT(*) DESC;

-- Handover packs
SELECT status, COUNT(*) FROM handover_packs GROUP BY status ORDER BY COUNT(*) DESC;
SELECT checklist_status, COUNT(*) FROM handover_packs GROUP BY checklist_status ORDER BY COUNT(*) DESC;

-- Handover checklist items
SELECT status, COUNT(*) FROM handover_checklist_items GROUP BY status ORDER BY COUNT(*) DESC;

-- SSEG items
SELECT status, COUNT(*) FROM sseg_items GROUP BY status ORDER BY COUNT(*) DESC;

-- SSEG applications
SELECT application_stage, COUNT(*) FROM sseg_applications GROUP BY application_stage ORDER BY COUNT(*) DESC;

-- Clients
SELECT status, COUNT(*) FROM clients GROUP BY status ORDER BY COUNT(*) DESC;

-- Sites
SELECT status, COUNT(*) FROM sites GROUP BY status ORDER BY COUNT(*) DESC;

-- Opportunities
SELECT status, COUNT(*) FROM opportunities GROUP BY status ORDER BY COUNT(*) DESC;
SELECT stage, COUNT(*) FROM opportunities GROUP BY stage ORDER BY COUNT(*) DESC;

-- Contracts
SELECT signature_status, COUNT(*) FROM contracts GROUP BY signature_status ORDER BY COUNT(*) DESC;

-- Change requests (already has pgEnum — verify values)
SELECT status, COUNT(*) FROM change_requests WHERE deleted_at IS NULL GROUP BY status ORDER BY COUNT(*) DESC;

-- Project execution state
SELECT phase, COUNT(*) FROM project_execution_state GROUP BY phase ORDER BY COUNT(*) DESC;

-- Project charters
SELECT status, COUNT(*) FROM project_charters GROUP BY status ORDER BY COUNT(*) DESC;

-- QC checklist
SELECT status, COUNT(*) FROM qc_checklist GROUP BY status ORDER BY COUNT(*) DESC;

-- QC item instances
SELECT qm_status, COUNT(*) FROM qc_item_instance GROUP BY qm_status ORDER BY COUNT(*) DESC;

-- Upload metadata
SELECT status, COUNT(*) FROM upload_metadata GROUP BY status ORDER BY COUNT(*) DESC;

-- Refresh logs
SELECT status, COUNT(*) FROM refresh_logs GROUP BY status ORDER BY COUNT(*) DESC;
```

**Step 1B: Record the audit results.** Save the output. This is your "before" snapshot.

**Step 1C: Normalize work_items statuses**

The `work_items` table is the most critical. Its statuses use UPPER CASE WITH SPACES:

```sql
BEGIN;

-- work_items: Normalize to the canonical set
-- These are the ONLY valid values after normalization:
-- 'to_do', 'in_progress', 'hold', 'projects_assistance',
-- 'needs_approval', 'qc_approved', 'provide_feedback',
-- 'operational_approval', 'complete'

UPDATE work_items SET status = 'to_do' WHERE status = 'TO DO';
UPDATE work_items SET status = 'in_progress' WHERE status = 'IN PROGRESS';
UPDATE work_items SET status = 'hold' WHERE status = 'HOLD';
UPDATE work_items SET status = 'projects_assistance' WHERE status = 'PROJECTS ASSISTANCE';
UPDATE work_items SET status = 'needs_approval' WHERE status = 'NEEDS APPROVAL';
UPDATE work_items SET status = 'qc_approved' WHERE status = 'QC APPROVED';
UPDATE work_items SET status = 'provide_feedback' WHERE status = 'PROVIDE FEEDBACK';
UPDATE work_items SET status = 'operational_approval' WHERE status = 'OPERATIONAL APPROVAL';
UPDATE work_items SET status = 'complete' WHERE status = 'COMPLETE';

-- Also fix the status history table
UPDATE work_item_status_history SET new_status = 'to_do' WHERE new_status = 'TO DO';
UPDATE work_item_status_history SET new_status = 'in_progress' WHERE new_status = 'IN PROGRESS';
UPDATE work_item_status_history SET new_status = 'hold' WHERE new_status = 'HOLD';
UPDATE work_item_status_history SET new_status = 'projects_assistance' WHERE new_status = 'PROJECTS ASSISTANCE';
UPDATE work_item_status_history SET new_status = 'needs_approval' WHERE new_status = 'NEEDS APPROVAL';
UPDATE work_item_status_history SET new_status = 'qc_approved' WHERE new_status = 'QC APPROVED';
UPDATE work_item_status_history SET new_status = 'provide_feedback' WHERE new_status = 'PROVIDE FEEDBACK';
UPDATE work_item_status_history SET new_status = 'operational_approval' WHERE new_status = 'OPERATIONAL APPROVAL';
UPDATE work_item_status_history SET new_status = 'complete' WHERE new_status = 'COMPLETE';

-- Fix old_status column too
UPDATE work_item_status_history SET old_status = 'to_do' WHERE old_status = 'TO DO';
UPDATE work_item_status_history SET old_status = 'in_progress' WHERE old_status = 'IN PROGRESS';
UPDATE work_item_status_history SET old_status = 'hold' WHERE old_status = 'HOLD';
UPDATE work_item_status_history SET old_status = 'projects_assistance' WHERE old_status = 'PROJECTS ASSISTANCE';
UPDATE work_item_status_history SET old_status = 'needs_approval' WHERE old_status = 'NEEDS APPROVAL';
UPDATE work_item_status_history SET old_status = 'qc_approved' WHERE old_status = 'QC APPROVED';
UPDATE work_item_status_history SET old_status = 'provide_feedback' WHERE old_status = 'PROVIDE FEEDBACK';
UPDATE work_item_status_history SET old_status = 'operational_approval' WHERE old_status = 'OPERATIONAL APPROVAL';
UPDATE work_item_status_history SET old_status = 'complete' WHERE old_status = 'COMPLETE';

COMMIT;
```

> **IMPORTANT:** After running this, the application code must also be updated to use the new lowercase values. The code changes should be deployed **simultaneously** with the DB migration. If you run the DB migration without the code change, the app will write UPPER CASE values that don't match the normalized data.

**Step 1D: Normalize deliverable statuses**

```sql
BEGIN;
UPDATE deliverables SET status = 'to_do' WHERE status = 'TO DO';
UPDATE deliverables SET status = 'in_progress' WHERE status = 'IN PROGRESS';
UPDATE deliverables SET status = 'needs_approval' WHERE status = 'NEEDS APPROVAL';
UPDATE deliverables SET status = 'provide_feedback' WHERE status = 'PROVIDE FEEDBACK';
UPDATE deliverables SET status = 'qc_approved' WHERE status = 'QC APPROVED';
UPDATE deliverables SET status = 'operational_approval' WHERE status = 'OPERATIONAL APPROVAL';
UPDATE deliverables SET status = 'complete' WHERE status = 'COMPLETE';
COMMIT;
```

**Step 1E: Normalize stage lifecycle statuses (if mixed casing found)**

These should already be UPPER_CASE consistently, but verify with the audit query. If any lowercase values exist:

```sql
BEGIN;
-- Only run if the audit shows mixed casing
UPDATE project_stage_instances SET stage_status = UPPER(stage_status) WHERE stage_status != UPPER(stage_status);
UPDATE project_stage_requirements SET status = UPPER(status) WHERE status != UPPER(status);
UPDATE project_stage_exceptions SET status = UPPER(status) WHERE status != UPPER(status);
UPDATE project_stage_dependencies SET status = UPPER(status) WHERE status != UPPER(status);
COMMIT;
```

---

## MIGRATION 2: MIGRATE `isActive` BOOLEAN TO `deletedAt` TIMESTAMP

### Problem
23 tables use `isActive: boolean` for soft deletes. 18 of them ALSO have a `deletedAt` column already, creating a dual-pattern inconsistency. The canonical pattern is `deletedAt IS NULL` = active.

### Step 2A: Backfill `deletedAt` from `isActive` where both columns exist

For the 18 tables that have BOTH columns, set `deletedAt` for inactive records:

```sql
BEGIN;

-- users
UPDATE users SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- organizations
UPDATE organizations SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- eng_stage_templates
UPDATE eng_stage_templates SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- qc_template
UPDATE qc_template SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- template_overrides
UPDATE template_overrides SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- stage_definitions
UPDATE stage_definitions SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- stage_checklist_templates
UPDATE stage_checklist_templates SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- sp_files
UPDATE sp_files SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- intake_task_templates
UPDATE intake_task_templates SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- project_execution_state
UPDATE project_execution_state SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- phase_template
UPDATE phase_template SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- stage_gate_definitions
UPDATE stage_gate_definitions SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- stage_gate_overrides
UPDATE stage_gate_overrides SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- derived_project_kpis
UPDATE derived_project_kpis SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- working_plan_scenario
UPDATE working_plan_scenario SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- counterparties
UPDATE counterparties SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- counterparty_contacts
UPDATE counterparty_contacts SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- invoice_pattern_rules
UPDATE invoice_pattern_rules SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

-- financial_integration_rules
UPDATE financial_integration_rules SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;

COMMIT;
```

### Step 2B: Add `deletedAt` to tables that don't have it yet

For the 5 tables with `isActive` but NO `deletedAt`:

```sql
BEGIN;

ALTER TABLE commissioning_sources ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE commissioning_sources ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
UPDATE commissioning_sources SET deleted_at = NOW() WHERE is_active = false;

ALTER TABLE lens_simulation_sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE lens_simulation_sessions ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
UPDATE lens_simulation_sessions SET deleted_at = NOW() WHERE is_active = false;

COMMIT;
```

> **Note:** The `isActive` columns should NOT be dropped yet. Keep them for a 30-day observation period. After the application code has been updated to use `deletedAt IS NULL` everywhere, and 30 days have passed with no issues, run Step 2C.

### Step 2C: Drop `isActive` columns (AFTER 30-day observation)

```sql
-- DO NOT RUN THIS UNTIL 30 DAYS AFTER STEP 2A/2B
-- AND the application code has been updated
BEGIN;
ALTER TABLE users DROP COLUMN IF EXISTS is_active;
ALTER TABLE organizations DROP COLUMN IF EXISTS is_active;
ALTER TABLE eng_stage_templates DROP COLUMN IF EXISTS is_active;
ALTER TABLE qc_template DROP COLUMN IF EXISTS is_active;
ALTER TABLE template_overrides DROP COLUMN IF EXISTS is_active;
ALTER TABLE stage_definitions DROP COLUMN IF EXISTS is_active;
ALTER TABLE stage_checklist_templates DROP COLUMN IF EXISTS is_active;
ALTER TABLE sp_files DROP COLUMN IF EXISTS is_active;
ALTER TABLE intake_task_templates DROP COLUMN IF EXISTS is_active;
ALTER TABLE project_execution_state DROP COLUMN IF EXISTS is_active;
ALTER TABLE phase_template DROP COLUMN IF EXISTS is_active;
ALTER TABLE stage_gate_definitions DROP COLUMN IF EXISTS is_active;
ALTER TABLE stage_gate_overrides DROP COLUMN IF EXISTS is_active;
ALTER TABLE derived_project_kpis DROP COLUMN IF EXISTS is_active;
ALTER TABLE working_plan_scenario DROP COLUMN IF EXISTS is_active;
ALTER TABLE counterparties DROP COLUMN IF EXISTS is_active;
ALTER TABLE counterparty_contacts DROP COLUMN IF EXISTS is_active;
ALTER TABLE invoice_pattern_rules DROP COLUMN IF EXISTS is_active;
ALTER TABLE financial_integration_rules DROP COLUMN IF EXISTS is_active;
ALTER TABLE commissioning_sources DROP COLUMN IF EXISTS is_active;
ALTER TABLE lens_simulation_sessions DROP COLUMN IF EXISTS is_active;
COMMIT;
```

---

## MIGRATION 3: DROP DEPRECATED `projectName` TEXT COLUMNS

### Problem
40+ tables have a deprecated `projectName` text column alongside a canonical `projectId` foreign key. The text column is a denormalized relic that can become stale. All application code has been migrated to use `projectId`.

### Step 3A: Verify no NULL projectId values

Before dropping `projectName`, verify every row has a valid `projectId`:

```sql
-- Run for each table. If any return rows, backfill projectId first.
SELECT COUNT(*) AS orphans FROM program_expense WHERE project_id IS NULL AND project_name IS NOT NULL;
SELECT COUNT(*) AS orphans FROM program_inflows WHERE project_id IS NULL AND project_name IS NOT NULL;
SELECT COUNT(*) AS orphans FROM project_plan WHERE project_id IS NULL AND project_name IS NOT NULL;
SELECT COUNT(*) AS orphans FROM cashflow_points WHERE project_id IS NULL AND project_name IS NOT NULL;
SELECT COUNT(*) AS orphans FROM finance_revenue_monthly WHERE project_id IS NULL AND project_name IS NOT NULL;
SELECT COUNT(*) AS orphans FROM finance_cos_monthly WHERE project_id IS NULL AND project_name IS NOT NULL;
SELECT COUNT(*) AS orphans FROM working_plan_scenario WHERE project_id IS NULL AND project_name IS NOT NULL;
SELECT COUNT(*) AS orphans FROM project_plan_dependency WHERE project_id IS NULL AND project_name IS NOT NULL;
SELECT COUNT(*) AS orphans FROM schedule_change_notice WHERE project_id IS NULL AND project_name IS NOT NULL;
SELECT COUNT(*) AS orphans FROM deliverables WHERE project_id IS NULL AND project_name IS NOT NULL;
SELECT COUNT(*) AS orphans FROM smart_import_runs WHERE project_id IS NULL AND project_name IS NOT NULL;
SELECT COUNT(*) AS orphans FROM normalized_plan_tasks WHERE project_id IS NULL AND project_name IS NOT NULL;
SELECT COUNT(*) AS orphans FROM weekly_reviews WHERE project_id IS NULL AND project_name IS NOT NULL;
SELECT COUNT(*) AS orphans FROM qc_checklist WHERE project_id IS NULL AND project_name IS NOT NULL;
SELECT COUNT(*) AS orphans FROM notifications WHERE project_id IS NULL AND project_name IS NOT NULL;
```

If ANY of these return > 0, backfill first:
```sql
-- Example backfill (adapt per table)
UPDATE program_expense pe
SET project_id = pi.id
FROM project_info pi
WHERE pe.project_name = pi.project_name
  AND pe.project_id IS NULL;
```

### Step 3B: Drop `projectName` columns (AFTER verification)

```sql
-- Only run after Step 3A confirms zero orphans
BEGIN;
ALTER TABLE program_expense DROP COLUMN IF EXISTS project_name;
ALTER TABLE program_inflows DROP COLUMN IF EXISTS project_name;
ALTER TABLE project_plan DROP COLUMN IF EXISTS project_name;
ALTER TABLE cashflow_points DROP COLUMN IF EXISTS project_name;
ALTER TABLE finance_revenue_monthly DROP COLUMN IF EXISTS project_name;
ALTER TABLE finance_cos_monthly DROP COLUMN IF EXISTS project_name;
ALTER TABLE working_plan_scenario DROP COLUMN IF EXISTS project_name;
ALTER TABLE project_plan_dependency DROP COLUMN IF EXISTS project_name;
ALTER TABLE schedule_change_notice DROP COLUMN IF EXISTS project_name;
ALTER TABLE deliverables DROP COLUMN IF EXISTS project_name;
ALTER TABLE smart_import_runs DROP COLUMN IF EXISTS project_name;
ALTER TABLE issue_resolution_rules DROP COLUMN IF EXISTS project_name;
ALTER TABLE normalized_plan_tasks DROP COLUMN IF EXISTS project_name;
ALTER TABLE normalized_revenue_lines DROP COLUMN IF EXISTS project_name;
ALTER TABLE normalized_cost_lines DROP COLUMN IF EXISTS project_name;
ALTER TABLE plan_edit_notifications DROP COLUMN IF EXISTS project_name;
ALTER TABLE weekly_reviews DROP COLUMN IF EXISTS project_name;
ALTER TABLE milestone_task_links DROP COLUMN IF EXISTS project_name;
ALTER TABLE expense_task_links DROP COLUMN IF EXISTS project_name;
ALTER TABLE writeback_mappings DROP COLUMN IF EXISTS project_name;
ALTER TABLE financial_edit_requests DROP COLUMN IF EXISTS project_name;
ALTER TABLE financial_integration_rules DROP COLUMN IF EXISTS project_name;
ALTER TABLE notifications DROP COLUMN IF EXISTS project_name;
ALTER TABLE qc_checklist DROP COLUMN IF EXISTS project_name;
ALTER TABLE qc_plan_link DROP COLUMN IF EXISTS project_name;
ALTER TABLE qc_warning DROP COLUMN IF EXISTS project_name;
ALTER TABLE qc_postmortem DROP COLUMN IF EXISTS project_name;
ALTER TABLE fye_revenue_tracking DROP COLUMN IF EXISTS project_name;
ALTER TABLE fye_revenue_line_items DROP COLUMN IF EXISTS project_name;
COMMIT;
```

---

## MIGRATION 4: DROP LEGACY TEXT COLUMNS IN FINANCE

### Problem
The `normalized_revenue_lines` and `normalized_cost_lines` tables have legacy TEXT columns (`amount_ex_vat_legacy`, `vat_legacy`) that were preserved for a 30-day rollback window after migration to decimal columns. The rollback window has passed.

### Step 4A: Verify decimal columns are populated

```sql
SELECT COUNT(*) AS total,
       COUNT(amount_ex_vat) AS has_decimal,
       COUNT(amount_ex_vat_legacy) AS has_legacy
FROM normalized_revenue_lines;

SELECT COUNT(*) AS total,
       COUNT(amount_ex_vat) AS has_decimal,
       COUNT(amount_ex_vat_legacy) AS has_legacy
FROM normalized_cost_lines;
```

### Step 4B: Drop legacy columns

```sql
BEGIN;
ALTER TABLE normalized_revenue_lines DROP COLUMN IF EXISTS amount_ex_vat_legacy;
ALTER TABLE normalized_revenue_lines DROP COLUMN IF EXISTS vat_legacy;
ALTER TABLE normalized_cost_lines DROP COLUMN IF EXISTS amount_ex_vat_legacy;
COMMIT;
```

---

## MIGRATION 5: DROP DEPRECATED TABLES

### Problem
Two tables were deprecated on 2026-03-31 with a 90-day drop window (expires 2026-06-29). Additionally, several legacy tables have been archived.

### Step 5A: Verify zero reads/writes on deprecated tables

```sql
-- Check if these tables have any recent writes (created_at or updated_at in last 30 days)
SELECT MAX(created_at) AS last_created, MAX(updated_at) AS last_updated FROM client_commitments;
SELECT MAX(created_at) AS last_created, MAX(updated_at) AS last_updated FROM client_updates;
```

### Step 5B: Archive and drop (only if Step 5A shows no recent activity)

```sql
BEGIN;
-- Archive first
ALTER TABLE client_commitments RENAME TO _client_commitments_legacy_archive;
ALTER TABLE client_updates RENAME TO _client_updates_legacy_archive;
COMMIT;

-- After 7 days with no issues, DROP:
-- DROP TABLE IF EXISTS _client_commitments_legacy_archive;
-- DROP TABLE IF EXISTS _client_updates_legacy_archive;
```

### Step 5C: Legacy tables pending archive (via admin migration endpoints)

Use `GET /api/admin/migration/status` to check these:
- `normalized_plan_tasks`
- `mytool_tasks`
- `tasks`
- `intake_tasks`
- `project_eng_tasks`

For each, verify data has been migrated to `work_items` (via `legacy_table` + `legacy_id` linkage), then archive:

```sql
-- Example for mytool_tasks
SELECT COUNT(*) FROM mytool_tasks;
SELECT COUNT(*) FROM work_items WHERE legacy_table = 'mytool_tasks';
-- If counts match (or work_items count >= mytool_tasks count):
ALTER TABLE mytool_tasks RENAME TO _mytool_tasks_legacy_archive;
```

---

## MIGRATION 6: ADD MISSING INDEXES

### Problem
Only 44 index definitions exist across 100+ tables. Status-filtered queries on large tables may be slow.

### Step 6A: Add indexes on frequently queried status columns

```sql
-- Work items (most queried table)
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_workstream ON work_items (workstream) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_priority ON work_items (priority) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_bucket ON work_items (bucket) WHERE deleted_at IS NULL;

-- Stage instances
CREATE INDEX IF NOT EXISTS idx_stage_instances_status ON project_stage_instances (stage_status);
CREATE INDEX IF NOT EXISTS idx_stage_instances_project ON project_stage_instances (project_id);

-- Deliverables
CREATE INDEX IF NOT EXISTS idx_deliverables_status ON deliverables (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deliverables_project ON deliverables (project_id) WHERE deleted_at IS NULL;

-- Approvals
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals (status);
CREATE INDEX IF NOT EXISTS idx_approvals_project ON approvals (project_id);

-- Finance
CREATE INDEX IF NOT EXISTS idx_revenue_lines_status ON normalized_revenue_lines (status);
CREATE INDEX IF NOT EXISTS idx_revenue_lines_project ON normalized_revenue_lines (project_id);
CREATE INDEX IF NOT EXISTS idx_cost_lines_status ON normalized_cost_lines (status);
CREATE INDEX IF NOT EXISTS idx_cost_lines_project ON normalized_cost_lines (project_id);

-- Procurement
CREATE INDEX IF NOT EXISTS idx_procurements_status ON procurements (status);
CREATE INDEX IF NOT EXISTS idx_procurements_payment ON procurements (payment_status);

-- Purchase orders
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders (status);

-- Payment requests
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests (status);

-- Commissioning
CREATE INDEX IF NOT EXISTS idx_commissioning_status ON commissioning_items (status);
CREATE INDEX IF NOT EXISTS idx_commissioning_project ON commissioning_items (project_id);

-- Handover
CREATE INDEX IF NOT EXISTS idx_handover_packs_status ON handover_packs (status);
CREATE INDEX IF NOT EXISTS idx_handover_packs_project ON handover_packs (project_id);

-- Change requests
CREATE INDEX IF NOT EXISTS idx_change_requests_status ON change_requests (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_change_requests_project ON change_requests (project_id) WHERE deleted_at IS NULL;

-- RAIDs
CREATE INDEX IF NOT EXISTS idx_raids_status ON raids (status);
CREATE INDEX IF NOT EXISTS idx_raids_project ON raids (project_id);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications (recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications (read_at) WHERE read_at IS NULL;

-- Audit events
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_user ON audit_events (user_id);
```

---

## MIGRATION 7: CLEAN UP `legacyTable` / `legacyId` REFERENCES

### Problem
`work_items` has `legacy_table` and `legacy_id` columns used during data consolidation. Once all legacy tables are dropped, these columns serve no purpose.

### Step 7A: Verify legacy tables are all archived/dropped

```sql
-- Check if any legacy source tables still exist
SELECT tablename FROM pg_tables WHERE tablename IN (
  'operational_tasks', 'engineering_tasks', 'mytool_tasks',
  'tasks', 'intake_tasks', 'project_eng_tasks'
);
```

If this returns zero rows, the legacy tables are gone and these columns can be dropped.

### Step 7B: Drop legacy linkage columns (AFTER Step 7A confirms zero tables)

```sql
BEGIN;
ALTER TABLE work_items DROP COLUMN IF EXISTS legacy_table;
ALTER TABLE work_items DROP COLUMN IF EXISTS legacy_id;
ALTER TABLE work_item_audit_log DROP COLUMN IF EXISTS legacy_table;
ALTER TABLE work_item_audit_log DROP COLUMN IF EXISTS legacy_id;
COMMIT;
```

---

## EXECUTION ORDER

Run these migrations in this order, with verification between each:

| Order | Migration | Risk | Reversible | Estimated Rows Affected |
|-------|-----------|------|------------|------------------------|
| 1 | **Status casing audit** (1A-1B) | None (read-only) | N/A | 0 |
| 2 | **Status normalization** (1C-1E) | Medium | Yes (restore from backup) | Depends on audit |
| 3 | **isActive backfill** (2A-2B) | Low | Yes (restore isActive from deletedAt IS NOT NULL) | ~100-500 rows |
| 4 | **Missing indexes** (6A) | None | Yes (DROP INDEX) | 0 (schema only) |
| 5 | **Verify projectId backfill** (3A) | None (read-only) | N/A | 0 |
| 6 | **Drop projectName columns** (3B) | Medium | No (requires backup) | 0 (schema only) |
| 7 | **Drop legacy finance columns** (4) | Low | No (requires backup) | 0 (schema only) |
| 8 | **Drop deprecated tables** (5) | Low | No (requires backup) | 0 (schema only) |
| 9 | **isActive column drop** (2C) | Low | No (requires backup) | 0 (after 30-day wait) |
| 10 | **Legacy linkage cleanup** (7) | Low | No (requires backup) | 0 (after legacy table drop) |

---

## VERIFICATION QUERIES

After ALL migrations, run these to confirm the database is clean:

```sql
-- No invalid status values in work_items
SELECT status FROM work_items WHERE status NOT IN (
  'to_do', 'in_progress', 'hold', 'projects_assistance',
  'needs_approval', 'qc_approved', 'provide_feedback',
  'operational_approval', 'complete'
) AND deleted_at IS NULL;
-- Expected: 0 rows

-- No dual isActive/deletedAt inconsistency
SELECT COUNT(*) FROM users WHERE is_active = false AND deleted_at IS NULL;
-- Expected: 0 rows (after backfill)

-- No orphan projectName without projectId
SELECT 'program_expense' AS tbl, COUNT(*) FROM program_expense WHERE project_id IS NULL
UNION ALL
SELECT 'deliverables', COUNT(*) FROM deliverables WHERE project_id IS NULL
UNION ALL
SELECT 'notifications', COUNT(*) FROM notifications WHERE project_id IS NULL;
-- Expected: 0 for each

-- All projects have 10 stage instances
SELECT pi.id, pi.project_name, COUNT(psi.id) AS stage_count
FROM project_info pi
LEFT JOIN project_stage_instances psi ON psi.project_id = pi.id
GROUP BY pi.id, pi.project_name
HAVING COUNT(psi.id) != 10;
-- Expected: 0 rows
```

---

## COORDINATION WITH APPLICATION CODE

**These migrations require simultaneous code changes:**

| Migration | Code Change Required | Files Affected |
|-----------|---------------------|----------------|
| Status normalization (1C-1E) | Update `TASK_STATUSES` constant to lowercase, update all status comparisons in routes and front-end | `shared/schema/tasks.ts`, `shared/constants/statuses.ts`, `client/src/lib/status-colors.ts`, all route files that compare statuses |
| isActive backfill (2A) | Update all queries from `is_active = true` to `deleted_at IS NULL` | 23 files across server/ |
| Drop projectName (3B) | Remove all `projectName` references from queries and response mappers | 40+ files across server/ and shared/ |

**Deploy sequence:**
1. Deploy code that handles BOTH old and new values (dual-read)
2. Run database migration
3. Deploy code that uses ONLY new values (remove dual-read)

This ensures zero downtime during the migration.
