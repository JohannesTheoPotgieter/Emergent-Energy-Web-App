# Project Name Deprecation Plan

This document describes the deprecation of `project_name` TEXT columns across 43 tables in favor of `project_id` FK references to `project_info`.

## Scope

A total of 43 tables contain `project_name` columns that are being deprecated in favor of integer `project_id` foreign keys. This migration improves referential integrity, enables cascade operations, and eliminates name-matching ambiguity.

## Important Exception

The `project_info` table's `projectName` column is **NOT deprecated**. It remains the canonical source of a project's display name. All other tables should reference `project_info.id` via their `project_id` FK column.

## 90-Day Window Rules

During the 90-day deprecation window:

- **Do not drop** any `project_name` column. Columns must be retained for rollback safety.
- **Do not stop writing** to `project_name` columns. Dual-write (both `project_id` and `project_name`) must continue during the window to ensure backward compatibility.
- After the 90-day window, a cleanup migration can be submitted to drop the deprecated columns.

## Migration Priority Tiers

### Tier 1 — Critical Financial Tables (Migrate First)
- `normalized_cost_lines`
- `normalized_revenue_lines`
- `budget_baselines`
- `payment_requests`
- `invoice_captures`

### Tier 2 — Operational Tables
- `work_items`
- `deliverables`
- `procurement_items`
- `project_eng_stages`
- `project_eng_tasks`
- `qc_checklist`
- `qc_item_instance`
- `snags`

### Tier 3 — Supporting Tables
- All remaining tables with `project_name` columns
- Legacy reporting tables
- Audit and history tables
