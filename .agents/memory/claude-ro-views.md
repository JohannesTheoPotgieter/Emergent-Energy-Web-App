---
name: Claude read-only prod access
description: How the read-only prod role exposes data and the gotchas when scripting against it.
---

# Claude read-only prod database access

The `CLAUDE_RO_DATABASE_URL` secret connects as role `claude_readonly` to the prod
Neon database. That role can see **only** the `claude_views.*` schema (plus
`information_schema` / `pg_catalog`) — it has NO access to the base tables.

**Why:** querying base table names (e.g. `normalized_cost_lines`) fails with
`42P01 relation does not exist`. You must query the view, e.g.
`claude_views.v_normalized_cost_lines`.

**How to apply:**
- Use the `v_*` views for any read-only prod analysis. Key ones: `v_normalized_cost_lines`
  (has `cos_realised` bool), `v_normalized_revenue_lines` (`status` = paid/invoiced/planned),
  `v_category_revenue_allocations`, `v_dashboard_project_metrics`, `v_project_revenue_summary`.
- Most views carry `effective_from` / `effective_to` for as-of snapshots
  (`effective_from <= $cut AND (effective_to IS NULL OR effective_to > $cut)`).
  Exceptions: `v_dashboard_project_metrics` is NOT snapshot-dated, and its
  `realised_cost` / `gross_profit` columns read 0.00 (stale) — don't rely on them;
  the dashboard computes realised values on the fly, not from stored columns.
- The `v_finance_cos_monthly` / `v_finance_revenue_monthly` tables were empty at the
  08/06 snapshot — monthly finance buckets are not persisted there.
- `pg` driver: tsx scripts using `import {Pool} from "pg"` must run from the repo
  root (module resolution fails from `/tmp`). The RO URL triggers an sslmode
  deprecation warning — harmless.
- The separate `executeSql({environment:"production"})` sandbox tool DOES see base
  tables (different role) — handy for schema discovery, but the deliverable scripts
  must use the RO views since that is the only credential they ship with.
