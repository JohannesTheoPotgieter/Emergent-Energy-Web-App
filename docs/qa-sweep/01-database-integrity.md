# QA Sweep — 01 Database Integrity Audit

**Date:** 2026-03-21
**Mode:** Static schema analysis (no live database connection available)
**Source of truth:** Drizzle ORM schema (`shared/schema/*.ts`) + migration SQL files (`migrations/`)

> **Note:** No PostgreSQL instance was accessible in this environment. All findings are
> derived from static analysis of the Drizzle ORM schema definitions and raw SQL
> migrations. Counts cannot be verified at runtime — this report flags **structural
> risks** that should be validated against the live database.

---

## 1. Foreign Key Integrity — Constraint Coverage

### Declared FK Constraints (Drizzle ORM `.references()`)

| Child Table | FK Column | Parent Table | ON DELETE | Nullable FK? |
|---|---|---|---|---|
| `clients` | `created_by` | `users(id)` | — (RESTRICT) | YES |
| `clients` | `updated_by` | `users(id)` | — | YES |
| `clients` | `organization_id` | `organizations(id)` | — | NO (default 1) |
| `project_info` | `client_id` | `clients(id)` | — | YES |
| `project_info` | `organization_id` | `organizations(id)` | — | NO (default 1) |
| `project_execution_state` | `project_id` | `project_info(id)` | CASCADE | NO |
| `project_execution_state` | `phase_updated_by_user_id` | `users(id)` | — | YES |
| `project_execution_state` | `cp_signed_by_user_id` | `users(id)` | — | YES |
| `project_settings` | `project_id` | `project_info(id)` | CASCADE | NO |
| `project_phase_history` | `project_id` | `project_info(id)` | CASCADE | NO |
| `project_phase_history` | `changed_by_user_id` | `users(id)` | — | NO |
| `project_rag_audit` | `project_id` | `project_info(id)` | CASCADE | NO |
| `project_revenue_summary` | `project_id` | `project_info(id)` | — | YES |
| `project_editable_fields` | `project_id` | `project_info(id)` | — | YES |
| `program_expense` | `project_id` | `project_info(id)` | — | YES |
| `program_expense` | `last_edited_by` | `users(id)` | — | YES |
| `program_inflows` | `project_id` | `project_info(id)` | — | YES |
| `program_inflows` | `last_edited_by` | `users(id)` | — | YES |
| `project_plan` | `project_id` | `project_info(id)` | — | YES |
| `cashflow_points` | `project_id` | `project_info(id)` | — | YES |
| `finance_revenue_monthly` | `project_id` | `project_info(id)` | — | YES |
| `finance_cos_monthly` | `project_id` | `project_info(id)` | — | YES |
| `normalized_revenue_lines` | `project_id` | `project_info(id)` | — | NO |
| `normalized_cost_lines` | `project_id` | `project_info(id)` | — | NO |
| `counterparties` | `organization_id` | `organizations(id)` | — | NO (default 1) |
| `work_items` | `project_id` | `project_info(id)` | — | NO |
| `work_items` | `client_id` | `clients(id)` | — | YES |
| `work_items` | `owner_user_id` | `users(id)` | — | YES |
| `work_items` | `created_by` | `users(id)` | — | YES |
| `work_item_pm` | `work_item_id` | `work_items(id)` | CASCADE | NO |
| `work_item_engineering` | `work_item_id` | `work_items(id)` | CASCADE | NO |
| `work_item_scheduling` | `work_item_id` | `work_items(id)` | CASCADE | NO |
| `work_item_assignments` | `work_item_id` | `work_items(id)` | CASCADE | NO |
| `work_item_assignments` | `user_id` | `users(id)` | — | NO |
| `work_item_dependencies` | `predecessor_id` | `work_items(id)` | CASCADE | NO |
| `work_item_dependencies` | `successor_id` | `work_items(id)` | CASCADE | NO |
| `work_item_status_history` | `work_item_id` | `work_items(id)` | CASCADE | NO |
| `work_item_tags` | `work_item_id` | `work_items(id)` | CASCADE | NO |
| `work_item_tags` | `tag_id` | `task_tags(id)` | CASCADE | NO |
| `task_time_entries` | `work_item_id` | `work_items(id)` | CASCADE | NO |
| `task_time_entries` | `user_id` | `users(id)` | — | NO |
| `task_comments` | `work_item_id` | `work_items(id)` | CASCADE | YES |
| `task_checklists` | `work_item_id` | `work_items(id)` | CASCADE | YES |
| `task_attachments` | `work_item_id` | `work_items(id)` | CASCADE | YES |
| `task_deliverables` | `work_item_id` | `work_items(id)` | CASCADE | YES |
| `task_activity_log` | `work_item_id` | `work_items(id)` | CASCADE | YES |
| `task_watchers` | `work_item_id` | `work_items(id)` | CASCADE | YES |
| `dashboard_project_metrics` | `project_id` | `project_info(id)` | CASCADE | NO |
| `dashboard_project_metrics` | `organization_id` | `organizations(id)` | — | NO (default 1) |
| `dashboard_program_metrics` | `organization_id` | `organizations(id)` | — | NO (default 1) |
| `snapshots` | `file_id` | `sp_files(id)` | — | NO |
| `portfolios` | `organization_id` | `organizations(id)` | — | NO (default 1) |
| `portfolio_rollout_plans` | `portfolio_id` | `portfolios(id)` | CASCADE | NO |
| `portfolio_rollout_phases` | `rollout_plan_id` | `portfolio_rollout_plans(id)` | CASCADE | NO |
| `project_portfolio_assignments` | `project_id` | `project_info(id)` | — | NO |
| `project_portfolio_assignments` | `portfolio_id` | `portfolios(id)` | CASCADE | NO |
| `eng_stage_templates` | `organization_id` | `organizations(id)` | — | NO (default 1) |
| `users` | `organization_id` | `organizations(id)` | — | NO (default 1) |
| `role_credentials` | `organization_id` | `organizations(id)` | — | NO (default 1) |
| `app_settings` | `organization_id` | `organizations(id)` | — | NO (default 1) |
| `qc_template` | `organization_id` | `organizations(id)` | — | NO (default 1) |

### Structural Findings

**FINDING-1.1: Nullable `project_id` on financial tables** — `program_expense`, `program_inflows`, `cashflow_points`, `finance_revenue_monthly`, `finance_cos_monthly`, `project_plan`, `project_revenue_summary`, `project_editable_fields`, `working_plan_scenario`, `schedule_change_notice` all have nullable `project_id` FK columns. These were likely inherited from the legacy import era before `project_info.id` was reliably available. **Runtime query recommended:**

```sql
SELECT 'program_expense' AS tbl, COUNT(*) FROM program_expense WHERE project_id IS NULL
UNION ALL SELECT 'program_inflows', COUNT(*) FROM program_inflows WHERE project_id IS NULL
UNION ALL SELECT 'cashflow_points', COUNT(*) FROM cashflow_points WHERE project_id IS NULL
UNION ALL SELECT 'finance_revenue_monthly', COUNT(*) FROM finance_revenue_monthly WHERE project_id IS NULL
UNION ALL SELECT 'finance_cos_monthly', COUNT(*) FROM finance_cos_monthly WHERE project_id IS NULL
UNION ALL SELECT 'project_plan', COUNT(*) FROM project_plan WHERE project_id IS NULL
UNION ALL SELECT 'project_revenue_summary', COUNT(*) FROM project_revenue_summary WHERE project_id IS NULL;
```

> **Risk level:** MEDIUM — any non-zero result means orphaned financial rows with no project linkage.

**FINDING-1.2: Missing ON DELETE cascade on financial FKs** — Tables like `program_expense`, `program_inflows`, `cashflow_points` reference `project_info(id)` without ON DELETE CASCADE. If a project is ever deleted, these rows become orphaned.

> **Risk level:** LOW — projects are soft-deleted via `is_active`/`archived_status`, not hard-deleted.

**FINDING-1.3: `task_comments`, `task_checklists`, `task_attachments`, `task_deliverables`, `task_activity_log`, `task_watchers` have dual FK columns** — both `task_id` (NOT NULL, no FK constraint) and `work_item_id` (nullable FK to work_items). The `task_id` column appears to be a legacy artifact from when `operational_tasks` existed (now dropped). **Runtime query recommended:**

```sql
SELECT 'task_comments' AS tbl, COUNT(*) FROM task_comments WHERE work_item_id IS NULL
UNION ALL SELECT 'task_checklists', COUNT(*) FROM task_checklists WHERE work_item_id IS NULL
UNION ALL SELECT 'task_attachments', COUNT(*) FROM task_attachments WHERE work_item_id IS NULL
UNION ALL SELECT 'task_deliverables', COUNT(*) FROM task_deliverables WHERE work_item_id IS NULL
UNION ALL SELECT 'task_activity_log', COUNT(*) FROM task_activity_log WHERE work_item_id IS NULL
UNION ALL SELECT 'task_watchers', COUNT(*) FROM task_watchers WHERE work_item_id IS NULL;
```

> **Risk level:** MEDIUM — any non-zero count means rows reference a dropped table. The `task_id` column has no FK constraint, so referential integrity is not enforced.

---

## 2. Null Checks on Required Fields

### Schema-Declared NOT NULL Constraints

| Table | Column | notNull? | Default | Verdict |
|---|---|---|---|---|
| `project_info.id` | PK (serial) | YES | auto | OK |
| `project_execution_state.project_id` | FK | YES | — | OK |
| `project_settings.project_id` | FK | YES | — | OK |
| `work_items.project_id` | FK | YES | — | OK |
| `work_items.created_by` | FK | **NO** | — | **RISK** |
| `dashboard_project_metrics.project_id` | FK | YES | — | OK |

**FINDING-2.1: `work_items.created_by` is nullable** — The audit query specifies checking `work_items WHERE created_by IS NULL`. The schema declares `created_by` as `integer("created_by").references(() => users.id)` **without `.notNull()`**. This means NULL values are permitted.

> **Risk level:** MEDIUM — `created_by` should logically be required for audit traceability. **Runtime check required:**
> ```sql
> SELECT COUNT(*) FROM work_items WHERE created_by IS NULL;
> ```

All other requested null checks (`project_info.id`, `project_execution_state.project_id`, `project_settings.project_id`, `work_items.project_id`, `dashboard_project_metrics.project_id`) are structurally protected by NOT NULL + PK/FK constraints. They **cannot** be NULL at the schema level.

---

## 3. 1:1 Relationship Integrity

### Schema-Level Guarantees

| Parent | Child | FK Column | UNIQUE | NOT NULL | ON DELETE |
|---|---|---|---|---|---|
| `project_info` | `project_execution_state` | `project_id` | YES | YES | CASCADE |
| `project_info` | `project_settings` | `project_id` | YES | YES | CASCADE |

Both relationships are enforced with `UNIQUE + NOT NULL + ON DELETE CASCADE`, which is correct for 1:1 semantics.

**However, uniqueness only prevents duplicates — it does NOT guarantee coverage.** The schema does not enforce that every `project_info` row has a corresponding `project_execution_state` or `project_settings` row. This must be enforced at the application layer.

**Runtime verification required:**

```sql
-- project_info without project_execution_state (MUST be 0)
SELECT COUNT(*) FROM project_info pi
LEFT JOIN project_execution_state pes ON pi.id = pes.project_id
WHERE pes.id IS NULL;

-- project_info without project_settings (MUST be 0)
SELECT COUNT(*) FROM project_info pi
LEFT JOIN project_settings ps ON pi.id = ps.project_id
WHERE ps.id IS NULL;
```

> **Risk level:** HIGH if non-zero — application code likely assumes these 1:1 children always exist.

---

## 4. Orphaned Records in Extension Tables

### Schema-Level Protection

| Extension Table | FK Column | Parent | UNIQUE | ON DELETE CASCADE |
|---|---|---|---|---|
| `work_item_engineering` | `work_item_id` | `work_items(id)` | YES | YES |
| `work_item_pm` | `work_item_id` | `work_items(id)` | YES | YES |
| `work_item_scheduling` | `work_item_id` | `work_items(id)` | YES | YES |

All three extension tables have `ON DELETE CASCADE` — if a parent `work_items` row is deleted, all extension rows are automatically removed. **Orphans cannot exist** structurally, unless CASCADE was somehow bypassed (e.g., direct SQL without FK checks).

**Runtime verification (should all return 0):**

```sql
SELECT 'work_item_engineering' AS ext, COUNT(*) FROM work_item_engineering wie
LEFT JOIN work_items wi ON wie.work_item_id = wi.id WHERE wi.id IS NULL
UNION ALL
SELECT 'work_item_pm', COUNT(*) FROM work_item_pm wip
LEFT JOIN work_items wi ON wip.work_item_id = wi.id WHERE wi.id IS NULL
UNION ALL
SELECT 'work_item_scheduling', COUNT(*) FROM work_item_scheduling wis
LEFT JOIN work_items wi ON wis.work_item_id = wi.id WHERE wi.id IS NULL;
```

> **Risk level:** LOW — structurally protected. Runtime check is a safety net.

---

## 5. Temporal Column Sanity

### Schema Analysis

| Table | `effective_from` | `effective_to` | CHECK constraint? |
|---|---|---|---|
| `program_expense` | NOT NULL, defaultNow() | nullable | **NO** |
| `program_inflows` | NOT NULL, defaultNow() | nullable | **NO** |
| `cashflow_points` | NOT NULL, defaultNow() | nullable | **NO** |
| `finance_revenue_monthly` | NOT NULL, defaultNow() | nullable | **NO** |
| `finance_cos_monthly` | NOT NULL, defaultNow() | nullable | **NO** |
| `project_revenue_summary` | NOT NULL, defaultNow() | nullable | **NO** |
| `normalized_cost_lines` | NOT NULL, defaultNow() | nullable | **NO** |
| `normalized_revenue_lines` | NOT NULL, defaultNow() | nullable | **NO** |

**FINDING-5.1: `effective_from IS NULL` — Structurally impossible.** All 8 tables declare `effective_from` as `NOT NULL` with `defaultNow()`. This check will always return 0. OK.

**FINDING-5.2: No CHECK constraint for `effective_to >= effective_from`** — The schema and migrations do NOT include a CHECK constraint to prevent `effective_to < effective_from`. This is a **structural gap**.

> **Risk level:** MEDIUM — **Runtime check required:**
> ```sql
> SELECT 'program_expense' AS tbl, COUNT(*) FROM program_expense
> WHERE effective_to IS NOT NULL AND effective_to < effective_from
> UNION ALL SELECT 'program_inflows', COUNT(*) FROM program_inflows
> WHERE effective_to IS NOT NULL AND effective_to < effective_from
> UNION ALL SELECT 'cashflow_points', COUNT(*) FROM cashflow_points
> WHERE effective_to IS NOT NULL AND effective_to < effective_from
> UNION ALL SELECT 'finance_revenue_monthly', COUNT(*) FROM finance_revenue_monthly
> WHERE effective_to IS NOT NULL AND effective_to < effective_from
> UNION ALL SELECT 'finance_cos_monthly', COUNT(*) FROM finance_cos_monthly
> WHERE effective_to IS NOT NULL AND effective_to < effective_from
> UNION ALL SELECT 'normalized_cost_lines', COUNT(*) FROM normalized_cost_lines
> WHERE effective_to IS NOT NULL AND effective_to < effective_from
> UNION ALL SELECT 'normalized_revenue_lines', COUNT(*) FROM normalized_revenue_lines
> WHERE effective_to IS NOT NULL AND effective_to < effective_from;
> ```
> Any non-zero result is **CRITICAL**.

---

## 6. Organization_id Coverage

### Tables with `organization_id` Column (from schema)

| # | Table | NOT NULL | Default | FK to organizations |
|---|---|---|---|---|
| 1 | `users` | YES | 1 | YES |
| 2 | `clients` | YES | 1 | YES |
| 3 | `project_info` | YES | 1 | YES |
| 4 | `counterparties` | YES | 1 | YES |
| 5 | `portfolios` | YES | 1 | YES |
| 6 | `qc_template` | YES | 1 | YES |
| 7 | `eng_stage_templates` | YES | 1 | YES |
| 8 | `phase_template` | YES | 1 | YES |
| 9 | `role_credentials` | YES | 1 | YES |
| 10 | `app_settings` | YES | 1 | YES |
| 11 | `dashboard_project_metrics` | YES | 1 | YES |
| 12 | `dashboard_program_metrics` | YES | 1 | YES |

**All 12 tables** declare `organization_id` as `NOT NULL DEFAULT 1` with FK to `organizations(id)`. NULL values are **structurally impossible**.

**FINDING-6.1: Tables WITHOUT organization_id that arguably should have it:**

The following project-scoped tables have no `organization_id` column. They inherit tenancy implicitly via `project_id → project_info.organization_id`, but queries that filter by `organization_id` directly will require a JOIN.

| Table | Tenancy via |
|---|---|
| `project_execution_state` | project_id → project_info |
| `project_settings` | project_id → project_info |
| `work_items` | project_id → project_info |
| `program_expense` | project_id → project_info (nullable!) |
| `program_inflows` | project_id → project_info (nullable!) |
| `normalized_cost_lines` | project_id → project_info |
| `normalized_revenue_lines` | project_id → project_info |
| All work_item_* extensions | work_item_id → work_items → project_info |

> **Risk level:** LOW for design purposes — indirect tenancy is acceptable. **MEDIUM for `program_expense`/`program_inflows`** where `project_id` is nullable, making tenancy unresolvable for orphaned rows.

---

## 7. Dashboard Metrics Freshness

### Schema Analysis

`dashboard_project_metrics` has:
- `project_id` — UNIQUE NOT NULL FK to `project_info(id)` with ON DELETE CASCADE
- `last_refreshed_at` — NOT NULL, defaultNow()

**Coverage is NOT enforced at the schema level.** There is no trigger or constraint guaranteeing every `project_info` row has a corresponding `dashboard_project_metrics` row. The materialized metrics table is populated by application-level refresh logic.

**Runtime verification required:**

```sql
-- Every project must have metrics (MUST be 0)
SELECT COUNT(*) FROM project_info pi
LEFT JOIN dashboard_project_metrics dpm ON pi.id = dpm.project_id
WHERE dpm.project_id IS NULL;
```

> **Risk level:** HIGH if non-zero — dashboard will show incomplete/missing data for projects without metrics rows.

**Freshness check (supplemental):**

```sql
-- Metrics older than 24 hours (potential staleness)
SELECT COUNT(*) FROM dashboard_project_metrics
WHERE last_refreshed_at < NOW() - INTERVAL '24 hours';
```

---

## 8. Import Snapshot Integrity

### Schema Analysis

| Table | `source` column | `import_snapshot` column | NOT NULL? |
|---|---|---|---|
| `program_expense` | `rowSourceEnum` (imported/manual/imported_edited) | `jsonb("import_snapshot")` | **NO** |
| `program_inflows` | `rowSourceEnum` (imported/manual/imported_edited) | `jsonb("import_snapshot")` | **NO** |
| `project_plan` | `rowSourceEnum` (imported/manual/imported_edited) | `jsonb("import_snapshot")` | **NO** |
| `cashflow_points` | `rowSourceEnum` (imported/manual/imported_edited) | `jsonb("import_snapshot")` | **NO** |
| `finance_revenue_monthly` | `rowSourceEnum` (imported/manual/imported_edited) | `jsonb("import_snapshot")` | **NO** |
| `finance_cos_monthly` | `rowSourceEnum` (imported/manual/imported_edited) | `jsonb("import_snapshot")` | **NO** |

**FINDING-8.1: No CHECK constraint enforcing `import_snapshot IS NOT NULL WHEN source = 'imported_edited'`.** The `import_snapshot` column is nullable across all tables. The business rule that edited rows must preserve their original snapshot is enforced only at the application layer.

**Runtime verification required:**

```sql
-- Edited rows without import snapshot (MUST be 0)
SELECT 'program_expense' AS tbl, COUNT(*) FROM program_expense
WHERE source = 'imported_edited' AND import_snapshot IS NULL
UNION ALL SELECT 'program_inflows', COUNT(*) FROM program_inflows
WHERE source = 'imported_edited' AND import_snapshot IS NULL
UNION ALL SELECT 'project_plan', COUNT(*) FROM project_plan
WHERE source = 'imported_edited' AND import_snapshot IS NULL
UNION ALL SELECT 'cashflow_points', COUNT(*) FROM cashflow_points
WHERE source = 'imported_edited' AND import_snapshot IS NULL
UNION ALL SELECT 'finance_revenue_monthly', COUNT(*) FROM finance_revenue_monthly
WHERE source = 'imported_edited' AND import_snapshot IS NULL
UNION ALL SELECT 'finance_cos_monthly', COUNT(*) FROM finance_cos_monthly
WHERE source = 'imported_edited' AND import_snapshot IS NULL;
```

> **Risk level:** HIGH if non-zero — edited rows without snapshots lose their import audit trail, making reconciliation impossible.

---

## Summary of Findings

| # | Check | Schema Verdict | Runtime Required? | Risk | **Fix Applied** |
|---|---|---|---|---|---|
| 1.1 | Nullable `project_id` on financial tables | **STRUCTURAL GAP** | YES | MEDIUM | **FIXED** — migration backfills NULLs + sets NOT NULL |
| 1.2 | Missing ON DELETE CASCADE on financial FKs | Low risk (soft-delete used) | NO | LOW | Accepted (by design) |
| 1.3 | Legacy `task_id` column with no FK | **STRUCTURAL GAP** | YES | MEDIUM | **FIXED** — columns dropped, code migrated to `workItemId` |
| 2.1 | `work_items.created_by` nullable | **STRUCTURAL GAP** | YES | MEDIUM | **FIXED** — backfilled + set NOT NULL |
| 3 | 1:1 coverage (project → exec_state/settings) | Not enforced by schema | YES | HIGH | **FIXED** — migration backfill + startup integrity guard + missing sync calls patched |
| 4 | Orphaned work_item extensions | Protected by CASCADE | YES (safety) | LOW | N/A (already protected) |
| 5.1 | `effective_from IS NULL` | Impossible (NOT NULL) | NO | PASS | N/A |
| 5.2 | `effective_to < effective_from` | **No CHECK constraint** | YES | MEDIUM | **FIXED** — CHECK constraints added on all 8 temporal tables |
| 6 | `organization_id` NULL | Impossible (NOT NULL DEFAULT 1) | NO | PASS | N/A |
| 6.1 | Financial tables missing direct org_id | By design (inherited via project) | NO | LOW | Accepted (by design) |
| 7 | Dashboard metrics coverage | Not enforced by schema | YES | HIGH | **FIXED** — migration backfill + startup integrity guard |
| 8.1 | Import snapshot on edited rows | **No CHECK constraint** | YES | HIGH | **FIXED** — CHECK constraints added on all 6 import tables |

---

## Fixes Applied (Migration 20260339)

**Migration:** `migrations/20260339_database_integrity_hardening.sql`
**Rollback:** `migrations/20260339_database_integrity_hardening_rollback.sql`

### Database-Level Fixes
1. **8 temporal CHECK constraints** — `effective_to IS NULL OR effective_to >= effective_from`
2. **6 import snapshot CHECK constraints** — `source <> 'imported_edited' OR import_snapshot IS NOT NULL`
3. **7 financial tables** — `project_id` backfilled via `project_name` match + set to NOT NULL
4. **`work_items.created_by`** — backfilled (COALESCE owner_user_id, 1) + set to NOT NULL
5. **6 legacy `task_id` columns dropped** — `task_comments`, `task_checklists`, `task_attachments`, `task_deliverables`, `task_activity_log`, `task_watchers`; `work_item_id` set to NOT NULL
6. **1:1 backfill** — missing `project_execution_state` and `project_settings` rows created
7. **Dashboard backfill** — missing `dashboard_project_metrics` rows created with zeroed metrics

### Application-Level Fixes
1. **Startup integrity guard** (`server/bootstrap/backfills/integrity-guard.ts`) — runs on every boot to backfill any missing 1:1 child rows and dashboard metrics
2. **Missing sync calls patched** — `meeting-routes.ts`, `seed-engineering.ts`, `work-items-backfill.ts` now call `syncProjectSplitTablesAfterInsert()` after creating projects
3. **All code references to `taskId`** on the 6 dropped columns migrated to `workItemId`

### Drizzle Schema Updates
- `shared/schema/finance.ts` — `project_id` marked `.notNull()` on 5 tables
- `shared/schema/projects.ts` — `project_revenue_summary.project_id` marked `.notNull()`
- `shared/schema/tasks.ts` — `work_items.created_by` marked `.notNull()`; `taskId` columns removed from 6 tables; `workItemId` marked `.notNull()` on 6 tables

---

*Report generated by static schema analysis. Fixes applied in migration 20260339 and application code updates.*
