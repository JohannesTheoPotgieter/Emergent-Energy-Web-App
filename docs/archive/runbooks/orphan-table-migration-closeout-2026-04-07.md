# Runbook: Orphan Table Migration Closeout

> **Migration file**: `migrations/20260407_drop_orphaned_tables.sql`
> **Status**: Ready to execute
> **Risk**: Low (all targets confirmed 0 rows in production)
> **Rollback complexity**: Low (re-create empty tables if needed)

---

## Scope

### Tables DROPPED by this migration (5 — all confirmed 0 rows)

| SQL Table | Former Schema File | Verified Empty | FK Dependencies |
|-----------|-------------------|:-:|---|
| `event_processing_log` | `collaboration.ts` | Yes (0 rows) | References `domain_events(id)` — dropped first |
| `event_subscriptions` | `collaboration.ts` | Yes (0 rows) | None |
| `domain_events` | `collaboration.ts` | Yes (0 rows) | Referenced by `event_processing_log` — dropped after it |
| `derived_portfolio_kpis` | `projects.ts` | Yes (0 rows) | None |
| `derived_rag_summary` | `projects.ts` | Yes (0 rows) | None |

Also dropped: `event_processing_status` enum (sole consumer was `event_processing_log`).

### Schema-only removals (4 — never existed in live DB)

| SQL Table | Former Schema File | Notes |
|-----------|-------------------|-------|
| `approval_workflows` | `collaboration.ts` | Drizzle definition removed; table never created in DB |
| `audit_trail` | `collaboration.ts` | Same |
| `file_versions` | `collaboration.ts` | Same |
| `notification_preferences` | `collaboration.ts` | Same |

### Tables NOT dropped (4 — intentionally excluded)

| SQL Table | Reason |
|-----------|--------|
| `dashboard_widget_config` | Has 2 rows of data |
| `fiscal_years` | Has 6 rows of data |
| `organizations` | FK target: `users.organization_id` references `organizations(id)` |
| `project_linkage_review_queue` | Migration artifact; may have unresolved backfill rows |

---

## Pre-Deploy Checklist

Run these checks before executing the migration:

### 1. Verify tables are still empty (re-confirm before deploy)

```sql
SELECT 'event_processing_log' AS tbl, COUNT(*) AS rows FROM event_processing_log
UNION ALL SELECT 'event_subscriptions', COUNT(*) FROM event_subscriptions
UNION ALL SELECT 'domain_events', COUNT(*) FROM domain_events
UNION ALL SELECT 'derived_portfolio_kpis', COUNT(*) FROM derived_portfolio_kpis
UNION ALL SELECT 'derived_rag_summary', COUNT(*) FROM derived_rag_summary
ORDER BY tbl;
```

**Expected**: All 5 rows show `0`. If any show non-zero, **STOP** and investigate before proceeding.

### 2. Verify no new code references appeared

```bash
grep -rn 'event_processing_log\|event_subscriptions\|domain_events\|derived_portfolio_kpis\|derived_rag_summary\|event_processing_status' server/ client/ shared/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v 'shared/schema/' | grep -v migrations/ | grep -v docs/
```

**Expected**: Zero results. If any runtime code now references these tables, **STOP**.

### 3. Verify app builds cleanly

```bash
npx tsc --noEmit
```

**Expected**: Zero new errors (pre-existing merge conflict markers in `routes.ts`/`storage.ts` are known and unrelated).

---

## Deploy Steps

### Option A: Manual execution via psql/SQL console

```sql
-- Execute the migration file directly
\i migrations/20260407_drop_orphaned_tables.sql
```

Or paste the SQL statements individually:

```sql
DROP TABLE IF EXISTS event_processing_log;
DROP TABLE IF EXISTS event_subscriptions;
DROP TABLE IF EXISTS domain_events;
DROP TABLE IF EXISTS derived_portfolio_kpis;
DROP TABLE IF EXISTS derived_rag_summary;
DROP TYPE IF EXISTS event_processing_status;
```

### Option B: Via startup orchestrator

If the app's startup orchestrator runs SQL migrations automatically, deploy the code changes and the migration will execute on next boot.

---

## Post-Deploy Verification

Run immediately after migration executes:

### 1. Confirm dropped tables are gone

```sql
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'event_processing_log',
    'event_subscriptions',
    'domain_events',
    'derived_portfolio_kpis',
    'derived_rag_summary'
  );
```

**Expected**: 0 rows (all tables gone).

### 2. Confirm dropped enum is gone

```sql
SELECT typname FROM pg_type WHERE typname = 'event_processing_status';
```

**Expected**: 0 rows.

### 3. Confirm excluded tables still exist

```sql
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'dashboard_widget_config',
    'fiscal_years',
    'organizations',
    'project_linkage_review_queue'
  )
ORDER BY tablename;
```

**Expected**: 4 rows (all four tables still present).

### 4. Confirm app boots and serves requests

- Check server startup logs for errors
- Load the home page / dashboard
- Load the COS control page (heaviest data path)
- Verify no 500 errors in logs

---

## Rollback / Containment Plan

### If migration fails partway

The migration uses `DROP TABLE IF EXISTS` — each statement is independent. If one fails:
1. Check which statement failed and why (likely an unexpected FK dependency)
2. The already-dropped tables are safely gone (they were empty)
3. Skip the failing statement and investigate the dependency
4. Do NOT re-create already-dropped tables (they had 0 rows)

### If app fails to boot after deploy

1. **Check the error message** — if it references a dropped table name, a code reference was missed
2. **Immediate fix**: Re-create the empty table to unblock boot:

```sql
-- Emergency re-create (only if needed — all were empty)
CREATE TABLE IF NOT EXISTS domain_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id INTEGER NOT NULL,
  project_id INTEGER,
  triggered_by INTEGER,
  payload JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP
);

CREATE TYPE event_processing_status AS ENUM ('success', 'failed', 'skipped');

CREATE TABLE IF NOT EXISTS event_processing_log (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES domain_events(id),
  handler_name TEXT NOT NULL,
  status event_processing_status NOT NULL,
  error_message TEXT,
  processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS event_subscriptions (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  handler_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS derived_portfolio_kpis (
  id SERIAL PRIMARY KEY,
  snapshot_key TEXT NOT NULL UNIQUE DEFAULT 'current',
  total_program_budget NUMERIC(15,2),
  actual_spend_paid NUMERIC(15,2),
  revenue_realised NUMERIC(15,2),
  active_projects_count INTEGER NOT NULL DEFAULT 0,
  active_capacity_mw NUMERIC(12,2),
  on_schedule_rate NUMERIC(8,4),
  behind_plan_count INTEGER NOT NULL DEFAULT 0,
  on_hold_count INTEGER NOT NULL DEFAULT 0,
  closed_count INTEGER NOT NULL DEFAULT 0,
  gross_profit NUMERIC(15,2),
  gross_profit_pct NUMERIC(8,4),
  revenue_outstanding NUMERIC(15,2),
  expenses_outstanding NUMERIC(15,2),
  phase_distribution_json JSONB,
  computed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS derived_rag_summary (
  id SERIAL PRIMARY KEY,
  rag_status TEXT NOT NULL,
  project_count INTEGER NOT NULL DEFAULT 0,
  total_kwp NUMERIC(15,2),
  total_contract_value NUMERIC(15,2),
  computed_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

3. **Then investigate** which code path references the table and fix the root cause

### If an unexpected dependency surfaces post-deploy

1. Check `pg_depend` and `information_schema.table_constraints` for the dropped table name
2. Re-create only the specific table needed (using the emergency SQL above)
3. File a follow-up task to properly handle the dependency

---

## Idempotency

This migration is fully idempotent. Running it multiple times is safe — `DROP TABLE IF EXISTS` and `DROP TYPE IF EXISTS` are no-ops if the targets don't exist.
