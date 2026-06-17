---
name: Project data deletion / linkage
description: How a project's data is linked across the schema — needed for safe deletes and audits.
---

# Deleting / auditing all data for one project

**The real spine is `project_info` (PK `id`), not the `projects` table.** `projects` is a
near-empty legacy table (only `budgets`/`expenses`/`revenues` FK to it). Almost everything
links to `project_info.id` via `project_id` (~90+ FK children), or to a `project_name` text
string (~75 columns).

**Why this matters:** a name-only search (`ILIKE '%name%'` across `*project*name*` columns)
**undercounts** the true footprint. Rows linked purely by FK (`project_id`) — e.g.
`work_items`, `project_settings`, `project_execution_state` — and grandchildren reached
through import runs carry no project_name. Example seen once: a name scan found ~249 rows,
but the true linked set was ~706 rows across 18 tables.

**How to apply (delete order = children → spine):**
1. Find the project: `SELECT id FROM project_info WHERE project_name ILIKE '...'`.
2. Footprint = count rows in every FK child of `project_info` where `project_id = <id>`,
   keep only non-empty ones. Then check *their* children (grandchildren), especially via
   `smart_import_runs` (e.g. `import_issues` references `import_run_id`) and `change_sets`
   (`field_changes` references `change_set_id`).
3. FK constraints are RESTRICT (no cascade) — delete leaf-first inside one `BEGIN; ... COMMIT;`
   (single `executeSql` call; separate calls don't share a transaction). Known edge: delete
   `normalized_cost_lines` before `category_revenue_allocations` (FK `category_allocation_id`).
4. Delete name-keyed tables (audit_events, change_sets, import_logs, derived_project_kpis,
   project_revenue_summary) by `project_name`, and `project_info` last (`id=<id>`).
5. Verify: re-run the name scan + count any FK child still referencing the deleted `id`.

Dev DB (Replit Postgres) has rollback checkpoints, so dev deletes are recoverable.
