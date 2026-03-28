# Override Table Collapse — Resolution Report

> Generated: 2026-03-30 | Override tables: 7 | Base tables: 6

## Strategy

**Problem:** 7 override tables store user edits in separate rows, requiring merge-on-read at query time. This adds complexity to every read path and makes the data model harder to reason about.

**Solution:** Collapse overrides into the base tables by:
1. Adding `source`, `import_snapshot`, `last_edited_by`, `last_edited_at` to each base table
2. Backfilling override data into the base rows (snapshot original → apply override)
3. Marking override tables as deprecated (not dropped yet)

**Rollback:** Base rows can be restored from `import_snapshot` JSONB. Override tables remain intact.

---

## Override → Base Table Mapping

| Override Table | Base Table | Match Key | Override Style |
|---------------|------------|-----------|---------------|
| `expenditure_overrides` | `program_expense` | `projectName` + `rowNumber` | Field-level (fieldName → overrideValue) |
| `revenue_tracking_overrides` | `program_inflows` | `projectName` + `rowNumber` | Field-level (fieldName → overrideValue) |
| `cashflow_planning_overrides` | `cashflow_points` | `projectName` + `weekStartDate` + `seriesName` | Value-level (overrideValue replaces value) |
| `cos_status_overrides` | `program_expense` | `expenseId` or `projectName` + `rowNumber` | Status-level (overrideStatus replaces lineStatus) |
| `finance_revenue_overrides` | `finance_revenue_monthly` | `projectName` + `category` + `monthEndDate` | Value-level (overrideValue replaces value) |
| `finance_cos_overrides` | `finance_cos_monthly` | `projectName` + `category` + `monthEndDate` | Value-level (overrideValue replaces value) |
| `project_plan_overrides` | `project_plan` | `projectName` + `rowNumber` | Field-level (fieldName → overrideValue) |

---

## New Columns Added to Base Tables

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `source` | `row_source` ENUM | `'imported'` | Tracks data origin: `imported`, `manual`, `imported_edited` |
| `import_snapshot` | `JSONB` | `NULL` | Stores original imported values before user edit |
| `last_edited_by` | `INTEGER` (FK → users) | `NULL` | User who last edited this row |
| `last_edited_at` | `TIMESTAMP` | `NULL` | When the row was last edited |

Tables receiving these columns:
- `program_expense`
- `program_inflows`
- `cashflow_points`
- `finance_revenue_monthly`
- `finance_cos_monthly`
- `project_plan`

---

## Backfill Logic

### Field-Level Overrides (expenditure, revenue_tracking, project_plan)

These override tables use `fieldName` + `overrideValue` to override individual columns:
1. Group overrides by `(projectName, rowNumber)`
2. Find matching base row
3. Snapshot ALL base row columns into `import_snapshot`
4. Apply each override field onto the base row (camelCase → snake_case)
5. Set `source = 'imported_edited'`

### Value-Level Overrides (cashflow, finance_revenue, finance_cos)

These override tables replace a single `value` column:
1. Find matching base row by composite key
2. Snapshot `{ value: originalValue }` into `import_snapshot`
3. Set `value = overrideValue`
4. Set `source = 'imported_edited'`

### Status-Level Override (cos_status)

Special case — overrides `line_status` on `program_expense`:
1. Find base row by `expenseId` (direct FK) or `projectName + rowNumber`
2. Snapshot `line_status` into `import_snapshot` (merges with existing snapshot if expenditure_overrides already applied)
3. Set `line_status = overrideStatus`

---

## Conflict Resolution

| Scenario | Count | Action |
|----------|-------|--------|
| 1 matching base row | Counted per backfill | Override applied, base row updated |
| 0 matching base rows (orphan) | Logged | Saved to `override_migration_orphans` |
| 2+ matching base rows (ambiguous) | Logged | Saved to `override_migration_ambiguous` |
| Already migrated (idempotent) | Skipped | `import_snapshot IS NOT NULL` → skip |

---

## Merge-on-Read Consumers (to be updated in Prompt 4)

| File | Usage |
|------|-------|
| `server/routes.ts` | 6+ endpoints with `?applyOverrides=true` flag |
| `server/departments/finance-routes.ts` | 6+ endpoints with override merge |
| `server/departments/project-routes.ts` | 2 endpoints with override merge |
| `server/lib/calculations/scenarioResolver.ts` | `buildOverrideMap()`, `applyOverridesToCashflowLines()`, `applyOverridesToCOSLines()` |
| `server/cpmEngine.ts` | `applyOverridesToTasks()`, `applyOverridesToDependencies()` |

After backfill, these consumers can be simplified to read directly from base tables (source = 'imported_edited' rows already have overrides applied).

---

## Files Modified / Created

### Schema
- `shared/schema/finance.ts` — Added `source`, `importSnapshot`, `lastEditedBy`, `lastEditedAt` to 6 base tables; added `overrideMigrationOrphans`, `overrideMigrationAmbiguous` tracking tables; added `rowSourceEnum`; marked 7 override tables as deprecated

### Migrations
- `migrations/20260330_collapse_override_tables.sql` — DDL: add columns, create enum, create tracking tables, add indexes
- `migrations/20260330_collapse_override_tables_rollback.sql` — Rollback: restore from snapshots, drop columns/tables/enum

### Scripts
- `scripts/backfill-collapse-overrides.ts` — Consolidated backfill (7 override tables → 6 base tables)
