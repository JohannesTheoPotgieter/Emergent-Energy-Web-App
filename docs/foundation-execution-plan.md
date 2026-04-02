# Foundation Execution Plan: Promoted Schema Deployment

> **Date:** 2026-04-02
> **Purpose:** Establish the promoted multi-schema foundation in production so Phase 1B can proceed.
> **Status:** PLAN ONLY — no implementation without explicit sign-off.

---

## A. Executive Summary

### What is missing in production

The production Neon database (`neondb`) contains **only the `public` schema** with 317 legacy tables. The promoted schemas required by Phase 1B do not exist:

| Schema | Status | Required by Phase 1B |
|--------|--------|---------------------|
| `core` | **MISSING** | `core.projects`, `core.clients`, `core.parties` |
| `finance` | **MISSING** | `finance.cost_lines`, `finance.revenue_lines`, `finance.fiscal_periods` |
| `documentation` | **MISSING** | `documentation.document_approvals`, `documentation.documents`, `documentation.document_versions` |
| `internal` | **MISSING** | `internal.sync_watermarks` |
| `imports` | **MISSING** | Referenced by foundation FKs |
| `project_development` | **MISSING** | Domain rollout tables |
| `engineering` | **MISSING** | Domain rollout tables |
| `quality` | **MISSING** | Domain rollout tables |
| `project_management` | **MISSING** | Domain rollout tables |
| `personal` | **MISSING** | Schema shell only |

### Why Phase 1B is blocked

Every Phase 1B forward migration issues `ALTER TABLE core.projects ADD COLUMN ...`, `ALTER TABLE finance.cost_lines ADD COLUMN ...`, `CREATE TABLE core.parties (...)`, etc. These all fail immediately because the target schemas and tables do not exist.

The Phase 1B preflight audit (`20260402_preflight_audit.sql`) returned **21 statement errors** — all `relation "X" does not exist` — across every HARD STOP check that references promoted tables.

### What exact foundation layer must run first

The **multi-schema foundation** — a set of hand-written SQL migration files that:
1. Create 10 schema shells
2. Create ~40 promoted tables with lineage columns
3. Backfill data from legacy `public.*` tables into promoted tables (idempotent upserts)
4. Create compatibility views and indexes
5. Run reconciliation checks

This foundation lives **entirely in SQL migration files**. It is **not** created by Drizzle, the startup orchestrator, `pre-push-enums.sql`, or `full-schema-alignment.sql`.

---

## B. Exact Repo Objects Involved

### B.1 Migration Files (DDL + Backfill — the critical path)

| # | File | Type | Lines | Description |
|---|------|------|-------|-------------|
| 1 | `migrations/20260314_multischema_foundation.sql` | DDL + Backfill | 747 | Creates 10 schemas, ~25 tables, backfills all core/finance/documentation/imports data from legacy. Single `BEGIN;...COMMIT;` transaction. |
| 2 | `migrations/20260315_multischema_hardening.sql` | DDL + Backfill | 246 | Tightens `core.projects.legacy_projects_id` lineage, backfills `work_item_comments/attachments/activity` from `public.work_item_*` tables, creates soft-type validation views, adds ~40 indexes. Single `BEGIN;...COMMIT;` transaction. |
| 3 | `migrations/20260316_promoted_read_preparation.sql` | DDL (views only) | 230 | Creates compatibility read views (`v_*_legacy_compat`, `v_*_promoted_vs_legacy`) and cutover readiness summary view. Single `BEGIN;...COMMIT;` transaction. No data mutations. |
| 4 | `migrations/20260317_multischema_domain_rollout.sql` | DDL + Backfill | 1075 | Creates remaining domain tables in `project_management`, `project_development`, `engineering`, `quality` schemas. Adds ~30 more tables with backfills. Single `BEGIN;...COMMIT;` transaction. |

### B.2 Reconciliation Files (Read-Only Diagnostics)

| # | File | Type | Lines | Description |
|---|------|------|-------|-------------|
| R1 | `migrations/20260314_multischema_reconciliation.sql` | Read-only | 120 | Count checks, delta reports, orphan detection across all promoted vs legacy tables. Run after file #1. |
| R2 | `migrations/20260315_multischema_reconciliation_hardening.sql` | Read-only | 394 | Deep integrity checks: duplicate business keys, orphan references, soft-type validation, project-name join gaps. Run after file #2. |

### B.3 Files NOT Involved (but in the same date range)

These migrations operate on `public.*` tables only and are **not part of the foundation**:

| File | Why excluded |
|------|-------------|
| `20260316_pd_handover_workspace_fields.sql` | Adds columns to `public.project_pd_pm_handover` only |
| `20260316_role_authority_model_layer.sql` | Adds column to `public.role_permissions` only |
| `20260318_cutover_execution_controls.sql` | Separate cutover control system |
| `20260318_permission_overrides_audit.sql` | Adds `public.user_permission_overrides` only |
| `20260319_*.sql` through `20260322_*.sql` | All operate on `public.*` tables only |

### B.4 Startup/Bootstrap Code

**CRITICAL FINDING:** The startup orchestrator (`server/bootstrap/startup-orchestrator.ts`, 2358 lines) does **NOT** create promoted schemas or tables. Confirmed by grep:

- `CREATE SCHEMA` — zero matches in startup-orchestrator.ts
- `core.`, `finance.`, `documentation.`, `internal.` — zero matches in startup-orchestrator.ts
- `CREATE SCHEMA` — zero matches in `script/pre-push-enums.sql`
- `CREATE SCHEMA` — zero matches in `script/full-schema-alignment.sql`

The startup orchestrator only manages `public.*` schema tables via:
- `script/pre-push-enums.sql` — creates enum types and stub tables in `public`
- `script/full-schema-alignment.sql` — adds columns to `public.*` tables via `ALTER TABLE ADD COLUMN IF NOT EXISTS`
- `runAdditiveSchemaAlignments()` — creates/maintains `public.*` tables

**The promoted schemas are managed exclusively by hand-written SQL migration files.**

### B.5 Drizzle ORM

**CRITICAL FINDING:** The Drizzle schema (`shared/schema.ts` + `shared/schema/*.ts`) defines **only `public` schema tables**. Zero usage of `pgSchema()` anywhere in the codebase. Drizzle has no knowledge of promoted schemas.

- `drizzle-kit push` would **not** create promoted schemas
- `drizzle-kit push` is **never actually invoked** — replaced by the startup orchestrator
- Running `drizzle-kit push` carries risk of conflicting with `public.*` table management

### B.6 Env Flags

The foundation migrations are **plain SQL files**. They do not depend on any env flags. The flags below control unrelated startup behavior:

| Flag | Purpose | Relevant? |
|------|---------|-----------|
| `ENABLE_STARTUP_SCHEMA_REPAIR` | Runs `pre-push-enums.sql` + `full-schema-alignment.sql` | NO — these don't touch promoted schemas |
| `ENABLE_STARTUP_DATA_SEED` | Seeds templates, roles, feature flags | NO — unrelated |
| `ENABLE_STARTUP_BACKFILL` | Runs PM/assignment backfills | NO — operates on `public.*` only |
| `ENABLE_STARTUP_MAINTENANCE` | Master flag for optional startup tasks | NO — does not trigger foundation |

---

## C. Production-Safe Execution Path

### C.1 Preferred Method

**Run the 4 foundation SQL files directly against the Neon database, in order, using the Neon HTTP SQL API** (since `psql` TCP is not available from this environment).

The existing `script/run-sql.cjs` tool can execute these files via Neon's `/sql` endpoint.

### C.2 Exact Execution Order

```
Step 1: Pre-foundation snapshot (see Section D)
Step 2: Run 20260314_multischema_foundation.sql        (DDL + backfill)
Step 3: Run 20260314_multischema_reconciliation.sql     (read-only validation)
Step 4: Run 20260315_multischema_hardening.sql          (DDL + backfill)
Step 5: Run 20260315_multischema_reconciliation_hardening.sql  (read-only validation)
Step 6: Run 20260316_promoted_read_preparation.sql      (views only)
Step 7: Run 20260317_multischema_domain_rollout.sql     (DDL + backfill)
Step 8: Post-foundation validation (see Section E)
```

### C.3 Technical Concern: Transaction Size

Each foundation file uses `BEGIN;...COMMIT;`. The largest file (`20260314_multischema_foundation.sql`, 747 lines) creates schemas, tables, AND backfills all data in a single transaction.

**Risk:** The Neon HTTP SQL API has a request size/timeout limit. If the foundation file contains too many INSERT statements for a single HTTP request, it may need to be split. The `run-sql.cjs` tool splits on semicolons and runs statements individually — this means the `BEGIN;...COMMIT;` transaction boundaries are lost.

**Mitigation options:**
1. **Option A:** Modify `run-sql.cjs` to send the entire file as a single query (preserves transaction atomicity)
2. **Option B:** Split the foundation file into DDL-only (schemas + tables) and backfill-only (INSERT INTO ... SELECT) sections, run DDL first
3. **Option C:** Use a `psql`-compatible tunnel (we proved the HTTP CONNECT proxy can reach Neon on port 443; Neon supports [websocket connections](https://neon.tech/docs/serverless/serverless-driver))

### C.4 What NOT to Run

| Do NOT run | Why |
|-----------|-----|
| `drizzle-kit push` or `npx drizzle-kit push` | Has no knowledge of promoted schemas; may conflict with public table management |
| `npm run db:setup` | Invokes startup orchestrator with all flags enabled — triggers seeds, backfills, schema repair on public tables |
| `npm run db:push` | Only runs `pre-push-enums.sql` + `full-schema-alignment.sql` — no promoted schemas |
| App startup with `ENABLE_STARTUP_*` flags | Would run unrelated seeds/backfills on public tables |
| Any migration files after `20260317` and before `20260402` | These are `public.*` schema changes unrelated to the promoted foundation |
| Phase 1B migrations (`20260402_*.sql`) | Blocked until foundation is validated |

### C.5 How to Avoid Accidental Side Effects

1. **Run SQL files directly** — do not go through the app startup pipeline
2. **No env flags needed** — the SQL files are self-contained
3. **No ORM invocation** — Drizzle is not involved
4. **Transaction safety** — each file uses `BEGIN;...COMMIT;` ensuring atomicity
5. **Idempotent** — all `CREATE SCHEMA/TABLE IF NOT EXISTS` and `ON CONFLICT DO UPDATE/NOTHING`

---

## D. Preflight Before Foundation

### D.1 Schema Existence Checks

```sql
-- Must return ONLY: public, _system, information_schema, pg_catalog, pg_toast
SELECT schema_name FROM information_schema.schemata ORDER BY schema_name;

-- Must return 0 (no promoted schemas exist yet)
SELECT COUNT(*) FROM information_schema.schemata
WHERE schema_name IN ('core','finance','documentation','internal','imports',
                      'project_development','engineering','quality',
                      'project_management','personal');
```

### D.2 Legacy Data Existence Checks

The foundation backfill copies data FROM these legacy tables. They must exist and have data:

```sql
-- All must return > 0 rows
SELECT 'users' AS tbl, COUNT(*) FROM public.users;
SELECT 'clients' AS tbl, COUNT(*) FROM public.clients;
SELECT 'project_info' AS tbl, COUNT(*) FROM public.project_info;
SELECT 'project_execution_state' AS tbl, COUNT(*) FROM public.project_execution_state;
SELECT 'portfolios' AS tbl, COUNT(*) FROM public.portfolios;
SELECT 'work_items' AS tbl, COUNT(*) FROM public.work_items;
SELECT 'deliverables' AS tbl, COUNT(*) FROM public.deliverables;
SELECT 'program_expense' AS tbl, COUNT(*) FROM public.program_expense;
SELECT 'program_inflows' AS tbl, COUNT(*) FROM public.program_inflows;
SELECT 'import_runs' AS tbl, COUNT(*) FROM public.import_runs;
```

### D.3 Data Quality Checks (from foundation backfill dependencies)

```sql
-- Detects non-numeric amounts that will cause ::NUMERIC cast failures in foundation backfill
SELECT 'program_inflows_bad_amounts' AS check_name, COUNT(*) AS cnt
FROM public.program_inflows
WHERE milestone_amount IS NOT NULL
  AND BTRIM(milestone_amount) <> ''
  AND BTRIM(milestone_amount) !~ '^\-?\d+(\.\d+)?$';

SELECT 'program_expense_bad_amounts' AS check_name, COUNT(*) AS cnt
FROM public.program_expense
WHERE expense_actual_total IS NOT NULL
  AND BTRIM(expense_actual_total) <> ''
  AND BTRIM(expense_actual_total) !~ '^\-?\d+(\.\d+)?$';
```

If either returns > 0, the `NULLIF(..., '')::NUMERIC(15,2)` cast in the foundation backfill will fail on those rows. Review and decide: clean the data first, or accept that `NULLIF` handles empty strings but NOT malformed numbers like `"N/A"` or `"TBC"`.

### D.4 Neon Snapshot / Backup

**Before running the foundation:**
1. Use Neon dashboard to create a **branch snapshot** or note the current LSN
2. Neon supports point-in-time recovery — note the timestamp before execution
3. This provides a rollback path that doesn't require destructive SQL

### D.5 Hard Stops

| Check | Condition | Action |
|-------|-----------|--------|
| Promoted schemas already exist | `COUNT(*) > 0` from D.1 check | STOP — investigate who created them |
| Legacy tables missing | Any count = 0 from D.2 | STOP — foundation backfill will produce empty promoted tables |
| Non-numeric amounts | Count > 0 from D.3 | REVIEW — foundation uses `NULLIF(...,'')::NUMERIC` which handles empty strings but will throw on malformed values |
| Neon snapshot not taken | Snapshot missing | STOP — no rollback safety net |

---

## E. Validation After Foundation

### E.1 Schema Existence

```sql
-- Must return exactly 10 new schemas
SELECT schema_name FROM information_schema.schemata
WHERE schema_name IN ('core','finance','documentation','internal','imports',
                      'project_development','engineering','quality',
                      'project_management','personal')
ORDER BY schema_name;
```

### E.2 Required Table Existence (Phase 1B prerequisites)

```sql
-- All must return exactly 1 row
SELECT 1 FROM information_schema.tables WHERE table_schema='core' AND table_name='projects';
SELECT 1 FROM information_schema.tables WHERE table_schema='core' AND table_name='clients';
SELECT 1 FROM information_schema.tables WHERE table_schema='core' AND table_name='work_items';
SELECT 1 FROM information_schema.tables WHERE table_schema='core' AND table_name='portfolios';
SELECT 1 FROM information_schema.tables WHERE table_schema='finance' AND table_name='cost_lines';
SELECT 1 FROM information_schema.tables WHERE table_schema='finance' AND table_name='revenue_lines';
SELECT 1 FROM information_schema.tables WHERE table_schema='documentation' AND table_name='documents';
SELECT 1 FROM information_schema.tables WHERE table_schema='documentation' AND table_name='document_approvals';
SELECT 1 FROM information_schema.tables WHERE table_schema='documentation' AND table_name='document_versions';
SELECT 1 FROM information_schema.tables WHERE table_schema='internal' AND table_name='users';
```

### E.3 Data Parity Checks (from reconciliation files)

```sql
-- Row count parity: legacy vs promoted
SELECT 'projects' AS domain,
       (SELECT COUNT(*) FROM public.project_info) AS legacy,
       (SELECT COUNT(*) FROM core.projects) AS promoted;
SELECT 'clients' AS domain,
       (SELECT COUNT(*) FROM public.clients) AS legacy,
       (SELECT COUNT(*) FROM core.clients) AS promoted;
SELECT 'users' AS domain,
       (SELECT COUNT(*) FROM public.users) AS legacy,
       (SELECT COUNT(*) FROM internal.users) AS promoted;
SELECT 'documents' AS domain,
       (SELECT COUNT(*) FROM public.deliverables) AS legacy,
       (SELECT COUNT(*) FROM documentation.documents) AS promoted;
SELECT 'cost_lines' AS domain,
       (SELECT COUNT(*) FROM public.program_expense) AS legacy,
       (SELECT COUNT(*) FROM finance.cost_lines WHERE source_table='public.program_expense') AS promoted;
SELECT 'revenue_lines' AS domain,
       (SELECT COUNT(*) FROM public.program_inflows) AS legacy,
       (SELECT COUNT(*) FROM finance.revenue_lines WHERE source_table='public.program_inflows') AS promoted;
```

### E.4 Finance Amount Parity

```sql
SELECT 'cost_total_delta' AS check_name,
       ABS(
         COALESCE((SELECT SUM(NULLIF(expense_actual_total,'')::NUMERIC(15,2)) FROM public.program_expense), 0) -
         COALESCE((SELECT SUM(amount_ex_vat) FROM finance.cost_lines WHERE source_table='public.program_expense'), 0)
       ) AS delta;

SELECT 'revenue_total_delta' AS check_name,
       ABS(
         COALESCE((SELECT SUM(NULLIF(milestone_amount,'')::NUMERIC(15,2)) FROM public.program_inflows), 0) -
         COALESCE((SELECT SUM(amount_ex_vat) FROM finance.revenue_lines WHERE source_table='public.program_inflows'), 0)
       ) AS delta;
```

Both deltas must be ≤ 0.50.

### E.5 No Legacy Route/Auth/Import Changes

```sql
-- Verify public.users is untouched (foundation only READS from it)
SELECT COUNT(*) AS user_count FROM public.users;

-- Verify no public tables were dropped
SELECT COUNT(*) AS public_table_count FROM information_schema.tables WHERE table_schema='public';
-- Must match pre-foundation count (317)

-- Verify no public columns were altered
-- (Foundation only creates NEW schemas/tables, never alters public.*)
```

### E.6 View Existence (from promoted_read_preparation)

```sql
SELECT table_schema, table_name FROM information_schema.views
WHERE table_schema IN ('core','finance')
ORDER BY table_schema, table_name;
```

Expected views: `core.v_clients_legacy_compat`, `core.v_projects_legacy_compat`, `core.v_work_items_legacy_compat`, `core.v_promoted_read_cutover_blockers`, and several `v_*_promoted_vs_legacy` comparison views.

---

## F. Rollback Approach

### F.1 Operational Rollback (Preferred)

**Do nothing.** The promoted schemas are purely additive. No legacy table was modified. The application reads from `public.*` tables and has no awareness of the promoted schemas. The app will continue to function identically.

To "roll back" operationally:
- Simply do not run Phase 1B
- The promoted schemas sit dormant with no consumers

### F.2 Neon Point-in-Time Recovery

If the foundation must be physically reversed:
1. Use the Neon dashboard to restore from the pre-foundation snapshot/branch
2. This atomically reverts all schema and data changes

### F.3 Destructive SQL Rollback (Last Resort)

```sql
-- WARNING: Drops ALL promoted data permanently. Use only if PITR is unavailable.
DROP SCHEMA IF EXISTS core CASCADE;
DROP SCHEMA IF EXISTS finance CASCADE;
DROP SCHEMA IF EXISTS documentation CASCADE;
DROP SCHEMA IF EXISTS internal CASCADE;
DROP SCHEMA IF EXISTS imports CASCADE;
DROP SCHEMA IF EXISTS project_development CASCADE;
DROP SCHEMA IF EXISTS engineering CASCADE;
DROP SCHEMA IF EXISTS quality CASCADE;
DROP SCHEMA IF EXISTS project_management CASCADE;
DROP SCHEMA IF EXISTS personal CASCADE;
```

**Risk:** `CASCADE` will drop all tables, views, indexes, and constraints in these schemas. This is irreversible without PITR.

### F.4 What Can and Cannot Be Rolled Back

| Object | Reversible? | Method |
|--------|-------------|--------|
| Schema shells | Yes | `DROP SCHEMA` |
| Promoted tables | Yes | `DROP TABLE` or `DROP SCHEMA CASCADE` |
| Backfilled data | Yes (destructive) | Drop tables; re-run foundation to recreate |
| Compatibility views | Yes | `DROP VIEW` |
| Indexes on promoted tables | Yes | `DROP INDEX` |
| Legacy `public.*` tables | N/A — never modified | Nothing to roll back |

---

## G. Gate to Phase 1B

After the foundation is deployed and validated, these exact checks must pass before Phase 1B can proceed:

### G.1 Re-run Phase 1B Preflight Audit

```bash
node script/run-sql.cjs migrations/20260402_preflight_audit.sql
```

**All 34 statements must complete without errors.** Specifically:
- All HARD STOP checks (PF-1, PF-2, PF-4, PF-5, PF-7, PF-8b, PF-9c, PF-9d, PF-10, PF-11) must return `PASS`
- All SOFT STOP checks (PF-3, PF-9a, PF-9b) must return `PASS` or `REVIEW` with documented sign-off
- All INFO checks (PF-6, PF-8a) must be reviewed

### G.2 Foundation Reconciliation Clean

Both reconciliation files must show zero critical deltas:
- `20260314_multischema_reconciliation.sql` — all count deltas = 0, no missing projects
- `20260315_multischema_reconciliation_hardening.sql` — zero orphans, zero duplicate business keys

### G.3 Promoted Table Column Readiness

Phase 1B migrations add columns to these specific tables. They must exist with the expected column set:

```sql
-- core.projects must have these columns (from foundation)
SELECT column_name FROM information_schema.columns
WHERE table_schema='core' AND table_name='projects'
ORDER BY ordinal_position;
-- Expected: id, legacy_project_info_id, legacy_projects_id, project_name, project_code,
--           client_id, phase, rag_status, rag_comment, execution_gate_status,
--           execution_gate_reason, archived_status, pm_user_id, pd_user_id,
--           created_at, updated_at, source_table

-- finance.cost_lines must have these columns (from foundation)
SELECT column_name FROM information_schema.columns
WHERE table_schema='finance' AND table_name='cost_lines'
ORDER BY ordinal_position;
-- Expected: id, legacy_program_expense_id, legacy_normalized_cost_line_id,
--           project_id, project_name_snapshot, counterparty_name, description,
--           amount_ex_vat, invoice_number, invoice_date, approved_date, paid_date,
--           status, import_run_id, source_table, created_at, updated_at
```

### G.4 No Unintended Side Effects

```sql
-- Public schema table count unchanged
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';
-- Must equal pre-foundation count

-- No new columns added to public.* tables by foundation
-- (Foundation only reads from public, never writes to it)
```

---

## Summary Decision Matrix

| Step | Action | Risk | Reversible |
|------|--------|------|------------|
| 1 | Take Neon snapshot | None | N/A |
| 2 | Run D.1-D.4 preflight checks | None (read-only) | N/A |
| 3 | Run `20260314_multischema_foundation.sql` | Medium (creates schemas + backfills data) | Yes (PITR or DROP CASCADE) |
| 4 | Run `20260314_multischema_reconciliation.sql` | None (read-only) | N/A |
| 5 | Run `20260315_multischema_hardening.sql` | Low (indexes + additional backfills) | Yes (PITR or DROP CASCADE) |
| 6 | Run `20260315_multischema_reconciliation_hardening.sql` | None (read-only) | N/A |
| 7 | Run `20260316_promoted_read_preparation.sql` | None (views only) | Yes (DROP VIEW) |
| 8 | Run `20260317_multischema_domain_rollout.sql` | Low (additional domain tables + backfills) | Yes (PITR or DROP CASCADE) |
| 9 | Run E.1-E.6 validation | None (read-only) | N/A |
| 10 | Run G.1-G.4 Phase 1B gate | None (read-only) | N/A |
