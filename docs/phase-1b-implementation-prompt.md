# Phase 1B Implementation Prompt

> **Scope:** Migrations, preflight audit scripts, backfill scripts, validation tests.  
> **Explicitly excluded:** Bridge writes, route cutovers, auth changes.  
> **Reference spec:** `docs/phase-1b-additive-schema-spec.md`

---

## What to build

Seven SQL migration files, one preflight audit script, seven backfill scripts, and validation tests. Nothing else.

---

## Part 1: Migration Files

Create these files in `/migrations/`. Each must be idempotent (`IF NOT EXISTS` / `IF EXISTS`). Each must be wrapped in `BEGIN; ... COMMIT;`.

### 1a. `20260402_lifecycle_parity_columns.sql`

Add to `core.projects`:
- `current_stage_code TEXT`
- `gate_status TEXT`
- `gate_readiness_pct NUMERIC(5,2)`
- `phase_updated_at TIMESTAMP`
- `signed_status TEXT`
- `execution_phase TEXT`

All nullable, no defaults. Add `COMMENT ON COLUMN` for each.

### 1b. `20260402_lifecycle_parity_columns_rollback.sql`

`DROP COLUMN IF EXISTS` for all 6 columns. Wrapped in `BEGIN/COMMIT`.

### 2a. `20260402_approval_type_support.sql`

Add to `documentation.document_approvals`:
- `legacy_approval_id INTEGER UNIQUE`
- `approval_type TEXT`
- `approval_category TEXT`
- `title TEXT`
- `project_id INTEGER REFERENCES core.projects(id)`
- `related_entity_type TEXT`
- `related_entity_id INTEGER`
- `requested_by_user_id INTEGER`
- `urgency TEXT`
- `evidence_links TEXT`
- `source_table TEXT`

All nullable. Add `COMMENT ON COLUMN` for `legacy_approval_id`, `approval_type`, `approval_category`, `project_id`.

### 2b. `20260402_approval_type_support_rollback.sql`

`DROP COLUMN IF EXISTS` for all 11 columns.

### 3a. `20260402_client_contact_fields.sql`

Add to `core.clients`:
- `legal_entity_name TEXT`
- `trading_name TEXT`
- `client_type TEXT`
- `primary_contact_name TEXT`
- `primary_contact_email TEXT`
- `primary_contact_phone TEXT`

All nullable. Add `COMMENT ON COLUMN` for `legal_entity_name`, `client_type`, `primary_contact_name`.

### 3b. `20260402_client_contact_fields_rollback.sql`

`DROP COLUMN IF EXISTS` for all 6 columns.

### 4a. `20260402_party_abstraction.sql`

Create `core.parties`:
```
id BIGSERIAL PRIMARY KEY
legacy_counterparty_id INTEGER UNIQUE
legacy_client_id INTEGER UNIQUE
party_type TEXT NOT NULL
name_canonical TEXT NOT NULL
name_aliases JSONB DEFAULT '[]'::JSONB
is_active BOOLEAN NOT NULL DEFAULT true
vat_number TEXT
registration_number TEXT
contact_person TEXT
contact_email TEXT
contact_phone TEXT
address TEXT
payment_terms TEXT
role_tags TEXT[] DEFAULT '{}'
source_table TEXT NOT NULL
created_at TIMESTAMP NOT NULL DEFAULT NOW()
updated_at TIMESTAMP NOT NULL DEFAULT NOW()
```

Indexes: `idx_parties_name_canonical` on `LOWER(name_canonical)`, `idx_parties_party_type` on `party_type`.

`COMMENT ON TABLE` explaining Phase 1B foundation.

### 4b. `20260402_party_abstraction_rollback.sql`

Drop indexes, then drop table.

### 5a. `20260402_finance_period_derivation.sql`

Add to `finance.cost_lines`:
- `invoice_date_typed DATE`
- `approved_date_typed DATE`
- `paid_date_typed DATE`
- `fiscal_period_id INTEGER`

Add to `finance.revenue_lines`:
- `invoice_date_typed DATE`
- `expected_payment_date_typed DATE`
- `paid_date_typed DATE`
- `fiscal_period_id INTEGER`

Create `finance.fiscal_periods`:
```
id SERIAL PRIMARY KEY
legacy_fiscal_period_id INTEGER UNIQUE
fiscal_year_name TEXT NOT NULL
period_name TEXT NOT NULL
start_date DATE NOT NULL
end_date DATE NOT NULL
sort_order INTEGER NOT NULL
source_table TEXT NOT NULL DEFAULT 'public.fiscal_periods'
created_at TIMESTAMP NOT NULL DEFAULT NOW()
```

Indexes: `idx_finance_cost_lines_fiscal_period` on `cost_lines(fiscal_period_id)`, `idx_finance_revenue_lines_fiscal_period` on `revenue_lines(fiscal_period_id)`, `idx_finance_fiscal_periods_range` on `fiscal_periods(start_date, end_date)`.

Add `COMMENT ON COLUMN` for `invoice_date_typed`, `fiscal_period_id` on both tables.

### 5b. `20260402_finance_period_derivation_rollback.sql`

Drop indexes, drop columns from both tables, drop `finance.fiscal_periods` table.

### 6a. `20260402_evidence_link_parity.sql`

Add to `documentation.document_versions`:
- `site_id TEXT`
- `drive_id TEXT`
- `file_item_id TEXT`
- `web_url TEXT`
- `is_approved BOOLEAN DEFAULT false`

Create partial index: `idx_document_versions_file_lineage` on `document_versions(document_id) WHERE legacy_deliverable_file_id IS NOT NULL`.

Add `COMMENT ON COLUMN` for all 5 columns explaining they come from `deliverable_files` via `legacy_deliverable_file_id` join.

### 6b. `20260402_evidence_link_parity_rollback.sql`

Drop index, drop 5 columns.

### 7a. `20260402_stale_item_tracking.sql`

Add `last_synced_at TIMESTAMP` (nullable, no default) to:
- `core.projects`
- `core.clients`
- `documentation.document_approvals`
- `documentation.documents`
- `finance.cost_lines`
- `finance.revenue_lines`

Create `internal.sync_watermarks`:
```
id BIGSERIAL PRIMARY KEY
domain TEXT NOT NULL
last_legacy_write_at TIMESTAMP
last_promoted_sync_at TIMESTAMP
lag_seconds NUMERIC(10,2)
stale_row_count INTEGER DEFAULT 0
checked_at TIMESTAMP NOT NULL DEFAULT NOW()
```

Index: `idx_sync_watermarks_domain_checked` on `(domain, checked_at DESC)`.

Add `COMMENT ON TABLE` and `COMMENT ON COLUMN` for `lag_seconds`.

### 7b. `20260402_stale_item_tracking_rollback.sql`

Drop `last_synced_at` from all 6 tables. Drop index and table.

---

## Part 2: Preflight Audit Script

Create file: `migrations/20260402_preflight_audit.sql`

This is NOT a migration. It is a read-only diagnostic script that outputs PASS/FAIL for each check. It must be run manually before any migration.

Implement all 7 preflight checks from the spec's "Mandatory Preflight Audit Pack" section:
1. Duplicate approval lineage candidates
2. Orphan FK mappings (4 sub-queries)
3. Unparseable finance dates (2 sub-queries)
4. Party canonicalization collisions (2 sub-queries)
5. Unresolved project FK mappings (2 sub-queries)
6. Existing promoted rows that collide with backfill assumptions (4 sub-queries)
7. Orphan legacy files (evidence parity)

Format: Each check should be a standalone `SELECT` that can be run independently. Add a comment header with the check name, pass condition, and severity level.

---

## Part 3: Backfill Scripts

Create these files in `/migrations/`. Each must be idempotent (use `ON CONFLICT DO NOTHING` or `WHERE ... IS NULL` guards). Each must be wrapped in `BEGIN; ... COMMIT;`.

Execute order matters — see spec "Backfill Execution Order" section.

### `20260402_backfill_01_fiscal_periods.sql`
Replicate `public.fiscal_periods` + `public.fiscal_years` into `finance.fiscal_periods`. Use `ON CONFLICT (legacy_fiscal_period_id) DO NOTHING`.

### `20260402_backfill_02_client_contacts.sql`
Update `core.clients` contact fields from `public.clients` via `legacy_id` join.

### `20260402_backfill_03_parties.sql`
Insert counterparties and clients into `core.parties`. Two separate `INSERT ... ON CONFLICT DO NOTHING` statements.

### `20260402_backfill_04_lifecycle_columns.sql`
Update `core.projects` lifecycle fields from `public.project_execution_state` via `legacy_project_info_id = project_id` join. Filter `deleted_at IS NULL`.

### `20260402_backfill_05_approval_lineage.sql`
Insert into `documentation.document_approvals` from `public.approvals`. Join keys:
- `core.projects cp ON cp.legacy_project_info_id = a.project_id` (for project_id resolution)
- `documentation.documents doc ON doc.legacy_deliverable_id = a.related_entity_id AND a.related_entity_type = 'deliverable'` (for document_id, LEFT JOIN — NULL if not document-scoped)
Use `ON CONFLICT (legacy_approval_id) DO NOTHING`. Filter `a.deleted_at IS NULL`.

### `20260402_backfill_06_evidence_sharepoint.sql`
Update `documentation.document_versions` SharePoint fields from `public.deliverable_files`.
Join key: `dv_promoted.legacy_deliverable_file_id = df.id` (NOT `df.version_id`).
Guard: `WHERE dv_promoted.site_id IS NULL`.

### `20260402_backfill_07_finance_typed_dates.sql`
Four steps in order:
1. Parse TEXT dates to typed DATE on `finance.cost_lines` (regex guard for `^\d{4}-\d{2}-\d{2}`)
2. Parse TEXT dates to typed DATE on `finance.revenue_lines`
3. Derive `fiscal_period_id` on `cost_lines` from `finance.fiscal_periods` date range
4. Derive `fiscal_period_id` on `revenue_lines` from `finance.fiscal_periods` date range
Guard all with `WHERE ... IS NULL` for idempotency.

---

## Part 4: Validation Tests

Create test file: `qa/tests/unit/phase1b-schema-validation.test.ts`

Use the project's existing test patterns (vitest, `db.execute(sql\`...\`)` for raw SQL).

### Test groups:

**Group 1: Schema existence tests** (one per migration)
- Verify each new column exists on the expected table (query `information_schema.columns`)
- Verify each new table exists (query `information_schema.tables`)
- Verify each new index exists (query `pg_indexes`)

**Group 2: Backfill correctness tests** (one per backfill script)
- Lifecycle: `COUNT(*) WHERE core.projects.current_stage_code IS NULL AND legacy has non-null` == 0
- Approvals: `COUNT(document_approvals WHERE legacy_approval_id IS NOT NULL)` == `COUNT(approvals WHERE deleted_at IS NULL)`
- Clients: `core.clients.primary_contact_email` matches `public.clients.primary_contact_email` for all rows
- Parties: `COUNT(core.parties WHERE legacy_counterparty_id IS NOT NULL)` == `COUNT(counterparties WHERE deleted_at IS NULL)`
- Evidence: `COUNT(document_versions WHERE legacy_deliverable_file_id IS NOT NULL AND site_id IS NULL)` == 0
- Finance dates: `COUNT(cost_lines WHERE invoice_date IS NOT NULL AND invoice_date_typed IS NULL)` == 0 (or only unparseable rows)
- Finance periods: `COUNT(cost_lines WHERE invoice_date_typed IS NOT NULL AND fiscal_period_id IS NULL)` == 0

**Group 3: Preflight gate tests** (verify the preflight script detects bad data)
- Insert a known-bad row, run the relevant preflight check, assert it reports the issue
- Clean up after each test

**Group 4: Reconciliation integration tests**
- After all backfills, run `buildPhase1AReconciliationReport()` and assert all 6 domains return `outcome: "pass"`
- Assert no PROVISIONAL notes remain in the `notes` arrays (except stale-lag which should say "no bridge writes active")

---

## What NOT to build

- No changes to any route handler
- No changes to authentication or authorization
- No bridge write logic
- No feature flag changes (flags remain OFF)
- No changes to the Drizzle ORM schema definitions in `shared/schema/` (these are SQL-only migrations)
- No UI changes
- No new API endpoints

---

## Execution checklist

1. Write all 14 migration files (7 forward + 7 rollback)
2. Write the preflight audit script
3. Write all 7 backfill scripts
4. Write the validation test file
5. Run the validation tests to confirm they compile (they will fail until migrations + backfills run — that is expected)
6. Commit all files in a single commit
7. Push to the designated branch
